import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {analyzeRoute} from '../js/route-analysis.mjs';
import {loadRouteAnalysis} from '../js/route-analysis-loader.mjs';
import {estimateRouteTime, routeTimeAtDistance} from '../js/route-time.mjs';
import {estimateAscent} from '../js/ascent-estimator.mjs';
import {createRouteClock} from '../js/ride-clock.mjs';
import {createRideSimulation, createSimulationScheduler, rideSimulationModel,
  rideRiderFromInput, exampleDrivetrain} from '../js/ride-simulation.mjs';
import {readRoutePack} from '../tools/route-pack.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) <= epsilon, `${a} vs ${b}`);
const binding = {routeId: 'fixture', revisionId: 'fixture-v1', geometrySha256: 'a'.repeat(64)};
const points = (rise = 100, length = 2000) => Array.from({length: length / 100 + 1}, (_, i) =>
  ({lat: 0, lon: i * 100 / 6371000 * 180 / Math.PI, elevationM: 1000 + rise * i * 100 / length}));
const slope = (rise = 100, length = 2000) => analyzeRoute({...binding, points: points(rise, length)});
const available = model => {
  assert.equal(model.status, 'available', JSON.stringify(model.issues));
  return model;
};
const make = options => available(createRideSimulation({analysis: slope(), ...options}));
const run = (model, seconds = 86400) => {model.play(); return model.advance(seconds);};
const physical = s => [s.distanceM, s.simulationSeconds, s.pedalWorkKJ, s.speedMps, s.cadenceRpm];
const compare = (a, b, eps = 1e-7) => physical(a).forEach((v, i) => near(v, physical(b)[i], eps));

test('positive motion reconciles legacy estimates, shared Explore clock and horizontal projection', () => {
  for (const rise of [-400, -70, -20, 0, 200, 900]) {
    const analysis = slope(rise);
    for (const scenario of ['easy', 'steady', 'hard', 'all-day']) {
      const base = available(estimateRouteTime(analysis, {scenario}));
      const live = make({analysis, scenario}), explore = make({analysis, scenario, mode: 'explore'});
      const dt = base.total.elapsedSeconds * .41;
      const a = run(live, dt), b = run(explore, dt);
      compare(a, b);
      near(a.distanceM, createRouteClock(base).atSecond(dt).distanceM);
      const end = live.advance(86400);
      near(end.simulationSeconds, base.total.elapsedSeconds);
      near(end.pedalWorkKJ, base.total.pedalWorkKJ);
      assert.equal(end.distanceM, analysis.distanceM);
      assert.equal(end.phase, 'finished');
      assert.deepEqual(live.advance(5), end);
      if (scenario === 'steady') {
        const old = estimateAscent({schemaVersion: 1, chapters: analysis.chapters, segments: analysis.windows});
        near(end.simulationSeconds, old.total.faster.movingSeconds);
        near(end.pedalWorkKJ, old.total.faster.pedalWorkKJ);
      }
    }
  }
  const sim = make({analysis: slope(900)});
  const s = run(sim, 10);
  const w = slope(900).windows[0], runM = w.endM - w.startM, riseM = w.endElevationM - w.startElevationM;
  near(s.distanceM, s.speedMps * 10 * runM / Math.hypot(runM, riseM));
  assert.ok(s.distanceM < s.speedMps * 10);
  near(s.pedalWorkKJ, s.pedalPowerW * 10 / 1000);
  const road = s.distanceM * Math.hypot(runM, riseM) / runM;
  const height = s.distanceM * riseM / runM;
  near(s.pedalWorkKJ * 1000 * .95,
    87 * 9.81 * (height + .005 * s.distanceM) + .21 * s.speedMps ** 2 * road);
});

