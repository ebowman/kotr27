// Pure document-memory model. No wall clock, I/O, storage, RAF or map ownership.
import {solveWindowMotion} from './ascent-estimator.mjs';
import {estimateRouteTime, routeTimeAtDistance} from './route-time.mjs';
import {createRouteClock} from './ride-clock.mjs';
import {validateRider} from './rider-scenario.mjs';
import {positionAt} from './route-analysis.mjs';

export const rideSimulationModel = 'ride-simulation-quasi-steady-v1';
export const simulationStepSeconds = 0.02;
const freeze = o => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(freeze); Object.freeze(o);
  }
  return o;
};
export const exampleDrivetrain = freeze({
  frontTeeth: [34, 50], rearTeeth: [11, 13, 15, 17, 19, 21, 24, 28, 32, 34],
  circumferenceM: 2.105, defaultGear: {frontTeeth: 34, rearTeeth: 28},
});
const plain = o => o !== null && typeof o === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(o));
function fields(o, keys) {
  if (!plain(o) || Reflect.ownKeys(o).some(k => !keys.includes(k)))
    throw TypeError(`Expected only: ${keys.join(', ')}`);
}
function number(n, low, high, label) {
  if (!Number.isFinite(n) || n < low || n > high) throw RangeError(`Invalid ${label}`);
  return n;
}
function gearFrom(value) {
  fields(value, ['frontTeeth', 'rearTeeth']);
  const {frontTeeth, rearTeeth} = value;
  if (!exampleDrivetrain.frontTeeth.includes(frontTeeth) ||
      !exampleDrivetrain.rearTeeth.includes(rearTeeth)) throw RangeError('Invalid example gear');
  return {frontTeeth, rearTeeth};
}
const unavailable = (issues, identity) => freeze({status: 'unavailable', modelVersion: rideSimulationModel,
  ...(identity && {identity: {...identity}}), issues, unavailableReasons: issues.map(i => i.message)});

// Text-entry bridge to the existing rider validator. Never discard invalid
// fields into an empty (example) rider; callers must retain unavailable status.
export function rideRiderFromInput(input) {
  try {
    fields(input, ['mass', 'enteredUnit', 'ftp']);
    const validation = validateRider({mass: input.mass, enteredUnit: input.enteredUnit,
      ftp: input.ftp, effort: 'slower'});
    if (validation.kind === 'invalid')
      return unavailable(Object.entries(validation.errors).map(([field, message]) => ({field, message})));
    const rider = {};
    for (const key of ['riderKg', 'ftpW'])
      if (Object.hasOwn(validation.options, key)) rider[key] = validation.options[key];
    return freeze({status: 'available', rider, kind: validation.kind});
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    return unavailable([{code: 'invalid-rider', message: error.message}]);
  }
}

/**
 * Numeric rider fields use route-time validation; omission is an explicitly
 * labelled example field. Changing route/rider/model creates a NEW instance.
 * Explore follows createRouteClock; Experiment integrates the same solutions.
 */
