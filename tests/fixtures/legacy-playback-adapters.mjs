// Test-only adapter for historical clock/geometry regression fixtures. Never shipped.
import { positionAt } from '../../js/route-analysis.mjs';
import { routeTimeAtDistance } from '../../js/route-time.mjs';
import { exampleCatalog, exampleRouteId } from '../../js/example-catalog.mjs';

const identityKeys = ['routeId', 'revisionId', 'geometrySha256', 'recipe', 'annotationRevisionId'];
const sameIdentity = (a, b) => a && b && identityKeys.every(k => a[k] === b[k]);
const unavailable = reason => ({status: 'unavailable', reason});

// No new estimator, recorded-time interpolation or clock. Recording providers
// must return explicit unavailable/ambiguous states for gaps and repeated times.
function recordingProjection(recording, identity) {
  if (!recording) return () => unavailable('No recording supplied');
  if (!sameIdentity(recording.identity, identity) || typeof recording.atDistance !== 'function')
    throw TypeError('Recording must be bound to the exact route analysis identity');
  return distanceM => recording.atDistance(distanceM);
}

export function createAnalysisPlaybackRoute(analysis, {estimate, recording} = {}) {
  if (analysis?.status !== 'supported') throw TypeError('Supported route analysis required');
  if ((estimate?.status === 'available' || estimate?.identity) &&
      !sameIdentity(estimate.identity, analysis.identity))
    throw TypeError('Estimate belongs to a different route analysis identity');
  // Shared analysis/model outputs are immutable. No cloned/smoothed geometry.
  return Object.freeze({
    identity: analysis.identity, distanceM: analysis.distanceM, chapters: analysis.chapters,
    positionAt: distanceM => positionAt(analysis, distanceM),
    estimatedAtDistance: distanceM => estimate?.status === 'available' ?
      routeTimeAtDistance(estimate, distanceM) : estimate ?? unavailable('No estimate supplied'),
    recordedAtDistance: recordingProjection(recording, analysis.identity),
  });
}

// The old example uses exact track distances with a millimetre-rounded profile.
// Keep the raw endpoint and authored chapter starts, not a rescaled official axis.
export function createSemonzoPlaybackRoute(points, profile, {estimate} = {}) {
  if (!Array.isArray(points) || points.length < 2 || !profile?.chapters?.length)
    throw TypeError('Example track and authored profile required');
  const track = points.map(p => ({...p}));
  const distanceM = track.at(-1).distanceM;
  if (track[0].distanceM !== 0 || !Number.isFinite(distanceM) || distanceM <= 0 ||
      Math.abs(distanceM - profile.distanceM) > 0.001 ||
      track.some((p, i) => !['distanceM', 'lat', 'lon', 'height'].every(k => Number.isFinite(p[k])) ||
        i > 0 && p.distanceM <= track[i - 1].distanceM))
    throw TypeError('Expected unchanged ordered example geometry');
  const {revision} = exampleCatalog.resolve(exampleRouteId);
  const identity = Object.freeze({routeId: exampleRouteId, revisionId: revision.id,
    geometrySha256: revision.geometrySha256, recipe: 'semonzo-chapters-v1',
    annotationRevisionId: 'none'});
  const chapters = profile.chapters.map((c, i) => Object.freeze({...c,
    endM: i === profile.chapters.length - 1 ? distanceM : c.endM}));
  if (estimate?.identity && !sameIdentity(estimate.identity, identity))
    throw TypeError('Example estimate identity mismatch');
  return Object.freeze({identity, distanceM, chapters: Object.freeze(chapters),
    // The verified legacy profile rounds only the endpoint to millimetres.
    // Map that endpoint exactly, without changing intermediate seek distances.
    estimatedAtDistance: d => estimate?.status === 'available' ?
      routeTimeAtDistance(estimate, d === distanceM ? profile.distanceM : Math.min(d, profile.distanceM)) :
      estimate ?? unavailable('No estimate supplied'),
    positionAt(d) {
      let a = 0, b = track.length - 1;
      while (b - a > 1) {
        const mid = (a + b) >> 1;
        if (track[mid].distanceM < d) a = mid; else b = mid;
      }
      const p = track[a], q = track[b], f = (d - p.distanceM) / (q.distanceM - p.distanceM);
      const mix = k => p[k] + f * (q[k] - p[k]);
      return {identity, distanceM: d, lat: mix('lat'), lon: mix('lon'), rawElevationM: mix('height')};
    },
  });
}

// Operation adapter only; replace (never run alongside) the old flyover's d,
// playing, last and RAF clock at integration. No DOM or camera choreography.
export function createLegacyFlyoverAdapter(controller) {
  return Object.freeze({
    scrub: value => controller.seekDistance(value),
    arrow: delta => controller.seekDistance((controller.getSnapshot().distanceM ?? 0) + delta),
    reset() { controller.restart(); return controller.backToOverview(); },
    toggle() {
      return controller.getSnapshot().phase === 'playing' ? controller.pause() : controller.play();
    },
    tick: now => controller.tick(now),
    visibility: hidden => controller.setHidden(hidden),
    // readSelection already rejects malformed links and resolves example identity.
    selection: resolved => resolved.code === 'ready' ?
      controller.selectRoute(resolved.state) : controller.clear(),
  });
}