test('mass/power trends, mechanical gear/cadence/torque tradeoff and example provenance', () => {
  const normal = run(make(), 40), heavy = run(make({rider: {riderKg: 90}}), 40);
  const hard = run(make({scenario: 'hard'}), 40);
  assert.ok(heavy.distanceM < normal.distanceM && hard.distanceM > normal.distanceM);
  assert.equal(normal.targetPowerW, 165);
  assert.equal(normal.provenance.telemetry, 'example-model');
  assert.equal(heavy.provenance.telemetry, 'personal-model');
  assert.deepEqual(heavy.provenance.rider,
    {riderKg: 'personal-model', bikeKitKg: 'example-model', ftpW: 'example-model'});
  assert.equal(normal.provenance.recorded, false);
  assert.equal('heartRate' in normal, false);
  assert.deepEqual(exampleDrivetrain.rearTeeth, [11, 13, 15, 17, 19, 21, 24, 28, 32, 34]);
  const sim = make();
  sim.command({type: 'gear', value: {frontTeeth: 34, rearTeeth: 34}});
  const easier = run(sim, 40);
  near(easier.distanceM, normal.distanceM); near(easier.pedalWorkKJ, normal.pedalWorkKJ);
  near(easier.cadenceRpm / normal.cadenceRpm, 34 / 28);
  near(easier.crankTorqueNm * easier.cadenceRpm * 2 * Math.PI / 60, easier.pedalPowerW);
  assert.ok(easier.crankTorqueNm < normal.crankTorqueNm);
  near(easier.cadenceRpm, easier.speedMps * 60 / 2.105);
});

test('coast stalls on flat/uphill, counts finite elapsed with zero work, and effort resumes in place', () => {
  for (const rise of [0, 200]) {
    const sim = make({analysis: slope(rise)});
    sim.command({type: 'coast'});
    const stalled = run(sim, 500);
    assert.equal(stalled.motion, 'stalled');
    assert.equal(stalled.phase, 'playing');
    assert.equal(stalled.simulationSeconds, 500);
    assert.equal(stalled.distanceM, 0); assert.equal(stalled.pedalWorkKJ, 0);
    assert.equal(stalled.cadenceRpm, 0); assert.equal(stalled.crankTorqueNm, null);
    assert.equal(stalled.remainingSeconds, null);
    sim.command({type: 'gear', value: {frontTeeth: 50, rearTeeth: 11}});
    assert.equal(sim.advance(20).motion, 'stalled');
    sim.command({type: 'effort', value: .75});
    const resumed = sim.advance(20);
    assert.ok(resumed.distanceM > 0);
    assert.equal(resumed.simulationSeconds, 540);
    near(resumed.pedalWorkKJ, 165 * 20 / 1000);
  }
});

test('downhill coast equilibrates without work; cap explicitly reduces delivered watts', () => {
  for (const rise of [-20, -400]) {
    const sim = make({analysis: slope(rise)});
    sim.command({type: 'coast'});
    const s = run(sim, 10);
    assert.ok(s.distanceM > 0 && s.speedMps <= 12.5);
    assert.equal(s.cadenceRpm, 0); assert.equal(s.pedalWorkKJ, 0);
    assert.equal(s.pedalPowerW, 0); assert.equal(s.coast, true);
    assert.equal(s.capped, rise === -400);
  }
  const partial = run(make({analysis: slope(-70)}), 10);
  assert.equal(partial.speedMps, 12.5); assert.equal(partial.capped, true);
  assert.ok(partial.pedalPowerW > 0 && partial.pedalPowerW < partial.targetPowerW);
  near(partial.pedalWorkKJ, partial.pedalPowerW * 10 / 1000);
  const gravityOnly = run(make({analysis: slope(-400)}), 10);
  assert.equal(gravityOnly.pedalPowerW, 0); assert.equal(gravityOnly.cadenceRpm, 0);
});

test('chapter stops and windows split steps; arrival/departure and exact finish match route-time', () => {
  const analysis = analyzeRoute({...binding, points: points(0, 4000).map((p, i) =>
    ({...p, elevationM: 1000 + Math.min(i, 40 - i) * 10}))});
  assert.ok(analysis.chapters.length > 1);
  const stops = analysis.chapters.map(c => ({chapterId: c.id, seconds: 7.25}));
  const base = available(estimateRouteTime(analysis, {stops}));
  for (const mode of ['experiment', 'explore']) {
    for (const chapter of base.chapters) {
      const fromStart = make({analysis, stops, mode});
      fromStart.play();
      assert.equal(fromStart.advance(chapter.arrivalSeconds).motion, 'planned-stop');
      assert.equal(fromStart.advance(chapter.stopSeconds).motion, 'moving');
      const sim = make({analysis, stops, mode, originM: chapter.startM});
      assert.equal(sim.snapshot().motion, 'planned-stop');
      const before = sim.snapshot();
      const during = run(sim, 7);
      assert.equal(during.distanceM, chapter.startM);
      assert.equal(during.pedalWorkKJ, before.pedalWorkKJ);
      assert.equal(during.motion, 'planned-stop');
      assert.equal(sim.advance(.25).motion, 'moving');
      assert.ok(sim.advance(.1).distanceM > chapter.startM);
    }
    const sim = make({analysis, stops, mode});
    const end = run(sim);
    near(end.simulationSeconds, base.total.elapsedSeconds);
    near(end.pedalWorkKJ, base.total.pedalWorkKJ);
    assert.equal(end.distanceM, analysis.distanceM);
  }
});

