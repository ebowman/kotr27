import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeRoute } from '../js/route-analysis.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';
import { estimateAscent, estimateEffort } from '../js/ascent-estimator.mjs';
import { estimateRouteTime, routeTimeAtDistance, allDayFraction } from '../js/route-time.mjs';
import { createRideClock, createRouteClock } from '../js/ride-clock.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const binding = {routeId: 'fixture', revisionId: 'fixture-v1', geometrySha256: 'a'.repeat(64)};
const point = (m, z = 100) => ({lat: 0, lon: m / 6371000 * 180 / Math.PI, elevationM: z});
const line = (length = 2000, rise = 100) =>
  Array.from({length: length / 100 + 1}, (_, i) => point(i * 100, 100 + rise * i * 100 / length));
const analyze = points => analyzeRoute({...binding, points});
const profile = a => ({schemaVersion: 1, chapters: a.chapters, segments: a.windows});
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} vs ${b}`);
const available = result => {
  assert.equal(result.status, 'available', JSON.stringify(result.issues));
  return result;
};
const unavailable = result => {
  assert.equal(result.status, 'unavailable');
  assert.ok(result.issues.length);
  for (const key of ['total', 'chapters', 'intervals', 'assumptions']) assert.equal(result[key], undefined);
};

function reconcile(a, result) {
  available(result);
  const direct = estimateEffort(profile(a), {
    riderKg: result.assumptions.riderKg, bikeKitKg: result.assumptions.bikeKitKg,
    ftpW: result.assumptions.ftpW, fraction: result.assumptions.fraction,
  });
  assert.deepEqual(result.identity, a.identity);
  assert.equal(result.chapters.length, a.chapters.length);
  assert.equal(result.intervals.filter(i => i.status === 'moving').length, a.windows.length);
  const sum = {movingSeconds: 0, pedalWorkKJ: 0, stopSeconds: 0};
  for (const [i, c] of result.chapters.entries()) {
    assert.equal(c.id, a.chapters[i].id);
    assert.equal(c.arrivalSeconds, sum.movingSeconds + sum.stopSeconds);
    assert.equal(c.departureSeconds, sum.movingSeconds + (sum.stopSeconds + c.stopSeconds));
    for (const key of ['movingSeconds', 'pedalWorkKJ']) assert.equal(c[key], direct.chapters[i][key]);
    for (const key of Object.keys(sum)) sum[key] += c[key];
    assert.deepEqual(c.cumulative, {...sum, elapsedSeconds: sum.movingSeconds + sum.stopSeconds});
    const windows = result.intervals.filter(w => w.chapterId === c.id && w.status === 'moving');
    for (const key of ['movingSeconds', 'pedalWorkKJ'])
      assert.equal(c[key], windows.reduce((n, w) => n + w[key], 0));
    assert.equal(windows.at(-1).endSeconds, c.cumulative.elapsedSeconds);
    const atStart = routeTimeAtDistance(result, c.startM);
    assert.equal(atStart.elapsedSeconds, c.arrivalSeconds);
  }
  assert.deepEqual(result.total, {...sum, elapsedSeconds: sum.movingSeconds + sum.stopSeconds});
  assert.equal(result.total.movingSeconds, direct.total.movingSeconds);
  assert.equal(result.total.pedalWorkKJ, direct.total.pedalWorkKJ);
  assert.equal(result.assumptions.stopSeconds, result.total.stopSeconds);
  assert.equal(result.intervals.at(-1).endSeconds, result.total.elapsedSeconds);
  assert.deepEqual(routeTimeAtDistance(result, a.distanceM),
    {status: 'available', identity: a.identity, distanceM: a.distanceM, ...result.total});
  const clock = available(createRouteClock(result));
  assert.equal(clock.finishSeconds, result.total.elapsedSeconds);
  let end = 0;
  for (const w of result.intervals) {
    assert.equal(w.startSeconds, end);
    assert.ok(w.endSeconds > w.startSeconds);
    end = w.endSeconds;
    const mid = clock.atSecond((w.startSeconds + w.endSeconds) / 2);
    assert.equal(mid.chapterId, w.chapterId);
    assert.equal(mid.status, w.status);
    near(mid.distanceM, (w.startM + w.endM) / 2);
    near(mid.elevationM, (w.startElevationM + w.endElevationM) / 2);
    if (w.status === 'moving') {
      const sample = routeTimeAtDistance(result, (w.startM + w.endM) / 2);
      near(sample.elapsedSeconds, (w.startSeconds + w.endSeconds) / 2);
      near(sample.movingSeconds, w.movingStartSeconds + w.movingSeconds / 2);
      near(sample.pedalWorkKJ, w.pedalWorkStartKJ + w.pedalWorkKJ / 2);
    }
  }
  assert.deepEqual(clock.atSecond(clock.finishSeconds), {seconds: clock.finishSeconds,
    chapterId: a.chapters.at(-1).id, status: 'finished', distanceM: a.distanceM,
    elevationM: a.windows.at(-1).endElevationM});
}

test('all seven approved inputs: six reconcile every chapter/scenario; D4S is explicitly outside the solver domain', async () => {
  const {pack} = await readRoutePack(root);
  assert.equal(pack.routes.length, 7);
  const supported = new Set(), unsupported = new Set();
  for (const route of pack.catalog.routes) {
    const a = await loadRouteAnalysis({pack, routeId: route.id, revisionId: route.currentRevisionId,
      readAsset: path => readFile(new URL(`../${path}`, import.meta.url))});
    assert.equal(a.status, 'supported', 'valid geometry analysis need not imply supported physics');
    for (const scenario of ['easy', 'steady', 'hard', 'all-day']) {
      const result = estimateRouteTime(a, {scenario,
        stops: a.chapters.filter((_, i) => i % 3 === 0).map(c => ({chapterId: c.id, seconds: 123.456}))});
      if (route.id === 'rwgps-57874050') {
        unsupported.add(route.id);
        unavailable(result);
        assert.deepEqual(result.identity, a.identity);
        const outside = a.windows.filter(w => Math.abs(w.gradePercent) > 50);
        assert.equal(outside.length, 2);
        assert.deepEqual(outside.map(w => [w.startM, w.endM]), [[25500, 25750], [26000, 26250]]);
        near(outside[0].gradePercent, 68.39293801825441);
        near(outside[1].gradePercent, -57.79571797394787);
        const issue = result.issues[0];
        assert.deepEqual(issue, {code: 'model-domain',
          message: 'window grade must be a finite number in [-0.5, 0.5]',
          segmentIndex: 102, chapterId: 'chapter-68', startM: 25500, endM: 25750,
          unit: 'rise/run', field: 'window grade', value: outside[0].gradePercent / 100,
          minimum: -0.5, maximum: 0.5});
        assert.equal(createRouteClock(result).status, 'unavailable');
        unavailable(routeTimeAtDistance(result, 0));
        assert.throws(() => estimateEffort(profile(a)), /window grade/);
        continue;
      }
      supported.add(route.id);
      reconcile(a, result);
      assert.equal(result.elevationBasis, a.recipe);
      if (scenario === 'all-day') {
        assert.equal(result.assumptions.allDay.seedMovingSeconds, estimateEffort(profile(a)).total.movingSeconds);
        assert.equal(result.assumptions.fraction, allDayFraction(result.assumptions.allDay.seedMovingSeconds));
      }
    }
  }
  assert.equal(supported.size, 6);
  assert.deepEqual([...unsupported], ['rwgps-57874050']);
  assert.equal(supported.size + unsupported.size, 7);
});

test('flat, long uphill, shallow and steep descents share the unchanged solver/cap/work behavior', () => {
  for (const [length, rise] of [[2000, 0], [20000, 1600], [2000, -20], [2000, -70], [2000, -400]]) {
    const a = analyze(line(length, rise));
    const result = estimateRouteTime(a, {scenario: 'easy'});
    reconcile(a, result);
    const legacy = estimateAscent(profile(a));
    assert.equal(result.total.movingSeconds, legacy.total.slower.movingSeconds);
    assert.equal(result.total.pedalWorkKJ, legacy.total.slower.pedalWorkKJ);
    if (rise === -400) {
      assert.equal(result.total.pedalWorkKJ, 0);
      near(result.total.movingSeconds, Math.hypot(length, rise) / 12.5);
    } else if (rise === -70) {
      assert.ok(result.total.pedalWorkKJ > 0);
      assert.ok(result.total.pedalWorkKJ < result.total.movingSeconds * 132 / 1000);
    } else near(result.total.pedalWorkKJ, result.total.movingSeconds * 132 / 1000);
  }
});

test('explicit chapter-entry stops hold on [arrival, departure), without changing moving time or work', () => {
  const a = analyze(line(4000, 0).map((p, i) => ({...p, elevationM: 100 + Math.min(i, 40 - i) * 10})));
  const base = available(estimateRouteTime(a));
  const stops = a.chapters.map((c, i) => ({chapterId: c.id, seconds: i ? 900 : 300}));
  const result = estimateRouteTime(a, {stops});
  reconcile(a, result);
  assert.equal(result.total.movingSeconds, base.total.movingSeconds);
  assert.equal(result.total.pedalWorkKJ, base.total.pedalWorkKJ);
  const clock = createRouteClock(result);
  for (const c of result.chapters) {
    assert.equal(clock.atSecond(c.arrivalSeconds).status, 'stopped');
    assert.equal(clock.atSecond(c.departureSeconds - 1e-6).status, 'stopped');
    assert.equal(clock.atSecond(c.departureSeconds).status, 'moving');
    assert.equal(clock.atSecond(c.departureSeconds).distanceM, c.startM);
    assert.equal(routeTimeAtDistance(result, c.startM).elapsedSeconds, c.arrivalSeconds);
  }
  assert.deepEqual(clock.atSecond(-1), clock.atSecond(0));
  assert.deepEqual(clock.atSecond(Infinity), null);
  assert.deepEqual(clock.atSecond(clock.finishSeconds + 1), clock.atSecond(clock.finishSeconds));
  for (const bad of [NaN, '0', null, undefined]) assert.equal(clock.atSecond(bad), null);
  for (const bad of [NaN, '0', -1, a.distanceM + 1]) unavailable(routeTimeAtDistance(result, bad));
});

test('All Day uses documented single-pass moving-duration bands, independent of stops', () => {
  for (const [hour, expected] of [[0.001, .8], [2 - 1e-6, .8], [2, .75], [3 - 1e-6, .75],
    [3, .7], [4 - 1e-6, .7], [4, .65], [5 - 1e-6, .65], [5, .6], [7 - 1e-6, .6], [7, .55], [100, .55]])
    assert.equal(allDayFraction(hour * 3600), expected);
  for (const bad of [0, -1, NaN, Infinity, '7200', null]) assert.equal(allDayFraction(bad), null);
  const a = analyze(line(20000, 1600));
  const plain = available(estimateRouteTime(a, {scenario: 'all-day'}));
  const stopped = available(estimateRouteTime(a, {scenario: 'all-day',
    stops: [{chapterId: a.chapters[0].id, seconds: 86400}]}));
  assert.deepEqual(stopped.assumptions.allDay, plain.assumptions.allDay);
  assert.equal(plain.assumptions.allDay.seedMovingSeconds, estimateEffort(profile(a)).total.movingSeconds);
  assert.equal(stopped.total.movingSeconds, plain.total.movingSeconds);
  assert.equal(stopped.total.elapsedSeconds, plain.total.movingSeconds + 86400);
});

test('all rider bounds and custom effort endpoints remain supported; uphill responses are monotonic', () => {
  const a = analyze(line(20000, 1600));
  for (const riderKg of [20, 250]) for (const bikeKitKg of [3, 60])
    for (const ftpW of [30, 650]) for (const fraction of [.4, .9])
      reconcile(a, estimateRouteTime(a, {scenario: 'custom', riderKg, bikeKitKg, ftpW, fraction}));
  const time = options => available(estimateRouteTime(a, options)).total.movingSeconds;
  assert.ok(time({riderKg: 90}) > time({riderKg: 75}));
  assert.ok(time({bikeKitKg: 20}) > time({bikeKitKg: 12}));
  assert.ok(time({ftpW: 250}) < time({ftpW: 220}));
  assert.ok(time({scenario: 'easy'}) > time({scenario: 'steady'}));
  assert.ok(time({scenario: 'steady'}) > time({scenario: 'hard'}));
  for (const fraction of [.7, .8, .9]) {
    const result = estimateRouteTime(a, {scenario: 'custom', fraction});
    assert.equal(result.total.movingSeconds,
      estimateAscent(profile(a), {slowerFraction: .6, fasterFraction: fraction}).total.faster.movingSeconds);
  }
});

test('new and legacy clocks agree when profile, rider and fraction agree, without changing 70/80 meanings', () => {
  const a = analyze(line(4000, 0).map((p, i) => ({...p, elevationM: 100 + Math.min(i, 40 - i) * 10})));
  const rider = {riderKg: 84.5, bikeKitKg: 13.2, ftpW: 247};
  const estimate = estimateAscent(profile(a), {...rider, slowerFraction: .7, fasterFraction: .8});
  for (const [pace, fraction] of [['slower', .7], ['faster', .8]]) {
    const result = available(estimateRouteTime(a, {...rider, scenario: 'custom', fraction}));
    const current = createRouteClock(result);
    const legacy = createRideClock({estimate, effort: pace}, pace);
    assert.equal(current.finishSeconds / 60, legacy.finishMinuteA);
    for (const seconds of [0, 1, 60, current.finishSeconds / 2, current.finishSeconds]) {
      const next = current.atSecond(seconds), old = legacy.atMinute(seconds / 60).a;
      assert.equal(next.chapterId, old.chapterId);
      assert.equal(next.status, old.status);
      near(next.distanceM, old.distanceM);
      near(next.elevationM, old.elevationM);
    }
  }
});

test('both signed grade bounds remain inclusive and just-outside grades are rejected with numeric context', () => {
  const p = {schemaVersion: 1, chapters: [{id: 'bound', startM: 0, endM: 1000}],
    segments: [{chapterId: 'bound', startM: 0, endM: 1000, startElevationM: 1000, endElevationM: 1500}]};
  for (const rise of [-500, 500]) {
    p.segments[0].endElevationM = 1000 + rise;
    assert.ok(estimateEffort(p).total.movingSeconds > 0);
    p.segments[0].endElevationM += Math.sign(rise) * .001;
    assert.throws(() => estimateEffort(p), error => {
      assert.ok(error instanceof RangeError);
      assert.equal(error.details.segmentIndex, 0);
      assert.equal(error.details.chapterId, 'bound');
      assert.equal(error.details.minimum, -.5);
      assert.equal(error.details.maximum, .5);
      assert.ok(Math.abs(error.details.value) > .5);
      return true;
    });
  }
});

test('missing elevation/gaps/breaks/duplicates and unsupported contracts produce no fabricated or partial result', () => {
  for (const edit of [
    p => {p[3].elevationM = null;}, p => {delete p[3].elevationM;},
    p => {p[3].elevationM = NaN;}, p => {p[3].breakBefore = true;},
    p => {p[3] = {...p[2]};}, p => p.splice(3, 7),
  ]) {
    const points = line(); edit(points);
    unavailable(estimateRouteTime(analyze(points)));
  }
  for (const bad of [null, {}, {status: 'unsupported'}, {status: 'supported'}])
    unavailable(estimateRouteTime(bad));
  const a = analyze(line());
  for (const edit of [
    a => {a.distanceSemantics = 'road';}, a => {a.units.distance = 'km';},
    a => {a.recipe = 'unreviewed';}, a => {a.identity.revisionId = 'other';},
    a => {a.processedTotals = null;}, a => {a.distanceM++;},
    a => {a.windows.pop();}, a => {a.chapters[0].endM--;},
    a => {a.windows[1].startElevationM++;}, a => {a.windows[0].endElevationM = null;},
    a => {a.windows[0].startElevationM = '100';}, a => {a.windows[0].endM = .5;},
    a => {a.windows = Array(10001).fill(a.windows[0]);},
    a => {a.windows[0] = null;}, a => {a.chapters[0] = null;},
  ]) {
    const bad = structuredClone(a); edit(bad); unavailable(estimateRouteTime(bad));
  }
  unavailable(estimateRouteTime(analyze(line(2000, 1200)))); // >50% window grade
  assert.equal(createRouteClock(estimateRouteTime(null)).status, 'unavailable');
  unavailable(routeTimeAtDistance(estimateRouteTime(null), 0));
});

test('invalid rider/options/stops never silently fall back, coerce, clamp or truncate', () => {
  const a = analyze(line());
  for (const options of [null, [], 'steady', {scenario: undefined}, {scenario: 'faster'},
    {fraction: .8}, {scenario: 'custom'}, {scenario: 'custom', fraction: undefined},
    {scenario: 'custom', fraction: .91}, {scenario: 'custom', fraction: .39},
    {scenario: 'custom', fraction: '0.8'}, {ftpW: undefined}, {ftpW: 29}, {ftpW: 651},
    {riderKg: 19}, {riderKg: 251}, {bikeKitKg: 2}, {bikeKitKg: 61}, {riderKg: Infinity},
    {ftpW: '220'}, {riderKg: NaN}, {ftpW: null}, {peakPowerW: 900}, {windMps: 1},
    {stops: undefined}, {stops: Array(1001).fill({chapterId: a.chapters[0].id, seconds: 1})},
    ...[null, {}, {chapterId: 'other', seconds: 1}, {chapterId: a.chapters[0].id, seconds: -1},
      ...[NaN, Infinity, '60', 86401, undefined].map(seconds => ({chapterId: a.chapters[0].id, seconds})),
      {chapterId: a.chapters[0].id, seconds: 1, distanceM: 0}].map(s => ({stops: [s]})),
    {stops: Array(2).fill({chapterId: a.chapters[0].id, seconds: 60})},
  ]) unavailable(estimateRouteTime(a, options));
  const two = analyze(line(4000, 0).map((p, i) => ({...p, elevationM: 100 + Math.min(i, 40 - i) * 10})));
  unavailable(estimateRouteTime(two, {stops: two.chapters.map(c => ({chapterId: c.id, seconds: 86400}))}));
  reconcile(a, estimateRouteTime(a, {stops: [{chapterId: a.chapters[0].id, seconds: 0}]}));
});

test('processed versus raw/source semantics and immutable snapshots remain explicit', () => {
  const points = line(); points[1].elevationM += 80;
  const a = analyzeRoute({...binding, points, sourceTotals: {listed: {gainM: 9999}}});
  const options = {ftpW: 240, stops: [{chapterId: a.chapters[0].id, seconds: 60}]};
  const input = structuredClone(options);
  const result = estimateRouteTime(a, options);
  reconcile(a, result);
  assert.notEqual(a.rawTotals.ascentM, a.processedTotals.ascentM);
  assert.deepEqual(options, input);
  assert.deepEqual(result.assumptions.defaultedInputs, ['riderKg', 'bikeKitKg']);
  assert.equal(result.assumptions.targetW, 180);
  assert.ok(result.assumptions.limitations.some(s => s.includes('not food calories')));
  assert.ok(result.assumptions.limitations.some(s => s.includes('90%')));
  assert.ok(result.assumptions.limitations.some(s => s.includes('no peak-power')));
  assert.ok(Object.isFrozen(result.intervals[0]));
  options.stops[0].seconds = 999;
  assert.equal(result.total.stopSeconds, 60);
  const changedSource = structuredClone(a); changedSource.sourceTotals.listed.gainM = 1;
  assert.deepEqual(estimateRouteTime(changedSource, input), result);
});

test('complete maximum-size profile and stop plan are bounded, never silently truncated', () => {
  // Synthetic contract fixture; not a new real route or analysis recipe.
  const a = structuredClone(analyze(line()));
  a.distanceM = 1000000; a.processedTotals.distanceM = a.distanceM;
  a.chapters = Array.from({length: 1000}, (_, i) =>
    ({id: `c-${i}`, kind: 'flat', startM: i * 1000, endM: (i + 1) * 1000}));
  a.windows = Array.from({length: 10000}, (_, i) => ({
    chapterId: `c-${Math.floor(i / 10)}`, startM: i * 100, endM: (i + 1) * 100,
    startElevationM: 100, endElevationM: 100,
  }));
  const options = {scenario: 'all-day', stops: a.chapters.map(c => ({chapterId: c.id, seconds: 1}))};
  const result = available(estimateRouteTime(a, options));
  assert.equal(result.chapters.length, 1000);
  assert.equal(result.intervals.length, 11000);
  assert.equal(result.total.stopSeconds, 1000);
  assert.equal(result.total.movingSeconds, result.chapters.reduce((n, c) => n + c.movingSeconds, 0));
  assert.equal(result.intervals.at(-1).endM, 1000000);
  assert.equal(createRouteClock(result).atSecond(result.total.elapsedSeconds).status, 'finished');
  a.windows.push({...a.windows.at(-1)});
  unavailable(estimateRouteTime(a, options));
  a.windows.pop(); a.distanceM++;
  unavailable(estimateRouteTime(a, options));
});

test('legacy Semonzo serialized results are byte-for-byte unchanged at defaults, UI fractions and extremes', async () => {
  const p = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
  const estimates = [{}, {slowerFraction: .7, fasterFraction: .8},
    {riderKg: 20, bikeKitKg: 3, ftpW: 30}, {riderKg: 250, bikeKitKg: 60, ftpW: 650}].map(o => estimateAscent(p, o));
  assert.equal(createHash('sha256').update(JSON.stringify(estimates)).digest('hex'),
    '808b418ec1fa148e715ebc80b95451bd9bf0a211ba897a72bf8e6e7a549142e1');
  for (const [i, options] of [{}, {riderKg: 20, bikeKitKg: 3, ftpW: 30},
    {riderKg: 250, bikeKitKg: 60, ftpW: 650}].entries()) {
    const legacy = estimates[[0, 2, 3][i]];
    for (const [pace, fraction] of [['slower', .6], ['faster', .75]]) {
      const single = estimateEffort(p, {...options, fraction});
      assert.deepEqual(single.total, legacy.total[pace]);
      for (const [j, c] of single.chapters.entries()) {
        assert.equal(c.movingSeconds, legacy.chapters[j][pace].movingSeconds);
        for (const [k, w] of c.windows.entries())
          assert.equal(w.movingSeconds, legacy.chapters[j].windows[k][pace].movingSeconds);
      }
    }
  }
});
