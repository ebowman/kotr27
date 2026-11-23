import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { estimateAscent } from '../js/ascent-estimator.mjs';
import { buildClimbSensitivity, evaluateClimbSensitivityPoint, compareClimbSensitivity } from '../js/climb-sensitivity.mjs';
import { formatSensitivityChange } from '../js/climb-sensitivity-view.mjs';

const route = JSON.parse(readFileSync(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const slope = rise => ({
  schemaVersion: 1, chapters: [{ id: 'a', startM: 0, endM: 1000 }],
  segments: [{ chapterId: 'a', startM: 0, endM: 1000, startElevationM: 300, endElevationM: 300 + rise }],
});
const options = () => ({
  riderKgAxis: [60, 75, 90], ftpWAxis: [150, 220, 300],
  baseline: { riderKg: 73.125, ftpW: 237.5 }, bikeKitKg: 12, effortFraction: 0.8,
});
const pointOptions = () => ({
  riderKg: 73.125, ftpW: 237.5, bikeKitKg: 12, effortFraction: 0.8,
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} vs ${b}`);
function agrees(profile, point, settings) {
  const direct = estimateAscent(profile, {
    riderKg: point.riderKg, ftpW: point.ftpW, bikeKitKg: settings.bikeKitKg,
    slowerFraction: 0.6, fasterFraction: settings.effortFraction,
  });
  near(point.movingSeconds, direct.total.faster.movingSeconds);
  assert.equal(point.targetW, direct.assumptions.fasterTargetW);
  assert.ok(Number.isFinite(point.movingSeconds) && point.movingSeconds > 0);
  const expected = { ...direct.assumptions, effortFraction: settings.effortFraction, targetW: point.targetW };
  for (const key of ['slowerFraction', 'fasterFraction', 'slowerTargetW', 'fasterTargetW']) delete expected[key];
  assert.deepEqual(point.assumptions, expected);
}
function freezeDeep(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeDeep(child);
  }
  return Object.freeze(value);
}

test('shipped profile grid and off-mesh baseline agree with direct estimator, unrounded', () => {
  const input = options();
  const result = buildClimbSensitivity(route, input);
  assert.deepEqual(result.axes, { riderKg: input.riderKgAxis, ftpW: input.ftpWAxis });
  assert.equal(result.grid.length, input.riderKgAxis.length);
  result.grid.forEach((row, i) => {
    assert.equal(row.length, input.ftpWAxis.length);
    row.forEach((point, j) => {
      assert.equal(point.riderKg, input.riderKgAxis[i]);
      assert.equal(point.ftpW, input.ftpWAxis[j]);
      agrees(route, point, input);
    });
  });
  agrees(route, result.baseline, input);
  assert.deepEqual(result.baseline, evaluateClimbSensitivityPoint(route, pointOptions()));
  assert.notEqual(result.baseline.movingSeconds, Math.round(result.baseline.movingSeconds));
  assert.deepEqual(result.assumptions, {
    bikeKitKg: 12, effortFraction: 0.8,
    gravityMps2: 9.81, airDensityKgM3: 1.2, dragAreaM2: 0.35,
    rollingCoefficient: 0.005, drivetrainEfficiency: 0.95, speedCapMps: 12.5,
    windMps: 0, stopSeconds: 0,
  });
});

test('exact arbitrary points are not interpolated or restricted to mesh extent', () => {
  const input = { ...options(), riderKgAxis: [80], ftpWAxis: [200] };
  const result = buildClimbSensitivity(route, input);
  agrees(route, result.baseline, input);
  const point = { ...pointOptions(), riderKg: 99.321, ftpW: 318.765 };
  agrees(route, evaluateClimbSensitivityPoint(route, point), point);
  const onMesh = { ...pointOptions(), riderKg: 80, ftpW: 200 };
  assert.deepEqual(result.grid[0][0], evaluateClimbSensitivityPoint(route, onMesh));
});

test('effort endpoints and all extreme rider, FTP and bike/kit combinations', () => {
  for (const effortFraction of [0.7, 0.9]) {
    for (const bikeKitKg of [3, 60]) {
      const input = { ...options(), riderKgAxis: [20, 250], ftpWAxis: [30, 650],
        bikeKitKg, effortFraction };
      const result = buildClimbSensitivity(route, input);
      for (const point of result.grid.flat()) {
        agrees(route, point, input);
        assert.deepEqual(point, evaluateClimbSensitivityPoint(route, {
          riderKg: point.riderKg, ftpW: point.ftpW, bikeKitKg, effortFraction,
        }));
      }
      agrees(route, result.baseline, input);
    }
  }
});

test('bounded grid accepts 21 samples per axis, including singleton axes', () => {
  const input = { ...options(),
    riderKgAxis: Array.from({ length: 21 }, (_, i) => 20 + i * 11.5),
    ftpWAxis: Array.from({ length: 21 }, (_, i) => 30 + i * 31),
  };
  const result = buildClimbSensitivity(slope(100), input);
  assert.equal(result.grid.flat().length, 441);
  for (const point of result.grid.flat()) agrees(slope(100), point, input);
  assert.equal(buildClimbSensitivity(slope(100), {
    ...options(), riderKgAxis: [75], ftpWAxis: [220],
  }).grid.flat().length, 1);
});

test('rejects missing, nonfinite, unordered, duplicate, sparse and oversized axes', () => {
  for (const key of ['riderKgAxis', 'ftpWAxis']) {
    const low = key === 'riderKgAxis' ? 20 : 30;
    const high = key === 'riderKgAxis' ? 250 : 650;
    for (const axis of [undefined, null, {}, '75', new Float64Array([75]), [],
      [NaN], [Infinity], [-Infinity], ['75'], [null], [undefined], [true],
      [low - 0.01], [high + 0.01], [80, 70], [75, 75], Array(2),
      Array.from({ length: 22 }, (_, i) => low + i)]) {
      assert.throws(() => buildClimbSensitivity(slope(100), { ...options(), [key]: axis }),
        { name: Array.isArray(axis) ? 'RangeError' : 'TypeError' });
    }
  }
});

test('rejects invalid options and fields rather than substituting examples', () => {
  for (const [build, valid] of [[buildClimbSensitivity, options()],
    [evaluateClimbSensitivityPoint, pointOptions()]]) {
    for (const value of [undefined, null, [], 220, '220', new Map(), Object.create(valid)]) {
      assert.throws(() => build(route, value), TypeError);
    }
    for (const key of Reflect.ownKeys(valid)) {
      const missing = { ...valid };
      delete missing[key];
      assert.throws(() => build(route, missing), TypeError);
      assert.throws(() => build(route, { ...valid, [key]: undefined }));
    }
    for (const patch of [{ unknown: 1 }, { [Symbol('unknown')]: 1 }, { slowerFraction: 0.6 },
      { physics: {} }, { fasterFraction: 0.8 }]) {
      assert.throws(() => build(route, { ...valid, ...patch }), TypeError);
    }
    for (const effortFraction of [0.6999, 0.9001, 0.6, NaN, Infinity, null, '0.8', true]) {
      assert.throws(() => build(route, { ...valid, effortFraction }), RangeError);
    }
    for (const bikeKitKg of [2.99, 60.01, NaN, Infinity, null, '12']) {
      assert.throws(() => build(route, { ...valid, bikeKitKg }), RangeError);
    }
  }
  for (const baseline of [null, [], {}, { riderKg: 75 }, { ...options().baseline, extra: 1 }]) {
    assert.throws(() => buildClimbSensitivity(route, { ...options(), baseline }), TypeError);
  }
  for (const patch of [{ riderKg: 19.99 }, { riderKg: 250.01 }, { riderKg: NaN },
    { riderKg: '75' }, { ftpW: 29.99 }, { ftpW: 650.01 }, { ftpW: Infinity }, { ftpW: null }]) {
    assert.throws(() => evaluateClimbSensitivityPoint(route, { ...pointOptions(), ...patch }), RangeError);
    assert.throws(() => buildClimbSensitivity(route, {
      ...options(), baseline: { ...options().baseline, ...patch },
    }), RangeError);
  }
});

test('propagates profile validation for grid and exact evaluation', () => {
  const profiles = [undefined, null, {}, { ...slope(100), schemaVersion: 2 },
    { ...slope(100), segments: [] }, { ...slope(100), chapters: [] }, slope(501)];
  for (const patch of [{ startM: 1 }, { endM: 999 }, { endElevationM: NaN }, { chapterId: 'missing' }]) {
    const profile = slope(100);
    Object.assign(profile.segments[0], patch);
    profiles.push(profile);
  }
  const discontinuous = structuredClone(route);
  discontinuous.segments[1].startElevationM++;
  profiles.push(discontinuous);
  for (const profile of profiles) {
    assert.throws(() => buildClimbSensitivity(profile, options()));
    assert.throws(() => evaluateClimbSensitivityPoint(profile, pointOptions()));
  }
});

test('deterministic with deeply frozen inputs and no output aliases to inputs', () => {
  const profile = freezeDeep(structuredClone(route)), input = freezeDeep(options());
  const beforeProfile = structuredClone(profile), beforeInput = structuredClone(input);
  const first = buildClimbSensitivity(profile, input), second = buildClimbSensitivity(profile, input);
  assert.deepEqual(first, second);
  const point = freezeDeep(pointOptions());
  assert.deepEqual(evaluateClimbSensitivityPoint(profile, point), evaluateClimbSensitivityPoint(profile, point));
  first.axes.riderKg[0] = 123;
  first.axes.ftpW.push(400);
  first.baseline.assumptions.bikeKitKg = 25;
  first.grid[0][0].assumptions.effortFraction = 0.9;
  assert.deepEqual(buildClimbSensitivity(profile, input), second);
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(point, pointOptions());
});

test('uphill time increases with mass and decreases with FTP and sustained effort', () => {
  const profile = slope(100), input = options();
  const { grid } = buildClimbSensitivity(profile, input);
  grid.forEach((row, i) => row.forEach((point, j) => {
    if (i > 0) assert.ok(point.movingSeconds > grid[i - 1][j].movingSeconds);
    if (j > 0) assert.ok(point.movingSeconds < row[j - 1].movingSeconds);
  }));
  const low = evaluateClimbSensitivityPoint(profile, { ...pointOptions(), effortFraction: 0.7 });
  const high = evaluateClimbSensitivityPoint(profile, { ...pointOptions(), effortFraction: 0.9 });
  assert.ok(high.movingSeconds < low.movingSeconds);
});

test('steep descent speed-cap plateau is allowed across mass, FTP and effort', () => {
  const profile = slope(-200);
  for (const effortFraction of [0.7, 0.9]) {
    const input = { ...options(), riderKgAxis: [20, 75, 250], ftpWAxis: [30, 220, 650], effortFraction };
    const result = buildClimbSensitivity(profile, input);
    for (const point of result.grid.flat()) {
      near(point.movingSeconds, Math.hypot(1000, 200) / result.assumptions.speedCapMps);
      agrees(profile, point, input);
    }
    assert.equal(result.grid[0][0].movingSeconds, result.grid[2][2].movingSeconds);
  }
});

test('four scenarios isolate factors, reconcile exactly, and preserve baseline for all selections', () => {
  for (const effortFraction of [.7, .8, .9]) {
    const input = { ...options(), effortFraction };
    const data = freezeDeep(buildClimbSensitivity(route, input));
    const before = structuredClone(data);
    const b = input.baseline;
    for (const selection of [b, { riderKg:60, ftpW:b.ftpW }, { riderKg:b.riderKg, ftpW:300 },
      { riderKg:60, ftpW:300 }, { riderKg:90, ftpW:300 },
      { riderKg:20, ftpW:650 }, { riderKg:250, ftpW:30 },
      { riderKg:180.1234567 * .45359237, ftpW:243.125 }]) {
      const result = compareClimbSensitivity(route, data, freezeDeep(selection));
      assert.deepEqual(Object.keys(result), ['baseline', 'weight', 'ftp', 'combined']);
      const expected = [b, { riderKg:selection.riderKg, ftpW:b.ftpW },
        { riderKg:b.riderKg, ftpW:selection.ftpW }, selection];
      Object.values(result).forEach((p, i) => {
        assert.equal(p.riderKg, expected[i].riderKg);
        assert.equal(p.ftpW, expected[i].ftpW);
        agrees(route, p, input);
        const delta = p.movingSeconds - data.baseline.movingSeconds;
        assert.equal(p.deltaMinutes, delta / 60);
        assert.equal(p.deltaPercent, delta / data.baseline.movingSeconds * 100);
        assert.equal(p.direction, delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'unchanged');
        assert.equal(p.riderWattsPerKg, p.ftpW / p.riderKg);
      });
      assert.deepEqual(data, before);
    }
    const same = compareClimbSensitivity(route, data, b);
    assert.ok(Object.values(same).every(p => p.deltaMinutes === 0 && p.direction === 'unchanged'));
    const offset = compareClimbSensitivity(route, data, { riderKg:90, ftpW:300 });
    assert.equal(offset.weight.direction, 'slower');
    assert.equal(offset.ftp.direction, 'faster');
    assert.equal(offset.combined.direction, 'faster');
    assert.ok(Math.abs(offset.combined.deltaMinutes -
      (offset.weight.deltaMinutes + offset.ftp.deltaMinutes)) > .01, 'combined is not summed');
  }
});

test('on-mesh comparisons reuse exact physics without invoking the solver', () => {
  const input = { ...options(), baseline:{ riderKg:75, ftpW:220 } };
  const data = freezeDeep(buildClimbSensitivity(route, input));
  // An unusable profile would throw if any unnecessary physics were invoked.
  const result = compareClimbSensitivity(null, data, { riderKg:60, ftpW:300 });
  for (const [name, point] of [['baseline', data.baseline], ['weight', data.grid[0][1]],
    ['ftp', data.grid[1][2]], ['combined', data.grid[0][2]]]) {
    assert.equal(result[name].movingSeconds, point.movingSeconds);
  }
});

test('zero, near-rounding and plateau comparisons retain truthful signed wording', () => {
  const data = buildClimbSensitivity(route, options());
  for (const difference of [-.00001, .00001]) {
    const { combined } = compareClimbSensitivity(route, data, {
      riderKg:data.baseline.riderKg + difference, ftpW:data.baseline.ftpW,
    });
    assert.ok(Math.abs(combined.deltaMinutes) > 0 && Math.abs(combined.deltaMinutes) < .005);
    assert.equal(combined.direction, difference < 0 ? 'faster' : 'slower');
    assert.equal(formatSensitivityChange(combined.deltaMinutes), difference < 0 ? '-<0.01' : '+<0.01');
    assert.equal(formatSensitivityChange(combined.deltaPercent), difference < 0 ? '-<0.01' : '+<0.01');
  }
  for (const [value, text] of [[0, '0.00'], [-0, '0.00'], [-1.234, '-1.23'],
    [1.234, '+1.23'], [.0049, '+<0.01'], [-.0049, '-<0.01'], [.006, '+0.01']]) {
    assert.equal(formatSensitivityChange(value), text);
  }
  const profile = slope(-200), plateau = buildClimbSensitivity(profile, options());
  assert.ok(Object.values(compareClimbSensitivity(profile, plateau, { riderKg:90, ftpW:300 }))
    .every(p => p.direction === 'unchanged' && p.deltaPercent === 0));
});

test('comparisons reject invalid selections instead of clamping them', () => {
  const data = buildClimbSensitivity(route, options());
  for (const selection of [undefined, null, {}, { riderKg:75 }, { riderKg:75, ftpW:220, extra:1 },
    { riderKg:19.99, ftpW:220 }, { riderKg:250.01, ftpW:220 }, { riderKg:NaN, ftpW:220 },
    { riderKg:75, ftpW:29.99 }, { riderKg:75, ftpW:650.01 }, { riderKg:75, ftpW:Infinity },
    { riderKg:'75', ftpW:220 }]) {
    assert.throws(() => compareClimbSensitivity(route, data, selection));
  }
});