test('commands use simulation times, split large steps and export immutable replayable applied history', () => {
  const analysis = slope();
  const actions = [
    {type: 'effort', value: .9, atSeconds: 7.123},
    {type: 'coast', atSeconds: 12},
    {type: 'gear', value: {frontTeeth: 50, rearTeeth: 11}, atSeconds: 13},
    {type: 'effort', value: .6, atSeconds: 30},
  ];
  const a = make({analysis}), b = make({analysis});
  for (const action of actions) {a.command(action); b.command(action);}
  const saved = a.snapshot();
  const large = run(a, 50); b.play();
  for (let i = 0; i < 2500; i++) b.advance(.02);
  compare(large, b.snapshot());
  assert.equal(saved.simulationSeconds, 0); assert.equal(saved.historyLength, 0);
  const pin = a.exportTrial();
  assert.deepEqual(pin.history.map(x => x.atSeconds), [7.123, 12, 13, 30]);
  assert.ok(Object.isFrozen(pin.history[2].value));
  assert.throws(() => {pin.history[2].value.rearTeeth = 17;}, TypeError);
  a.command({type: 'effort', value: .8}); a.advance(10);
  assert.equal(pin.history.length, 4);
  const replay = make({analysis});
  for (const {type, value, atSeconds} of pin.history)
    replay.command({type, ...(type !== 'coast' && {value}), atSeconds});
  compare(run(replay, pin.capturedSeconds), large);
});

test('rapid due-now paused choices change physical feedback/history without time, distance or work', () => {
  const sim = make(), original = sim.snapshot();
  const unchanged = s => {
    assert.equal(s.phase, 'paused');
    assert.deepEqual([s.distanceM, s.simulationSeconds, s.pedalWorkKJ],
      [original.distanceM, original.simulationSeconds, original.pedalWorkKJ]);
  };
  sim.command({type:'coast', atSeconds:5}); // Must not be flushed with due-now choices.
  let s = sim.command({type:'effort', value:.9});
  unchanged(s); assert.equal(s.pedalPowerW,198); assert.ok(s.speedMps>original.speedMps);
  const hardSpeed = s.speedMps, hardCadence = s.cadenceRpm, hardTorque = s.crankTorqueNm;
  s = sim.command({type:'gear', value:{frontTeeth:34,rearTeeth:34}});
  unchanged(s); assert.equal(s.speedMps,hardSpeed);
  assert.ok(s.cadenceRpm>hardCadence); assert.ok(s.crankTorqueNm<hardTorque);
  s = sim.command({type:'coast'});
  unchanged(s); assert.equal(s.motion,'stalled');
  assert.equal(s.pedalPowerW,0); assert.equal(s.cadenceRpm,0); assert.equal(s.speedMps,0);
  s = sim.command({type:'effort', value:.6, atSeconds:0});
  unchanged(s); assert.equal(s.pedalPowerW,132); assert.equal(s.historyLength,4);
  assert.deepEqual(sim.exportTrial().history.map(a=>[a.type,a.atSeconds]),
    [['effort',0],['gear',0],['coast',0],['effort',0]]);
  const pin = sim.exportTrial(), replay = make();
  for (const {type,value,atSeconds} of pin.history)
    replay.command({type,atSeconds,...(type !== 'coast' && {value})});
  compare(sim.snapshot(),replay.snapshot());
  compare(run(sim,4),run(replay,4));
  assert.equal(sim.advance(1).motion,'stalled');
  assert.equal(sim.snapshot().historyLength,5);
  assert.equal(pin.history.length,4,'Frozen history excludes the future action');
  const restarted=sim.restart();
  unchanged(restarted);assert.equal(restarted.effortFraction,.75);
  assert.deepEqual(restarted.gear,original.gear);assert.equal(restarted.historyLength,0);
});

