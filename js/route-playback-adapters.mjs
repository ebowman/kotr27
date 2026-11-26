import { positionAt } from './route-analysis.mjs';
import { routeTimeAtDistance } from './route-time.mjs';

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
