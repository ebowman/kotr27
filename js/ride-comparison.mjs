// Frozen, document-memory strategy comparison. No RAF, clock, fetch or storage.
// Physics, stops and work remain owned by ride-simulation / route-time.
import {createRideSimulation} from './ride-simulation.mjs';

export const comparisonLimits = Object.freeze({seconds:86400, history:1024, segments:8192, windows:2048});
const freeze = o => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(freeze);Object.freeze(o);
  }
  return o;
};
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const unavailable = reason => Object.freeze({status:'unavailable',reason});
function optionsFor(analysis,trial) {
  const {assumptions:a,mode,modelVersion} = trial.modelIdentity;
  const rider = Object.fromEntries(['riderKg','bikeKitKg','ftpW']
    .filter(k=>!a.defaultedInputs.includes(k)).map(k=>[k,a[k]]));
  return {analysis,rider,mode,modelVersion,originM:trial.trialOriginM,
    scenario:a.scenario,...(a.scenario === 'custom' ? {fraction:a.fraction} : {}),
    gear:trial.initialControl.gear,stops:trial.stops};
}
const actionFor = fraction => fraction === 0 ? {type:'coast'} : {type:'effort',value:fraction};

/**
 * Compile once per APPLIED strategy change, not per animation frame.
 * A second shared simulation is only a control-boundary motion probe: flush its
 * command near route start, then seek to the exact queried position. This avoids
 * inventing physics or changing the reviewed next-step command semantics.
 * The replay itself advances exactly at window/stop/command boundaries and
 * records indexed linear segments. No time-stepping through an entire route.
 */
export function indexRideTrial({analysis,trial}) {
  if (!trial || trial.modelIdentity?.mode !== 'experiment' ||
      !same(analysis?.identity,trial.modelIdentity.route))
    return unavailable('Experiment on the same route revision required.');
  if (trial.history.length > comparisonLimits.history || analysis.windows.length > comparisonLimits.windows ||
      trial.capturedSeconds > comparisonLimits.seconds)
    return unavailable('Comparison limit reached: 24 ride hours, 1,024 applied actions or 2,048 route windows.');
  const recipe = freeze(structuredClone(trial)), options = optionsFor(analysis,recipe);
  const model = createRideSimulation(options);
  const probe = createRideSimulation({...options,originM:0,stops:[]});
  if (model.status !== 'available' || probe.status !== 'available')
    return unavailable('Frozen strategy model unavailable.');
  const initial = recipe.initialControl.fraction;
  if (model.snapshot().motion !== 'finished') {
    model.command(actionFor(initial));
    for (const action of recipe.history) {
      const {type,value,atSeconds} = action;
      model.command({type,atSeconds,...(type === 'coast' ? {} : {value})});
    }
  }
  model.play();
  let probeFraction, fraction = initial, actionIndex = 0, windowIndex = 0;
  let stopRemaining = 0, stopDistance = -1;
  const stops = new Map(recipe.stops.map(stop=>[
    analysis.chapters.find(c=>c.id === stop.chapterId).startM,stop.seconds,
  ]));
  const segments = [];
  let s = model.snapshot();
  while (s.motion !== 'finished' && s.simulationSeconds < comparisonLimits.seconds) {
    if (segments.length >= comparisonLimits.segments)
      return unavailable('Comparison segment limit reached; remove or start a shorter trial.');
    while (recipe.history[actionIndex]?.atSeconds <= s.simulationSeconds) {
      const action = recipe.history[actionIndex++];
      if (action.type !== 'gear') fraction = action.type === 'coast' ? 0 : action.value;
    }
    let dt = Math.min(comparisonLimits.seconds-s.simulationSeconds,
      (recipe.history[actionIndex]?.atSeconds ?? comparisonLimits.seconds)-s.simulationSeconds);
    if (s.motion === 'planned-stop') {
      if (stopDistance !== s.distanceM) {
        stopDistance = s.distanceM;stopRemaining = stops.get(s.distanceM);
      }
      dt = Math.min(dt,stopRemaining);
    } else {
      while (analysis.windows[windowIndex]?.endM <= s.distanceM) windowIndex++;
      if (probeFraction !== fraction) {
        probe.seek(0);probe.command(actionFor(fraction));probe.play();probe.advance(.02);
        probeFraction = fraction;
      }
      const motion = probe.seek(s.distanceM);
      if (motion.horizontalSpeedMps > 0)
        dt = Math.min(dt,(analysis.windows[windowIndex].endM-s.distanceM)/motion.horizontalSpeedMps);
    }
    if (!(dt > 0) || !Number.isFinite(dt)) return unavailable('Strategy boundary unavailable; no inferred arrival.');
    // At a window boundary a sub-ULP dt can round back to the same elapsed
    // value. Advance one representable clock quantum through the SHARED model;
    // never snap distance/work or spin on an unrepresentable remaining time.
    dt = Math.max(dt,Number.EPSILON*Math.max(1,s.simulationSeconds)*2);
    const next = model.advance(dt);
    segments.push({startSeconds:s.simulationSeconds,endSeconds:next.simulationSeconds,
      startM:s.distanceM,endM:next.distanceM,
      startWorkKJ:s.pedalWorkKJ,endWorkKJ:next.pedalWorkKJ});
    if (s.motion === 'planned-stop') stopRemaining -= dt;
    s = next;
  }
  const end = s;
  // Lower-bound search retains the FIRST arrival at a stationary distance:
  // a planned stop's departure must never become its arrival.
  function lower(key,value) {
    let lo=0,hi=segments.length;
    while (lo<hi) {const mid=(lo+hi)>>>1;if (segments[mid][key]<value) lo=mid+1;else hi=mid;}
    return lo;
  }
  function interpolate(segment,ratio) {
    return {distanceM:segment.startM+(segment.endM-segment.startM)*ratio,
      simulationSeconds:segment.startSeconds+(segment.endSeconds-segment.startSeconds)*ratio,
      pedalWorkKJ:segment.startWorkKJ+(segment.endWorkKJ-segment.startWorkKJ)*ratio};
  }
  return Object.freeze({
    status:'available',recipe,segmentCount:segments.length,
    finishSeconds:end.motion === 'finished' ? end.simulationSeconds : null,
    atSecond(seconds) {
      if (!Number.isFinite(seconds) || seconds<0 || seconds>comparisonLimits.seconds) return null;
      const segment = segments[lower('endSeconds',seconds)];
      return segment ? interpolate(segment,(seconds-segment.startSeconds)/(segment.endSeconds-segment.startSeconds)) :
        {distanceM:end.distanceM,simulationSeconds:seconds,pedalWorkKJ:end.pedalWorkKJ};
    },
    arrivalAt(distanceM) {
      if (!Number.isFinite(distanceM) || distanceM<recipe.trialOriginM || distanceM>end.distanceM) return null;
      if (distanceM === recipe.trialOriginM) return {distanceM,simulationSeconds:0,pedalWorkKJ:0};
      const segment = segments[lower('endM',distanceM)];
      return segment && segment.endM>segment.startM ?
        interpolate(segment,(distanceM-segment.startM)/(segment.endM-segment.startM)) : null;
    },
  });
}