test('paused choices at a nonzero scheduler boundary resume coherently; future commands keep their time', () => {
  const sim=make(), scheduler=createSimulationScheduler(sim,{rate:1});
  scheduler.play();scheduler.frame(0);scheduler.frame(100);scheduler.pause();
  const paused=sim.snapshot();
  sim.command({type:'effort',value:.9,atSeconds:paused.simulationSeconds+.1});
  sim.command({type:'coast'});
  sim.command({type:'effort',value:.6});
  const current=sim.snapshot();
  assert.equal(current.simulationSeconds,paused.simulationSeconds);
  assert.equal(current.distanceM,paused.distanceM);assert.equal(current.pedalWorkKJ,paused.pedalWorkKJ);
  assert.equal(current.pedalPowerW,132);
  assert.equal(scheduler.frame(500).current.pedalPowerW,132);
  scheduler.play();scheduler.frame(1000);scheduler.frame(1080);
  assert.equal(sim.snapshot().pedalPowerW,132);
  scheduler.frame(1120);
  near(sim.snapshot().simulationSeconds,paused.simulationSeconds+.12);
  assert.equal(sim.snapshot().pedalPowerW,198);
  near(sim.snapshot().pedalWorkKJ-paused.pedalWorkKJ,(132*.1+198*.02)/1000);
});

test('pause, seeks, restart and changed inputs never retrofit completed trial history', () => {
  const analysis = slope(), sim = make({analysis});
  sim.command({type: 'effort', value: .9});
  const old = run(sim, 20), pin = sim.exportTrial();
  sim.pause();
  const paused = sim.snapshot();
  assert.deepEqual(sim.advance(100), paused);
  sim.command({type: 'coast', atSeconds: 100});
  const seek = sim.seek(1000);
  assert.equal(seek.phase, 'paused'); assert.equal(seek.simulationSeconds, 0);
  assert.equal(seek.pedalWorkKJ, 0); assert.equal(seek.historyLength, 0);
  assert.equal(seek.effortFraction, .9);
  const next = run(sim, 120);
  assert.ok(next.distanceM > 1000); assert.equal(next.coast, false);
  const restarted = sim.restart();
  assert.equal(restarted.distanceM, 1000); assert.equal(restarted.simulationSeconds, 0);
  assert.equal(restarted.phase, 'paused');
  compare(run(sim, 120), next);
  assert.equal(old.distanceM, pin.capturedSeconds * old.horizontalSpeedMps);
  assert.equal(pin.trialOriginM, 0);
  const changed = make({analysis, rider: {ftpW: 250}});
  assert.notDeepEqual(changed.modelIdentity, sim.modelIdentity);
  assert.equal(changed.snapshot().distanceM, 0);
  const changedRoute = make({analysis: {...analysis, revisionId: 'fixture-v2',
    identity: {...analysis.identity, revisionId: 'fixture-v2'}}});
  assert.notDeepEqual(changedRoute.modelIdentity, sim.modelIdentity);
  const explore = make({analysis, mode: 'explore'});
  const arrival = routeTimeAtDistance(estimateRouteTime(analysis), 1000);
  const e = explore.seek(1000);
  assert.equal(e.simulationSeconds, arrival.elapsedSeconds);
  assert.equal(e.pedalWorkKJ, arrival.pedalWorkKJ);
  assert.equal(e.phase, 'paused');
  assert.throws(() => explore.command({type: 'coast'}), /Experiment/);
  assert.equal(sim.seek(analysis.distanceM).motion, 'finished');
  assert.equal(sim.play().phase, 'finished');
});

test('fixed steps produce identical state at 30/60/120Hz and 1/4/16/60× playback', () => {
  let reference;
  for (const hz of [30, 60, 120]) for (const rate of [1, 4, 16, 60]) {
    const sim = make();
    sim.command({type: 'effort', value: .9, atSeconds: 5});
    sim.command({type: 'coast', atSeconds: 10});
    sim.command({type: 'effort', value: .6, atSeconds: 20});
    const scheduler = createSimulationScheduler(sim, {rate});
    scheduler.play(); scheduler.frame(0);
    const wallMs = 60000 / rate, frames = Math.round(wallMs * hz / 1000);
    for (let i = 1; i <= frames; i++) {
      const frame = scheduler.frame(i * wallMs / frames);
      assert.ok(frame.steps <= 750);
      assert.ok(frame.alpha >= 0 && frame.alpha < 1);
    }
    const end = sim.snapshot();
    near(end.simulationSeconds, 60);
    if (!reference) reference = end;
    else assert.deepEqual(physical(end), physical(reference));
    assert.deepEqual(sim.exportTrial().history, [
      {type: 'effort', value: .9, atSeconds: 5},
      {type: 'coast', value: null, atSeconds: 10},
      {type: 'effort', value: .6, atSeconds: 20},
    ]);
  }
});

