import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { estimateAscent, solveWindowMotion } from '../js/ascent-estimator.mjs';

const route = JSON.parse(readFileSync(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const slope = rise => ({
  schemaVersion: 1, chapters: [{ id: 'a', startM: 0, endM: 1000 }],
  segments: [{ chapterId: 'a', startM: 0, endM: 1000, startElevationM: 300, endElevationM: 300 + rise }],
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} vs ${b}`);

test('10% incline matches forward energy budget at 3 m/s', () => {
  // 80 kg rises 100 m over 1000 horizontal m. At 3 m/s the wheel
  // needs 80*9.81*(100+.005*1000) + 1.89*hypot(1000,100) joules.
  // Divide by .95, then riding seconds: 264.900140912 W at the pedals.
  const { faster } = estimateAscent(slope(100), {
    riderKg: 68, bikeKitKg: 12, ftpW: 353.20018788237456,
  }).total;
  near(faster.movingSeconds, 334.995854037363);
  near(faster.pedalWorkKJ, 88.740448939360);
});

test('heavier system climbs slower; more power climbs faster', () => {
  const time = options => estimateAscent(route, options).total.slower.movingSeconds;
  assert.ok(time({ riderKg: 90 }) > time({}));
  assert.ok(time({ bikeKitKg: 16 }) > time({}));
  assert.ok(time({ ftpW: 250 }) < time({}));
});

test('flats and shallow descents are ridden; steep descent coasts at cap', () => {
  const get = rise => estimateAscent(slope(rise)).total.slower;
  const flat = get(0), down = get(-10), up = get(10);
  assert.ok(down.movingSeconds < flat.movingSeconds && flat.movingSeconds < up.movingSeconds);
  near(down.pedalWorkKJ, down.movingSeconds * 132 / 1000);
  near(get(-200).movingSeconds, Math.hypot(1000, 200) / 12.5);
  assert.equal(get(-200).pedalWorkKJ, 0);
  const partial = get(-35);
  assert.ok(partial.pedalWorkKJ > 0 && partial.pedalWorkKJ < partial.movingSeconds * 132 / 1000);
});

test('shipped signed windows reconcile exactly by chapter before display rounding', () => {
  const input = structuredClone(route);
  const { chapters, total, assumptions } = estimateAscent(input);
  assert.deepEqual(input, route);
  assert.deepEqual(chapters.map(c => c.id), route.chapters.map(c => c.id));
  assert.equal(assumptions.systemKg, 87);
  assert.equal(assumptions.slowerTargetW, 132);
  assert.equal(assumptions.fasterTargetW, 165);
  for (const c of chapters) assert.ok(c.faster.movingSeconds < c.slower.movingSeconds);
  for (const effort of ['slower', 'faster']) {
    for (const metric of ['movingSeconds', 'pedalWorkKJ']) {
      assert.ok(total[effort][metric] > 0 && Number.isFinite(total[effort][metric]));
      assert.equal(total[effort][metric], chapters.reduce((v, c) => v + c[effort][metric], 0));
    }
  }
});

test('reject non-option containers and unsupported keys instead of estimating the example', () => {
  for (const options of ['220', 220, null, [], new Map(), Object.create({ ftpW: 300 })]) {
    assert.throws(() => estimateAscent(route, options), TypeError);
  }
  for (const options of [{ targetFraction: 0.8 }, { ftpW: 240, physics: { speedCapMps: 10 } }]) {
    assert.throws(() => estimateAscent(route, options), /Unsupported ascent option/);
  }
  assert.throws(() => estimateAscent(route, { ftpW: undefined }), RangeError);
});

test('omitted fields use example defaults; explicit fractions model two steady plans', () => {
  const profile = slope(100);
  const example = estimateAscent(profile);
  assert.deepEqual(estimateAscent(profile, {}), example);
  const plans = estimateAscent(profile, { ftpW: 240, slowerFraction: 0.65, fasterFraction: 0.8 });
  assert.equal(plans.assumptions.systemKg, example.assumptions.systemKg);
  for (const [scenario, watts] of [['slower', 156], ['faster', 192]]) {
    assert.equal(plans.assumptions[`${scenario}TargetW`], watts);
    const { movingSeconds, pedalWorkKJ } = plans.total[scenario];
    near(pedalWorkKJ, watts * movingSeconds / 1000);
  }
});

test('reject malformed windows, grade spikes, discontinuities and unusable rider inputs', () => {
  for (const patch of [{ startM: 1 }, { endM: 0 }, { endM: 990 }, { endElevationM: 900 },
    { startElevationM: null }, { endElevationM: NaN }, { chapterId: 'no' }]) {
    const input = slope(10);
    Object.assign(input.segments[0], patch);
    assert.throws(() => estimateAscent(input), RangeError);
  }
  const discontinuous = structuredClone(route);
  discontinuous.segments[1].startElevationM++;
  assert.throws(() => estimateAscent(discontinuous), RangeError);
  for (const options of [{ ftpW: 0 }, { riderKg: Infinity }, { bikeKitKg: '12' },
    { fasterFraction: 1 }, { slowerFraction: 0.8 }]) {
    assert.throws(() => estimateAscent(route, options), RangeError);
  }
});

test('shared zero-power primitive stalls without a floor; descents balance force or cap', () => {
  for (const rise of [100, 0, -5]) {
    const m = solveWindowMotion(1000, rise, 87, 0);
    assert.equal(m.speedMps, 0);
    assert.equal(m.horizontalSpeedMps, 0);
    assert.equal(m.pedalPowerW, 0);
    assert.equal(m.stalled, true);
  }
  const m = solveWindowMotion(1000, -10, 87, 0);
  const load = 87 * 9.81 * (-10 + .005 * 1000) / Math.hypot(1000, 10);
  near(m.speedMps, Math.sqrt(-load / .21));
  near(m.horizontalSpeedMps, m.speedMps * 1000 / Math.hypot(1000, 10));
  assert.equal(m.stalled, false);
  assert.equal(m.capped, false);
  const capped = solveWindowMotion(1000, -200, 87, 0);
  assert.equal(capped.speedMps, 12.5);
  assert.equal(capped.capped, true);
  assert.equal(capped.pedalPowerW, 0);
});

test('shared positive primitive retains legacy work, units and explicit delivered cap power', () => {
  for (const rise of [-200, -35, -10, 0, 100, 500]) {
    const m = solveWindowMotion(1000, rise, 87, 165);
    const legacy = estimateAscent(slope(rise)).total.faster;
    near(legacy.movingSeconds, Math.hypot(1000, rise) / m.speedMps);
    near(legacy.pedalWorkKJ, m.pedalPowerW * legacy.movingSeconds / 1000);
    const load = 87 * 9.81 * (rise + 5) / Math.hypot(1000, rise);
    near(m.pedalPowerW * .95, Math.max(0, (load + .21 * m.speedMps ** 2) * m.speedMps));
    assert.ok(m.pedalPowerW <= m.targetPowerW);
    if (rise === -35) assert.ok(m.capped && m.pedalPowerW > 0 && m.pedalPowerW < 165);
  }
  for (const args of [[0, 0, 87, 0], [1000, 501, 87, 0], [1000, 0, 22, 0],
    [1000, 0, 87, -1], [1000, 0, 87, NaN], [1000, 0, 87, 586],
    [1000, '10', 87, 0], [1000, null, 87, 0]])
    assert.throws(() => solveWindowMotion(...args), RangeError);
});
