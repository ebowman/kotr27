// Local, revision-bound duration estimates, not recorded or animation time.
// No UI/runtime entry imports this module until the downstream integration.
// Public contract, limits and D4S availability: docs/route-time.md.
import { analysisRecipe } from './route-analysis.mjs';
import { estimateEffort } from './ascent-estimator.mjs';

export const routeTimeModel = 'route-time-steady-windows-v1';
const fractions = Object.freeze({easy: 0.60, steady: 0.75, hard: 0.90});
const finite = n => typeof n === 'number' && Number.isFinite(n);
const plain = o => o !== null && typeof o === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(o));
const text = s => typeof s === 'string' && s.trim().length > 0;
function freeze(o) {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
}
const unavailable = (code, message, details = {}, identity) => freeze({
  status: 'unavailable', model: routeTimeModel, issues: [{code, message, ...details}],
  ...(identity && {identity: {...identity}}),
});

// A deliberately non-iterative reproduction of the documented 2026 job.
// Seed uses moving time at 75%, NEVER stops or the heuristic's own output.
export function allDayFraction(seedMovingSeconds) {
  if (!finite(seedMovingSeconds) || seedMovingSeconds <= 0) return null;
  const hours = seedMovingSeconds / 3600;
  return hours < 2 ? 0.80 : hours < 3 ? 0.75 : hours < 4 ? 0.70 :
    hours < 5 ? 0.65 : hours < 7 ? 0.60 : 0.55;
}

function profileFrom(analysis) {
  const a = analysis, identity = a?.identity;
  if (a?.schemaVersion !== 1 || a.recipe !== analysisRecipe ||
      a.distanceSemantics !== 'horizontal-haversine-6371000m' ||
      a.units?.distance !== 'm' || a.units?.elevation !== 'm' || a.units?.grade !== 'percent' ||
      a.processedTotals?.basis !== analysisRecipe ||
      !identity || identity.recipe !== a.recipe ||
      !text(a.routeId) || !text(a.revisionId) || !/^[a-f0-9]{64}$/.test(a.geometrySha256) ||
      !text(identity.annotationRevisionId) ||
      ['routeId', 'revisionId', 'geometrySha256'].some(k => identity[k] !== a[k]) ||
      !finite(a.distanceM) || a.distanceM <= 0 || a.distanceM > 1000000 ||
      !Array.isArray(a.windows) || a.windows.length < 1 || a.windows.length > 10000 ||
      !Array.isArray(a.chapters) || a.chapters.length < 1 ||
      a.chapters.length > a.windows.length ||
      a.chapters.at(-1)?.endM !== a.distanceM ||
      !finite(a.processedTotals.distanceM) ||
      Math.abs(a.processedTotals.distanceM - a.distanceM) > 1e-8) {
    throw new RangeError('Expected complete revision-bound horizontal route-analysis windows (≤10000, ≤1000 km)');
  }
  // The shared estimator validates coverage, continuity, elevation, run and
  // grade bounds. No resampling, rounding, reclassification or tail clipping.
  return {schemaVersion: 1, chapters: a.chapters, segments: a.windows};
}

function optionsFrom(options) {
  const keys = ['scenario', 'fraction', 'riderKg', 'bikeKitKg', 'ftpW', 'stops'];
  if (!plain(options) || Reflect.ownKeys(options).some(k => !keys.includes(k)))
    throw new TypeError('Expected plain route-time options with only supported fields');
  const scenario = Object.hasOwn(options, 'scenario') ? options.scenario : 'steady';
  if (![...Object.keys(fractions), 'all-day', 'custom'].includes(scenario) ||
      (scenario !== 'custom' && Object.hasOwn(options, 'fraction')) ||
      (scenario === 'custom' && !Object.hasOwn(options, 'fraction')))
    throw new RangeError('Choose easy, steady, hard, all-day or custom with an explicit fraction');
  const rider = {};
  for (const key of ['riderKg', 'bikeKitKg', 'ftpW'])
    if (Object.hasOwn(options, key)) rider[key] = options[key];
  return {scenario, rider, fraction: scenario === 'custom' ? options.fraction : fractions[scenario]};
}

function stopsFrom(options, profile) {
  const stops = Object.hasOwn(options, 'stops') ? options.stops : [];
  if (!Array.isArray(stops) || stops.length > 1000)
    throw new RangeError('Expected at most 1000 explicit chapter-entry stops');
  const ids = new Set(profile.chapters.map(c => c.id)), byChapter = new Map();
  let total = 0;
  for (const stop of stops) {
    if (!plain(stop) || Reflect.ownKeys(stop).some(k => !['chapterId', 'seconds'].includes(k)) ||
        !ids.has(stop.chapterId) || byChapter.has(stop.chapterId) ||
        !finite(stop.seconds) || stop.seconds < 0 || stop.seconds > 86400)
      throw new RangeError('Stops require a unique current chapterId and 0–86400 finite seconds');
    total += stop.seconds;
    if (total > 86400) throw new RangeError('Total planned stops must not exceed 86400 seconds');
    byChapter.set(stop.chapterId, stop.seconds);
  }
  return byChapter;
}