test('scheduler late/hidden/rate/seek rebases discard debt and cannot catch up or interpolate across discontinuities', () => {
  const sim = make(), scheduler = createSimulationScheduler(sim, {rate: 60});
  scheduler.play(); scheduler.frame(0);
  assert.equal(scheduler.frame(250).steps, 750);
  const before = sim.snapshot();
  const late = scheduler.frame(501);
  assert.equal(late.notice, 'stalled-frame'); assert.equal(late.current.phase, 'paused');
  compare(before, late.current);
  assert.equal(late.alpha, 0); assert.deepEqual(late.previous, late.current);
  scheduler.frame(10000); compare(before, sim.snapshot());
  scheduler.play(); scheduler.frame(20000);
  assert.equal(scheduler.frame(20001).steps, 3);
  const rate = scheduler.setRate(4);
  assert.equal(rate.current.phase, 'paused'); assert.equal(rate.alpha, 0);
  scheduler.play(); scheduler.frame(30000); scheduler.frame(30001); // fractional debt
  const seek = sim.seek(1000);
  const rebased = scheduler.frame(30002);
  assert.deepEqual(rebased.current, seek); assert.deepEqual(rebased.previous, seek);
  assert.equal(rebased.alpha, 0);
  scheduler.play(); scheduler.frame(40000);
  assert.equal(scheduler.frame(39999).notice, 'non-monotonic-frame');
  scheduler.pause(); assert.equal(sim.snapshot().phase, 'paused');
});

test('rider text bridge rejects unsupported containers/fields rather than silently selecting examples', () => {
  const example = {mass: '', ftp: '', enteredUnit: 'kg'};
  for (const input of [
    null, undefined, 'rider', 75, [], Object.assign([], example),
    new Map(Object.entries(example)), Object.create(example),
    Object.assign(Object.create({ftpW: NaN}), example),
    {...example, ftpW: NaN}, {...example, bikeKitKg: -20},
    {...example, riderKg: 75}, {...example, effort: 'invalid'},
    {...example, effort: 'slower'}, {...example, effort: undefined},
    {...example, [Symbol('unsupported')]: 1},
    Object.defineProperty({...example}, 'ftpW', {value: NaN}),
  ]) {
    const result = rideRiderFromInput(input);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.issues[0].code, 'invalid-rider');
    assert.equal(result.rider, undefined);
  }
  assert.deepEqual(rideRiderFromInput(example),
    {status: 'available', rider: {}, kind: 'example'});
  assert.deepEqual(rideRiderFromInput(Object.assign(Object.create(null), example)),
    rideRiderFromInput(example));
  assert.deepEqual(example, {mass: '', ftp: '', enteredUnit: 'kg'});
});

test('rider text bridge preserves supplied values for validation, including non-enumerable fields', () => {
  const valid = {mass: '75', ftp: '220', enteredUnit: 'kg'};
  for (const patch of [{mass: undefined}, {mass: NaN}, {mass: '-20'},
    {ftp: undefined}, {ftp: NaN}, {ftp: '0'}, {enteredUnit: undefined}, {enteredUnit: 'stone'}]) {
    const input = {...valid, ...patch};
    assert.equal(rideRiderFromInput(input).status, 'unavailable');
    assert.deepEqual(input, {...valid, ...patch});
  }
  const input = Object.defineProperty({...valid}, 'ftp', {value: '230', enumerable: false});
  assert.deepEqual(rideRiderFromInput(input),
    {status: 'available', rider: {riderKg: 75, ftpW: 230}, kind: 'personal'});
  assert.equal(rideRiderFromInput({...valid, mass: ''}).kind, 'partial');
});

