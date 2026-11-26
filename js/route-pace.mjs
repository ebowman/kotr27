// Document-memory scenario owner. No I/O, storage, scheduler or position clock.
import { estimateRouteTime } from './route-time.mjs';
import { estimateEffort } from './ascent-estimator.mjs';

export const paceScenarios = Object.freeze({easy:'Easy · 60%', steady:'Steady · 75%',
  hard:'Hard · 90%', 'all-day':'All Day · duration heuristic'});
const identityKey = a => JSON.stringify(a.identity);
const unavailable = reason => ({status:'unavailable', issues:[{message:reason}]});
export function createRoutePace() {
  let scenario = 'steady', rider = {}, invalid = false;
  const cache = new Map(), stops = new Map(), listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };
  function model(a, choice = scenario) {
    if (!a?.identity) return unavailable('Selected profile unavailable');
    if (invalid) return unavailable('Correct or clear rider inputs; navigation remains available');
    const options = {...rider, scenario:choice, stops:stops.get(identityKey(a)) ?? []};
    const key = JSON.stringify([a.identity, options]);
    if (!cache.has(key)) {
      cache.set(key, estimateRouteTime(a, options));
      if (cache.size > 32) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  return {
    model,
    forgetRoute(routeId) {
      for(const key of cache.keys()) if(JSON.parse(key)[0].routeId===routeId) cache.delete(key);
      for(const key of stops.keys()) if(JSON.parse(key).routeId===routeId) stops.delete(key);
    },
    snapshot: () => ({scenario, rider:{...rider}, invalid}),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setRider(validation, reset = false) {
      const next = {};
      for (const k of ['riderKg','ftpW'])
        if (Object.hasOwn(validation.options ?? {}, k)) next[k] = validation.options[k];
      const bad = validation.kind === 'invalid';
      const changed = bad !== invalid || JSON.stringify(next) !== JSON.stringify(rider);
      rider = next; invalid = bad;
      if (reset) { scenario = 'steady'; stops.clear(); cache.clear(); }
      if (changed || reset) emit();
    },
    setScenario(value) {
      if (!Object.hasOwn(paceScenarios,value)) throw RangeError('Unknown pace scenario');
      if (value !== scenario) { scenario = value; emit(); }
    },
    stopsFor: a => structuredClone(stops.get(identityKey(a)) ?? []),
    setStop(a, chapterId, seconds) {
      if (!a.chapters.some(c => c.id === chapterId) || !Number.isFinite(seconds) ||
          seconds < 0 || seconds > 86400) throw RangeError('Invalid chapter stop');
      const next = (stops.get(identityKey(a)) ?? []).filter(s => s.chapterId !== chapterId);
      if (seconds) next.push({chapterId,seconds});
      if (next.reduce((n,s)=>n+s.seconds,0)>86400) throw RangeError('Stops exceed one day');
      stops.set(identityKey(a),next); emit();
    },
    trip(rows, analyses) {
      const total = {movingSeconds:0, stopSeconds:0, elapsedSeconds:0, pedalWorkKJ:0};
      const missing = [];
      for (const row of rows) {
        const a = analyses.get(row.choice.revisionId);
        const result = row.status === 'ready' && a?.routeId === row.choice.routeId ? model(a) : null;
        if (result?.status !== 'available') { missing.push(row.choice.routeId); continue; }
        for (const k of ['movingSeconds','stopSeconds','pedalWorkKJ']) total[k] += result.total[k];
      }
      total.elapsedSeconds = total.movingSeconds + total.stopSeconds;
      return {total, missing, selected:rows.length};
    },
  };
}
export const routePace = createRoutePace();

// Exact selected chapter or whole route; no grade repair, truncation or new
// detection. Shift the distance origin only, retaining original signed rises.
export function sensitivityProfile(a, chapterId = null) {
  const source = a;
  const segments = source?.segments ?? source?.windows;
  const chapters = chapterId ? source?.chapters.filter(c=>c.id===chapterId) : source?.chapters;
  if (!segments || !chapters?.length) return unavailable('Selected profile unavailable');
  const start = chapters[0].startM, end = chapters.at(-1).endM;
  const windows = segments.filter(w=>w.startM>=start && w.endM<=end);
  if (windows.length > 500) return unavailable('Sensitivity limited to 500 windows; choose a shorter section');
  const profile = {schemaVersion:1,
    chapters:chapters.map(c=>({...c,startM:c.startM-start,endM:c.endM-start})),
    segments:windows.map(w=>({...w,startM:w.startM-start,endM:w.endM-start}))};
  try { estimateEffort(profile); }
  catch (error) {
    if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
    return unavailable(`Sensitivity unavailable: ${error.message}. Unverified processed input; not repaired.`);
  }
  return {status:'available', profile, key:JSON.stringify([a.identity,chapterId])};
}

export const formatDuration = seconds => `${(seconds/60).toFixed(1)} min`;