/**
 * Caller supplies its existing scheduler's PRESENTED elapsed and distance.
 * sync() takes exportTrial only after an applied history change. Effort/gear
 * stay within the identity; seek/restart/model changes clear the active pin.
 * The returned recipe remains frozen even after the owner removes the pin.
 */
export function createRideComparison({analysis,trial}) {
  const baseline = indexRideTrial({analysis,trial});
  if (baseline.status !== 'available') return baseline;
  let live = baseline, builds = 1;
  const compatible = other => same(other.modelIdentity,baseline.recipe.modelIdentity) &&
    other.trialOriginM === baseline.recipe.trialOriginM;
  return Object.freeze({
    status:'available',recipe:baseline.recipe,
    sync(trial) {
      if (!compatible(trial)) return unavailable('Route, rider/model or trial origin changed. Baseline cleared.');
      if (!same(live.recipe.history,trial.history) || !same(live.recipe.initialControl,trial.initialControl)) {
        live = indexRideTrial({analysis,trial});builds++;
      }
      return live.status === 'available' ? {status:'available'} : live;
    },
    sample(snapshot,{seconds=snapshot.simulationSeconds,distanceM=snapshot.distanceM}={}) {
      if (!compatible(snapshot)) return unavailable('Route, rider/model or trial origin changed. Baseline cleared.');
      if (live.status !== 'available') return live;
      const ghost = baseline.atSecond(seconds);
      if (!ghost) return unavailable('24 ride-hour comparison horizon reached. Remove or start a new trial.');
      const commonM = Math.min(distanceM,ghost.distanceM);
      const a = live.arrivalAt(commonM), b = baseline.arrivalAt(commonM);
      return freeze({status:'available',seconds,ghost,
        distanceDeltaM:distanceM-ghost.distanceM,commonM,
        arrivalDeltaSeconds:a && b ? a.simulationSeconds-b.simulationSeconds : null,
        // Mechanical pedal work at that SAME common reached distance.
        pedalWorkDeltaKJ:a && b ? a.pedalWorkKJ-b.pedalWorkKJ : null,
        baselineFinishSeconds:baseline.finishSeconds});
    },
    diagnostics() { return {builds,baselineSegments:baseline.segmentCount,liveSegments:live.segmentCount}; },
  });
}