test('numeric rider normalization retains non-enumerable own values and supplied provenance', () => {
  for (const [field, value] of [['ftpW', 250], ['riderKg', 85], ['bikeKitKg', 16]]) {
    const rider = Object.defineProperty({}, field, {value});
    const model = make({rider}), normal = make({rider: {[field]: value}});
    assert.equal(model.snapshot().assumptions[field], value);
    assert.equal(model.snapshot().provenance.rider[field], 'personal-model');
    assert.ok(!model.snapshot().assumptions.defaultedInputs.includes(field));
    compare(run(model, 10), run(normal, 10));
    assert.equal(Object.keys(rider).length, 0);
    assert.equal(rider[field], value);
  }
  for (const [field, value] of [['ftpW', NaN], ['ftpW', undefined], ['ftpW', '250'],
    ['bikeKitKg', -20], ['bikeKitKg', null], ['riderKg', Infinity], ['riderKg', 19]]) {
    const rider = Object.defineProperty({}, field, {value});
    const result = createRideSimulation({analysis: slope(), rider});
    assert.equal(result.status, 'unavailable');
    assert.equal(result.issues[0].code, 'model-domain');
    assert.equal(result.snapshot, undefined);
  }
});

test('non-enumerable constructor/runtime gear teeth survive normalization, history and reset', () => {
  const gear = Object.defineProperties({}, {
    frontTeeth: {value: 34}, rearTeeth: {value: 28},
  });
  const expected = {frontTeeth: 34, rearTeeth: 28};
  const finiteGear = s => {
    assert.deepEqual(s.gear, expected);
    for (const field of ['speedMps', 'horizontalSpeedMps', 'pedalPowerW', 'cadenceRpm',
      'crankTorqueNm', 'distanceM', 'simulationSeconds', 'pedalWorkKJ'])
      assert.ok(Number.isFinite(s[field]), field);
    near(s.cadenceRpm, s.speedMps * 60 / (2.105 * 34 / 28));
  };
  const constructor = make({gear});
  finiteGear(constructor.snapshot());
  finiteGear(run(constructor, 10));
  assert.deepEqual(constructor.exportTrial().initialControl.gear, expected);
  finiteGear(constructor.restart());
  const runtime = make({gear: {frontTeeth: 50, rearTeeth: 11}});
  runtime.command({type: 'gear', value: gear});
  finiteGear(run(runtime, 10));
  assert.deepEqual(runtime.exportTrial().history[0].value, expected);
  finiteGear(runtime.seek(500));
  finiteGear(runtime.restart());
  assert.equal(Object.keys(gear).length, 0);
  for (const [frontTeeth, rearTeeth] of [[NaN, 28], [34, 12], [34, undefined]]) {
    const invalid = Object.defineProperties({}, {
      frontTeeth: {value: frontTeeth}, rearTeeth: {value: rearTeeth},
    });
    assert.equal(createRideSimulation({analysis: slope(), gear: invalid}).status, 'unavailable');
    const before = runtime.snapshot();
    assert.throws(() => runtime.command({type: 'gear', value: invalid}), /Invalid example gear/);
    assert.deepEqual(runtime.snapshot(), before);
  }
});

test('owned geometry is validated after cloning, never accepted then stripped of required fields', () => {
  for (const edit of [
    a => Object.defineProperty(a, 'points', {enumerable: false}),
    a => Object.defineProperty(a.points[0], 'lat', {enumerable: false}),
    a => Object.defineProperty(a.identity, 'revisionId', {enumerable: false}),
    a => {a.points[0].lat = () => 0;},
  ]) {
    const analysis = structuredClone(slope()); edit(analysis);
    const result = createRideSimulation({analysis});
    assert.equal(result.status, 'unavailable');
    assert.equal(result.snapshot, undefined);
  }
});