export function createRideSimulation(options) {
  let base, analysis, mode, originM, initialGear;
  try {
    fields(options, ['analysis', 'rider', 'scenario', 'fraction', 'stops', 'mode',
      'originM', 'gear', 'modelVersion']);
    if (Object.hasOwn(options, 'modelVersion') && options.modelVersion !== rideSimulationModel)
      throw RangeError('Unsupported simulation model version');
    // Validate the owned geometry that will actually be queried. Cloning
    // after validation could erase non-enumerable required geometry fields.
    analysis = freeze(structuredClone(options.analysis));
    mode = Object.hasOwn(options, 'mode') ? options.mode : 'experiment';
    if (!['explore', 'experiment'].includes(mode)) throw RangeError('Invalid simulation mode');
    const rider = Object.hasOwn(options, 'rider') ? options.rider : {};
    fields(rider, ['riderKg', 'bikeKitKg', 'ftpW']);
    const timeOptions = {};
    for (const key of ['riderKg', 'bikeKitKg', 'ftpW'])
      if (Object.hasOwn(rider, key)) timeOptions[key] = rider[key];
    for (const key of ['scenario', 'fraction', 'stops'])
      if (Object.hasOwn(options, key)) timeOptions[key] = options[key];
    base = estimateRouteTime(analysis, timeOptions);
    if (base.status !== 'available') return unavailable(base.issues, base.identity);
    originM = Object.hasOwn(options, 'originM') ? options.originM : 0;
    number(originM, 0, base.distanceM, 'origin distance');
    initialGear = gearFrom(Object.hasOwn(options, 'gear') ? options.gear : exampleDrivetrain.defaultGear);
    // route-time validates windows, not the position query's point axis.
    // Require complete analyzed geometry; do not reconstruct or repair it.
    if (!Array.isArray(analysis.points) || analysis.points.length < 2 ||
        analysis.points[0]?.distanceM !== 0 || analysis.points.at(-1)?.distanceM !== base.distanceM ||
        analysis.points.some((p, i, all) => !p ||
          !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 ||
          !Number.isFinite(p.lon) || Math.abs(p.lon) > 180 ||
          !Number.isFinite(p.elevationM) || !Number.isFinite(p.distanceM) ||
          (i > 0 && p.distanceM <= all[i - 1].distanceM)))
      throw RangeError('Complete analyzed position geometry required; no repair');
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError || error.name === 'DataCloneError')) throw error;
    return unavailable([{code: 'invalid-options', message: error.message}]);
  }
  const assumptions = freeze({...base.assumptions, drivetrain: exampleDrivetrain,
    motion: 'quasi-steady-no-inertia', coast: 'instant equilibrium; no momentum',
    speedCap: 'model bound, not safe-speed advice'});
  const modelIdentity = freeze({route: {...base.identity}, modelVersion: rideSimulationModel,
    assumptions, mode});
  const defaulted = base.assumptions.defaultedInputs;
  const source = defaulted.length === 3 ? 'example-model' : 'personal-model';
  const provenance = freeze({telemetry: source, distance: 'processed-route', grade: 'processed-route',
    rider: Object.fromEntries(['riderKg', 'bikeKitKg', 'ftpW'].map(k =>
      [k, defaulted.includes(k) ? 'example-model' : 'personal-model'])),
    drivetrain: 'example-model', recorded: false});
  const units = freeze({distanceM: 'horizontal m', speedMps: 'road m/s',
    horizontalSpeedMps: 'horizontal m/s', simulationSeconds: 's', pedalPowerW: 'W',
    targetPowerW: 'W', pedalWorkKJ: 'kJ', grade: 'rise/run', cadenceRpm: 'rpm', crankTorqueNm: 'N m'});
  const clock = createRouteClock(base), intervals = base.intervals;
  const cache = new Map();
  let distanceM, seconds, workKJ, index, stopRemaining, playing = false, sequence = 0;
  let control, initialControl = {fraction: base.assumptions.fraction, gear: initialGear};
  let history = [], pending = [];

  function motionAt(i, fraction) {
    const key = `${i}:${fraction}`;
    if (!cache.has(key)) {
      const w = intervals[i];
      cache.set(key, solveWindowMotion(w.endM - w.startM, w.endElevationM - w.startElevationM,
        assumptions.systemKg, assumptions.ftpW * fraction));
      // Bound document-memory use under many custom effort changes.
      if (cache.size > 20000) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  function reset(distance, controls) {
    playing = false; distanceM = distance; control = structuredClone(controls);
    index = intervals.findIndex(w => w.status === 'stopped' ? w.startM === distance :
      distance >= w.startM && distance < w.endM);
    if (index < 0) index = intervals.length;
    stopRemaining = intervals[index]?.status === 'stopped' ? intervals[index].endSeconds - intervals[index].startSeconds : 0;
    const arrival = routeTimeAtDistance(base, distance);
    seconds = mode === 'explore' ? arrival.elapsedSeconds : 0;
    workKJ = mode === 'explore' ? arrival.pedalWorkKJ : 0;
    history = []; pending = []; sequence++;
  }
  reset(originM, initialControl);

  function snapshot() {
    const finished = distanceM === base.distanceM;
    const w = intervals[Math.min(index, intervals.length - 1)];
    const stopped = !finished && w.status === 'stopped';
    const gradeWindow = stopped ? intervals[index + 1] : w;
    const motion = finished || stopped ? null : motionAt(index, control.fraction);
    const speedMps = motion?.speedMps ?? 0, pedalPowerW = motion?.pedalPowerW ?? 0;
    // At a gravity-only cap there is no delivered pedal work, hence no
    // invented pedaling/cadence even if the requested effort remains positive.
    const cadenceRpm = pedalPowerW > 0 ? speedMps * 60 /
      (exampleDrivetrain.circumferenceM * control.gear.frontTeeth / control.gear.rearTeeth) : 0;
    return freeze({schemaVersion: 1, status: 'available', identity: base.identity, modelIdentity,
      modelVersion: rideSimulationModel, mode, sequence, trialOriginM: originM,
      phase: finished ? 'finished' : playing ? 'playing' : 'paused',
      motion: finished ? 'finished' : stopped ? 'planned-stop' : motion.stalled ? 'stalled' : 'moving',
      simulationSeconds: seconds, distanceM, position: positionAt(analysis, distanceM),
      chapterId: w.chapterId, speedMps, horizontalSpeedMps: motion?.horizontalSpeedMps ?? 0,
      grade: (gradeWindow.endElevationM - gradeWindow.startElevationM) / (gradeWindow.endM - gradeWindow.startM),
      targetPowerW: assumptions.ftpW * control.fraction, pedalPowerW,
      effortFraction: control.fraction, coast: control.fraction === 0, capped: motion?.capped ?? false,
      cadenceRpm, crankTorqueNm: cadenceRpm > 0 ? pedalPowerW / (2 * Math.PI * cadenceRpm / 60) : null,
      gear: {...control.gear}, pedalWorkKJ: workKJ, historyLength: history.length,
      // Only a steady Explore run has a remaining-arrival estimate.
      remainingSeconds: mode === 'explore' ? base.total.elapsedSeconds - seconds : finished ? 0 : null,
      assumptions, provenance, units, unavailableReasons: []});
  }
  function applyCommands() {
    while (pending.length && pending[0].atSeconds <= seconds) {
      const action = pending.shift();
      if (action.type === 'gear') control.gear = {...action.value};
      else control.fraction = action.type === 'coast' ? 0 : action.value;
      history.push(action);
    }
  }
  function advanceExperiment(dt) {
    const end = seconds + dt;
    while (seconds < end && index < intervals.length) {
      applyCommands();
      const limit = Math.min(end, pending[0]?.atSeconds ?? end);
      const w = intervals[index];
      if (w.status === 'stopped') {
        const used = Math.min(limit - seconds, stopRemaining);
        seconds += used; stopRemaining -= used;
        if (stopRemaining === 0) index++;
      } else {
        const motion = motionAt(index, control.fraction);
        if (motion.stalled) { seconds = limit; continue; }
        const toBoundary = (w.endM - distanceM) / motion.horizontalSpeedMps;
        const used = Math.min(limit - seconds, toBoundary);
        seconds += used; workKJ += motion.pedalPowerW * used / 1000;
        if (used === toBoundary) {
          distanceM = w.endM; index++;
          if (intervals[index]?.status === 'stopped')
            stopRemaining = intervals[index].endSeconds - intervals[index].startSeconds;
        } else distanceM += motion.horizontalSpeedMps * used;
      }
    }
    applyCommands();
  }
  const api = {
    status: 'available', modelVersion: rideSimulationModel, modelIdentity,
    snapshot,
    play() { if (distanceM < base.distanceM) playing = true; sequence++; return snapshot(); },
    pause() { playing = false; sequence++; return snapshot(); },
    advance(dt) {
      number(dt, 0, 86400, 'step seconds (0–86400)');
      if (!playing || dt === 0) return snapshot();
      if (mode === 'experiment') advanceExperiment(dt);
      else {
        seconds = Math.min(seconds + dt, clock.finishSeconds);
        const position = clock.atSecond(seconds);
        distanceM = position.distanceM;
        index = intervals.findIndex(w => seconds < w.endSeconds);
        if (index < 0) index = intervals.length;
        const w = intervals[index];
        workKJ = w ? w.pedalWorkStartKJ + (w.pedalWorkEndKJ - w.pedalWorkStartKJ) *
          (seconds - w.startSeconds) / (w.endSeconds - w.startSeconds) : base.total.pedalWorkKJ;
      }
      if (distanceM === base.distanceM) playing = false;
      sequence++;
      return snapshot();
    },
    command(action) {
      if (mode !== 'experiment') throw RangeError('Live controls require a new Experiment trial');
      if (distanceM === base.distanceM) throw RangeError('Seek or restart the finished trial');
      fields(action, ['type', 'value', 'atSeconds']);
      if (!['effort', 'gear', 'coast'].includes(action.type)) throw RangeError('Unknown ride command');
      const value = action.type === 'gear' ? gearFrom(action.value) :
        action.type === 'effort' ? number(action.value, .4, .9, 'FTP fraction') : null;
      if (action.type === 'coast' && Object.hasOwn(action, 'value')) throw RangeError('Coast has no value');
      const atSeconds = Object.hasOwn(action, 'atSeconds') ?
        number(action.atSeconds, seconds, Number.MAX_SAFE_INTEGER, 'command time') : seconds;
      pending.push(freeze({type: action.type, value, atSeconds}));
      pending.sort((a, b) => a.atSeconds - b.atSeconds); // stable order for equal times
      // A command at the current boundary changes the shared physical solution,
      // not the clock. Future commands remain queued, including while paused.
      // History keeps every same-time action in order for frozen strategy replay.
      if (atSeconds === seconds) { applyCommands(); sequence++; }
      return snapshot();
    },
    seek(distance) {
      number(distance, 0, base.distanceM, 'seek distance');
      originM = distance;
      initialControl = structuredClone(control);
      reset(distance, initialControl);
      return snapshot();
    },
    restart() { reset(originM, initialControl); return snapshot(); },
    // Frozen recipe for a later pinned-history consumer, NOT a ghost/UI engine.
    // Only applied actions are included; beyond the last, hold that control.
    exportTrial() {
      return freeze({schemaVersion: 1, modelIdentity, trialOriginM: originM,
        initialControl: structuredClone(initialControl), history: structuredClone(history),
        capturedSeconds: seconds, stops: base.chapters.filter(c => c.stopSeconds)
          .map(c => ({chapterId: c.id, seconds: c.stopSeconds}))});
    },
  };
  return Object.freeze(api);
}

/** Pure fixed-step wall-time adapter; caller supplies monotonic timestamps in ms.
 * Visibility/manual movement call pause(). Seek/restart/externally paused model
 * sequence changes rebase on the next frame, never interpolate old positions.
 */
export function createSimulationScheduler(simulation, {rate = 16} = {}) {
  if (simulation?.status !== 'available') throw TypeError('Available simulation required');
  const checkRate = n => { if (![1, 4, 16, 60].includes(n)) throw RangeError('Invalid playback rate'); };
  checkRate(rate);
  let anchor = null, debt = 0, current = simulation.snapshot(), previous = current, notice = null;
  function rebase() { anchor = null; debt = 0; current = simulation.snapshot(); previous = current; }
  const state = steps => freeze({previous, current, alpha: debt / simulationStepSeconds, steps, rate, notice});
  return Object.freeze({
    play() { simulation.play(); notice = null; rebase(); return state(0); },
    pause() { simulation.pause(); rebase(); return state(0); },
    setRate(value) { checkRate(value); rate = value; simulation.pause(); rebase(); return state(0); },
    frame(timestampMs) {
      number(timestampMs, 0, Number.MAX_SAFE_INTEGER, 'frame timestamp');
      if (simulation.snapshot().sequence !== current.sequence) rebase();
      if (current.phase !== 'playing') { rebase(); return state(0); }
      if (anchor === null) { anchor = timestampMs; return state(0); }
      const gap = timestampMs - anchor;
      if (gap < 0 || gap > 250) {
        simulation.pause(); notice = gap < 0 ? 'non-monotonic-frame' : 'stalled-frame';
        rebase(); return state(0);
      }
      anchor = timestampMs;
      debt += gap / 1000 * rate;
      const steps = Math.min(750, Math.floor((debt + 1e-10) / simulationStepSeconds));
      let completed = 0;
      for (; completed < steps && current.phase === 'playing'; completed++) {
        previous = current; current = simulation.advance(simulationStepSeconds);
      }
      debt = Math.max(0, debt - completed * simulationStepSeconds);
      if (current.phase !== 'playing') rebase();
      return state(completed);
    },
  });
}
