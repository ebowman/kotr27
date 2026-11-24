// One document-wide playback owner. Renderers never integrate their own clock.
import { createRoutePlayback } from './route-playback.mjs';
const routes = new Map(), listeners = new Set();
const engine = createRoutePlayback({
  loadRoute: ({routeId, revisionId}) => {
    const route = routes.get(`${routeId}:${revisionId}`);
    if (!route) throw Error('Verified route unavailable');
    return route;
  },
});
let frame = null, notifying = false, again = false;
function publish() {
  if (notifying) { again = true; return engine.getSnapshot(); }
  notifying = true;
  try {
    do {
      again = false;
      const snapshot = engine.getSnapshot();
      for (const listener of listeners) listener(snapshot);
    } while (again);
  } finally { notifying = false; }
  const snapshot = engine.getSnapshot();
  if (snapshot.phase === 'playing' && frame === null)
    frame = requestAnimationFrame(now => { frame = null; engine.tick(now); publish(); });
  else if (snapshot.phase !== 'playing' && frame !== null) {
    cancelAnimationFrame(frame); frame = null;
  }
  return snapshot;
}
// All commands publish their exact immutable result, including loading and
// superseded asynchronous completion. No second observable distance variable.
export const routePlayback = Object.fromEntries(Object.entries(engine).map(([name, fn]) => [
  name, (...args) => {
    const result = fn(...args);
    if (name === 'getSnapshot') return result;
    const snapshot = publish();
    return typeof result?.then === 'function' ? result.then(() => publish()) : snapshot;
  },
]));
export function registerPlaybackRoute(route) {
  routes.set(`${route.identity.routeId}:${route.identity.revisionId}`, route);
}
export function subscribePlayback(listener) {
  listeners.add(listener); listener(engine.getSnapshot());
  return () => listeners.delete(listener);
}
if (typeof document !== 'undefined') {
  routePlayback.setHidden(document.hidden);
  document.addEventListener('visibilitychange', () => routePlayback.setHidden(document.hidden));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  routePlayback.setReducedMotion(motion.matches);
  motion.addEventListener('change', e => routePlayback.setReducedMotion(e.matches));
}