test('invalid inputs never silently default; missing geometry/elevation stays unavailable', () => {
  for (const rider of [null, [], {ftpW: undefined}, {riderKg: 19}, {ftpW: '220'},
    {bikeKitKg: NaN}, {ftpW: 651}, {riderKg: 251}, {bikeKitKg: 61}, {watts: 200}])
    assert.equal(createRideSimulation({analysis: slope(), rider}).status, 'unavailable');
  for (const options of [{scenario: undefined}, {fraction: .8}, {originM: -1}, {mode: 'actual'},
    {modelVersion: 'other'}, {gear: {frontTeeth: 35, rearTeeth: 28}}, {stops: undefined}])
    assert.equal(createRideSimulation({analysis: slope(), ...options}).status, 'unavailable');
  for (const analysis of [null, {}, analyzeRoute({...binding,
    points: points().map((p, i) => i === 3 ? {...p, elevationM: null} : p)}),
    {...slope(), points: []}, {...slope(), points: undefined}])
    assert.equal(createRideSimulation({analysis}).status, 'unavailable');
  assert.equal(rideRiderFromInput({mass: 'bad', enteredUnit: 'kg', ftp: '220'}).status, 'unavailable');
  const personal = available(rideRiderFromInput({mass: '165', enteredUnit: 'lb', ftp: '230'}));
  near(personal.rider.riderKg, 165 * .45359237);
  assert.equal(make({rider: personal.rider}).snapshot().assumptions.ftpW, 230);
  const sim = make(), before = sim.snapshot();
  for (const command of [{type: 'effort', value: .91}, {type: 'effort', value: 0},
    {type: 'coast', value: 0}, {type: 'gear', value: {frontTeeth: 34, rearTeeth: 12}},
    {type: 'coast', atSeconds: -1}, {type: 'unknown'}])
    assert.throws(() => sim.command(command));
  for (const dt of [-1, NaN, Infinity, '1']) assert.throws(() => sim.advance(dt));
  assert.deepEqual(before, sim.snapshot());
  assert.equal(before.modelVersion, rideSimulationModel);
  assert.ok(Object.isFrozen(before.position));
});

test('all seven route-pack capabilities: six complete simulations, Brentha Standard rejects ±50% domain unchanged', async () => {
  const {pack} = await readRoutePack(root);
  let supported = 0, rejected = 0;
  for (const route of pack.catalog.routes) {
    const analysis = await loadRouteAnalysis({pack, routeId: route.id, revisionId: route.currentRevisionId,
      readAsset: path => readFile(new URL(`../${path}`, import.meta.url))});
    assert.equal(analysis.status, 'supported');
    const before = JSON.stringify(analysis);
    const sim = createRideSimulation({analysis});
    if (route.id === 'rwgps-57874050') {
      rejected++;
      assert.equal(sim.status, 'unavailable');
      assert.equal(sim.issues[0].code, 'model-domain');
      assert.equal(sim.issues[0].field, 'window grade');
      assert.deepEqual(analysis.windows.filter(w => Math.abs(w.gradePercent) > 50)
        .map(w => [w.startM, w.endM]), [[25500, 25750], [26000, 26250]]);
      assert.equal(sim.snapshot, undefined);
    } else {
      supported++;
      available(sim);
      const end = run(sim), base = estimateRouteTime(analysis);
      assert.equal(end.distanceM, analysis.distanceM);
      assert.equal(end.phase, 'finished');
      near(end.simulationSeconds, base.total.elapsedSeconds, 1e-6);
      near(end.pedalWorkKJ, base.total.pedalWorkKJ, 1e-6);
      if (route.id === 'rwgps-57873019') {
        const climb = analysis.chapters.find(c => c.id === 'chapter-22');
        assert.deepEqual([climb.startM, climb.endM], [10750, 20500]);
        const start = routeTimeAtDistance(base, climb.startM);
        const finish = routeTimeAtDistance(base, climb.endM);
        const duration = finish.elapsedSeconds - start.elapsedSeconds;
        const trial = make({analysis, originM: climb.startM});
        trial.play();
        const steps = Math.floor(duration / .02);
        for (let i = 0; i < steps; i++) trial.advance(.02);
        const top = trial.advance(duration - trial.snapshot().simulationSeconds);
        near(top.distanceM, climb.endM, 1e-6);
        near(top.simulationSeconds, duration, 1e-6);
        near(top.pedalWorkKJ, finish.pedalWorkKJ - start.pedalWorkKJ, 1e-6);
        const allDay = make({analysis, scenario: 'all-day', originM: climb.startM}).snapshot();
        const whole = estimateRouteTime(analysis, {scenario: 'all-day'});
        assert.equal(allDay.effortFraction, whole.assumptions.fraction);
        assert.deepEqual(allDay.assumptions.allDay, whole.assumptions.allDay);
      }
    }
    assert.equal(JSON.stringify(analysis), before);
  }
  assert.equal(supported, 6); assert.equal(rejected, 1);
});