function timedResult(analysis, estimate, stops, assumptions) {
  let moving = 0, work = 0, stopped = 0;
  const intervals = [], chapters = [];
  for (let i = 0; i < estimate.chapters.length; i++) {
    const c = estimate.chapters[i], source = analysis.chapters[i];
    const stopSeconds = stops.get(c.id) ?? 0;
    const priorStopSeconds = stopped;
    const arrivalSeconds = moving + stopped;
    stopped += stopSeconds;
    const departureSeconds = moving + stopped;
    if (stopSeconds) {
      const first = c.windows[0];
      intervals.push({chapterId: c.id, status: 'stopped',
        startSeconds: arrivalSeconds, endSeconds: departureSeconds,
        startM: first.startM, endM: first.startM,
        startElevationM: first.startElevationM, endElevationM: first.startElevationM,
        movingStartSeconds: moving, movingEndSeconds: moving,
        pedalWorkStartKJ: work, pedalWorkEndKJ: work, stopSecondsBefore: priorStopSeconds});
    }
    let localSeconds = 0, localWork = 0;
    for (const w of c.windows) {
      const movingStartSeconds = moving + localSeconds, pedalWorkStartKJ = work + localWork;
      localSeconds += w.movingSeconds; localWork += w.pedalWorkKJ;
      intervals.push({...w, chapterId: c.id, status: 'moving',
        startSeconds: movingStartSeconds + stopped, endSeconds: moving + localSeconds + stopped,
        movingStartSeconds, movingEndSeconds: moving + localSeconds,
        pedalWorkStartKJ, pedalWorkEndKJ: work + localWork, stopSecondsBefore: stopped});
    }
    // Exactly the estimator's summation order; never sum rounded durations or
    // derive moving time by subtracting a stop from an elapsed timestamp.
    moving += c.movingSeconds; work += c.pedalWorkKJ;
    chapters.push({id: c.id, kind: source.kind, startM: source.startM, endM: source.endM,
      movingSeconds: c.movingSeconds, pedalWorkKJ: c.pedalWorkKJ, stopSeconds,
      elapsedSeconds: c.movingSeconds + stopSeconds, arrivalSeconds, departureSeconds,
      cumulative: {movingSeconds: moving, pedalWorkKJ: work,
        stopSeconds: stopped, elapsedSeconds: moving + stopped}});
  }
  return freeze({schemaVersion: 1, status: 'available', model: routeTimeModel,
    identity: {...analysis.identity}, distanceM: analysis.distanceM,
    elevationBasis: analysisRecipe, assumptions: {...assumptions, stopSeconds: stopped},
    chapters, intervals,
    total: {...estimate.total, stopSeconds: stopped, elapsedSeconds: moving + stopped}});
}

/**
 * Accept the supported snapshot from analyzeRoute/loadRouteAnalysis, not raw
 * points or source-listed totals. Invalid input returns no partial estimate.
 * Stops are explicit durations at chapter entry; never inferred from POIs.
 */
export function estimateRouteTime(analysis, options = {}) {
  if (analysis?.status !== 'supported')
    return unavailable('unsupported-analysis', 'Supported geometry and elevation analysis required; no flat fallback');
  let profile, resolved, stops;
  try { profile = profileFrom(analysis); }
  catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    return unavailable('invalid-analysis', error.message);
  }
  try { resolved = optionsFrom(options); }
  catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    return unavailable('invalid-options', error.message);
  }
  try { stops = stopsFrom(options, profile); }
  catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    return unavailable('invalid-stops', error.message);
  }
  let estimate, seedMovingSeconds = null;
  const {scenario, rider} = resolved;
  let {fraction} = resolved;
  try {
    if (scenario === 'all-day') {
      const seed = estimateEffort(profile, {...rider, fraction: 0.75});
      seedMovingSeconds = seed.total.movingSeconds;
      fraction = allDayFraction(seedMovingSeconds);
      estimate = fraction === 0.75 ? seed : estimateEffort(profile, {...rider, fraction});
    } else estimate = estimateEffort(profile, {...rider, fraction});
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    return unavailable('model-domain', error.message, error.details, analysis.identity);
  }
  const defaultedInputs = ['riderKg', 'bikeKitKg', 'ftpW'].filter(k => !Object.hasOwn(rider, k));
  const assumptions = {...estimate.assumptions, scenario, defaultedInputs,
    allDay: scenario === 'all-day' ? {seedFraction: 0.75, seedMovingSeconds,
      resolvedFraction: fraction, method: 'single-pass-duration-bands-v1'} : null,
    limitations: [
      'Constant-effort comparison, not a sustainability or physiological prediction; 90% is not sustainable for every duration.',
      'Mechanical pedal work is not food calories; no peak-power inference.',
      'Still air, fixed drag/rolling resistance and 45 km/h cap; no fatigue, heat, cornering, traffic or acceleration.',
      'All Day uses discontinuous duration bands seeded at 75%, not a physiological claim.',
      'Only explicitly supplied stops count; these do not assert facility availability.',
    ]};
  return timedResult(analysis, estimate, stops, assumptions);
}

/** Distance seek chooses ARRIVAL at a stop; time within a pause is ambiguous. */
export function routeTimeAtDistance(result, distanceM) {
  if (result?.status !== 'available' || result.model !== routeTimeModel)
    return unavailable('unavailable-estimate', 'A current route-time result is required');
  if (!finite(distanceM) || distanceM < 0 || distanceM > result.distanceM)
    return unavailable('invalid-distance', 'Distance outside this revision');
  if (distanceM === result.distanceM)
    return {status: 'available', identity: result.identity, distanceM, ...result.total};
  const w = result.intervals.find(w => w.status === 'stopped' ?
    distanceM === w.startM : distanceM >= w.startM && distanceM < w.endM);
  const f = w.status === 'stopped' ? 0 : (distanceM - w.startM) / (w.endM - w.startM);
  const movingSeconds = w.movingStartSeconds + f * (w.movingSeconds ?? 0);
  const elapsedSeconds = movingSeconds + w.stopSecondsBefore;
  return {status: 'available', identity: result.identity, distanceM,
    movingSeconds, elapsedSeconds, stopSeconds: w.stopSecondsBefore,
    pedalWorkKJ: w.pedalWorkStartKJ + f * (w.pedalWorkKJ ?? 0)};
}
