// Renderer-independent distance playback. No DOM, RAF, fetching or rider model.
// One owner supplies timestamps; every consumer reads the SAME frozen snapshot.
export const animationRates = Object.freeze([0.5, 1, 2, 4]);
const cameras = ['follow', 'overview', 'side', 'cinematic'];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, end) => Math.max(0, Math.min(end, n));
function freeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.values(o).forEach(freeze);
    Object.freeze(o);
  }
  return o;
}
const copy = o => freeze(structuredClone(o));
const unavailable = reason => ({status: 'unavailable', reason});

// Preserve the example flyover's stalled-frame policy, including its tiny
// forward step after a long foreground stall. Hidden time never reaches here.
export function playbackFrameSeconds(gapMs) {
  if (!finite(gapMs) || gapMs < 0) return 0;
  return gapMs > 500 ? 1 / 60 : Math.min(0.15, gapMs / 1000);
}

/**
 * loadRoute(selection) -> Promise<PlaybackRoute>. See route-playback.md.
 * The loader owns rights/hash validation; stale success AND failure are ignored.
 * No scheduler is installed: call tick(monotonicMilliseconds) from ONE owner.
 */
export function createRoutePlayback({loadRoute, animationDurationSeconds = 150,
  reducedMotion = false, hidden = false} = {}) {
  if (typeof loadRoute !== 'function' || !finite(animationDurationSeconds) ||
      animationDurationSeconds <= 0) throw TypeError('Expected loader and positive animation duration');
  let route = null, last = null, originM = 0, originRecorded = 0, elapsedSeconds = 0;
  let state = {
    phase: 'idle', requestId: 0, selection: null, identity: null,
    position: null, distanceM: null, totalDistanceM: null, chapterId: null,
    chapters: [], previousChapterId: null, nextChapterId: null,
    animationRate: 1, animationDurationSeconds, cameraMode: 'overview',
    reducedMotion: Boolean(reducedMotion), hidden: Boolean(hidden),
    renderer: {requestId: 0, enabled: false, status: 'standby'},
    estimatedRide: unavailable('No estimate supplied'),
    recordedClock: unavailable('No recording supplied'), error: null, seekNotice: null,
  };
  let snapshot = copy(state);
  function publish() { snapshot = copy(state); return snapshot; }
  function rebase() {
    last = null; originM = state.distanceM ?? 0;
    originRecorded = state.recordedClock.elapsedSeconds ?? 0; elapsedSeconds = 0;
  }
  function pause() {
    if (state.phase === 'playing') state.phase = 'paused';
    rebase();
  }
  const usable = () => route && ['ready', 'playing', 'paused', 'finished'].includes(state.phase);
  function fail(code) {
    pause();
    state.phase = 'error';
    if (!state.position) {
      state.estimatedRide = unavailable('Route playback unavailable');
      state.recordedClock = unavailable('Route playback unavailable');
    }
    // Do not leak loader messages (URLs may contain private access tokens).
    state.error = {code, message: 'Selected route playback unavailable. Retry or choose a route explicitly.'};
    return publish();
  }
  function position(distanceM, recordedSeconds = null) {
    const replay=route.recordedReplay;
    const sourceSecond=replay ? recordedSeconds ?? replay.secondAtDistance(distanceM) : null;
    if(replay && sourceSecond===null)throw TypeError('Ambiguous recorded distance');
    const recorded = replay ? replay.atSecond(sourceSecond) :
      route.recordedAtDistance?.(distanceM) ?? unavailable('No recording supplied');
    if(replay)distanceM=recorded.distanceM;
    const p = replay ? {...recorded.position,distanceM} : route.positionAt(distanceM);
    if (!p || p.distanceM !== distanceM) throw TypeError('Adapter must preserve exact distance');
    const index = state.chapters.findIndex(c => distanceM >= c.startM &&
      (distanceM < c.endM || distanceM === state.totalDistanceM && c.endM === distanceM));
    const estimated = route.estimatedAtDistance?.(distanceM) ?? unavailable('No estimate supplied');
    // Evaluate all projections before installing a new position, atomically.
    const projected = copy({position: p, estimatedRide: estimated, recordedClock: recorded});
    Object.assign(state, projected, {distanceM, seekNotice:null, chapterId: state.chapters[index]?.id ?? null,
      previousChapterId: state.chapters[index - 1]?.id ?? null,
      nextChapterId: index < 0 ? null : state.chapters[index + 1]?.id ?? null});
  }
  function validateRoute(value, selection) {
    if (!value || value.identity?.routeId !== selection.routeId ||
        value.identity?.revisionId !== selection.revisionId ||
        !finite(value.distanceM) || value.distanceM < 0 || value.distanceM===0 && !value.recordedReplay ||
        typeof value.positionAt !== 'function' || !Array.isArray(value.chapters))
      throw TypeError('Expected matching complete playback route');
    const ids = new Set();
    for (const [i, c] of value.chapters.entries()) {
      if (typeof c.id !== 'string' || !c.id || ids.has(c.id) ||
          !finite(c.startM) || !finite(c.endM) || c.endM <= c.startM ||
          c.startM !== (i ? value.chapters[i - 1].endM : 0))
        throw TypeError('Expected ordered chapters');
      ids.add(c.id);
    }
    if (value.chapters.length && value.chapters.at(-1).endM !== value.distanceM)
      throw TypeError('Expected full chapter coverage');
  }
  async function selectRoute(selection) {
    // Capture only pinned identity and seek intent, not arbitrary/private input.
    const selected = {routeId: selection?.routeId, revisionId: selection?.revisionId};
    const distance = selection?.distanceM ?? 0, chapterId = selection?.chapterId ?? null;
    const requestId = state.requestId + 1;
    pause(); route = null;
    Object.assign(state, {requestId, selection: selected, identity: null, phase: 'loading',
      position: null, distanceM: null, totalDistanceM: null, chapterId: null,
      chapters: [], previousChapterId: null, nextChapterId: null, error: null, seekNotice:null,
      estimatedRide: unavailable('Route loading'), recordedClock: unavailable('Route loading'),
      cameraMode: 'overview',
      renderer: {requestId: state.renderer.requestId + 1, enabled: false, status: 'standby'}});
    publish();
    if (![selected.routeId, selected.revisionId].every(v => typeof v === 'string' && v.length) ||
        !finite(distance) || distance < 0 || chapterId !== null && typeof chapterId !== 'string')
      return fail('invalid-selection');
    try {
      const loaded = await loadRoute(copy(selected));
      if (requestId !== state.requestId) return snapshot;
      validateRoute(loaded, selected);
      const chapter = chapterId === null ? null : loaded.chapters.find(c => c.id === chapterId);
      if (chapterId !== null && !chapter || distance > loaded.distanceM)
        return fail('invalid-restoration');
      route = loaded;
      state.identity = copy(route.identity);
      state.totalDistanceM = route.distanceM;
      state.chapters = copy(route.chapters);
      position(chapter?.startM ?? distance,
        route.recordedReplay && chapterId===null && selection?.distanceM==null ? 0 : null);
      // Link restoration and route selection are never animation instructions.
      state.phase = chapterId !== null || distance > 0 ? 'paused' : 'ready';
      state.cameraMode = chapterId !== null || distance > 0 ? 'follow' : 'overview';
      rebase();
      return publish();
    } catch {
      if (requestId !== state.requestId) return snapshot;
      return fail('route-load');
    }
  }
  function seekDistance(value, {strict = false} = {}) {
    if (!usable()) return snapshot;
    pause();
    if (!finite(value) || strict && (value < 0 || value > state.totalDistanceM))
      return publish(); // Invalid UI draft pauses but never changes position.
    if(route.recordedReplay?.secondAtDistance(clamp(value,state.totalDistanceM))===null) {
      state.seekNotice='Distance seek unavailable at collapsed gap endpoints. Choose recorded elapsed or a sample; no gap distance inferred.';
      return publish();
    }
    try {
      position(clamp(value, state.totalDistanceM));
      state.phase = 'paused'; state.cameraMode = 'follow'; rebase();
      return publish();
    } catch { return fail('route-projection'); }
  }
  function selectChapter(id) {
    const chapter = state.chapters.find(c => c.id === id);
    if (!chapter) { pause(); return publish(); }
    return seekDistance(chapter.startM);
  }
  const api = {
    getSnapshot: () => snapshot,
    selectRoute,
    replaceRoute(value) {
      if (!usable()) return snapshot;
      validateRoute(value, state.selection);
      if (value.distanceM !== route.distanceM ||
          JSON.stringify(value.identity) !== JSON.stringify(route.identity))
        throw TypeError('Replacement must retain exact route identity and distance');
      pause();
      route = value;
      try { position(state.distanceM,route.recordedReplay ? state.recordedClock.elapsedSeconds : null); return publish(); }
      catch { return fail('route-projection'); }
    },
    seekDistance,
    seekRecordedSeconds(value) {
      if(!usable() || !route.recordedReplay || !finite(value))return snapshot;
      pause();
      try {
        position(0,value);state.phase='paused';state.cameraMode='follow';rebase();
        return publish();
      } catch { return fail('route-projection'); }
    },
    selectChapter,
    nextChapter: () => selectChapter(state.nextChapterId),
    previousChapter: () => selectChapter(state.previousChapterId),
    pause: () => { pause(); return publish(); },
    play({preserveCamera = false} = {}) {
      if (!usable() || state.hidden || state.renderer.enabled &&
          !['ready', 'flat'].includes(state.renderer.status)) return snapshot;
      if (state.phase === 'playing') return snapshot;
      try {
        if (route.recordedReplay ? state.recordedClock.elapsedSeconds===route.recordedReplay.durationSeconds :
          state.distanceM === state.totalDistanceM) position(0,route.recordedReplay ? 0 : null);
        state.phase = 'playing';
        if (!preserveCamera) state.cameraMode = 'follow';
        rebase();
        return publish();
      } catch { return fail('route-projection'); }
    },
    tick(now) {
      if (state.phase !== 'playing') return snapshot;
      if (!finite(now) || last !== null && now < last) {
        pause(); return publish();
      }
      if (last === null) { last = now; return snapshot; }
      elapsedSeconds += playbackFrameSeconds(now - last); last = now;
      try {
        if(route.recordedReplay) {
          // Source elapsed seconds, not route fraction / adjusted movie duration.
          position(0,originRecorded+elapsedSeconds*state.animationRate);
        } else position(Math.min(state.totalDistanceM, originM +
          elapsedSeconds * state.totalDistanceM / animationDurationSeconds * state.animationRate));
        if (route.recordedReplay ? state.recordedClock.elapsedSeconds===route.recordedReplay.durationSeconds :
          state.distanceM === state.totalDistanceM) { pause(); state.phase = 'finished'; }
        return publish();
      } catch { return fail('route-projection'); }
    },
    restart: () => route?.recordedReplay ? api.seekRecordedSeconds(0) : seekDistance(0),
    backToOverview() { pause(); state.cameraMode = 'overview'; return publish(); },
    setCameraMode(mode) {
      if (!cameras.includes(mode)) throw RangeError('Unknown camera mode');
      pause(); state.cameraMode = mode; return publish();
    },
    manipulate: () => { pause(); return publish(); },
    setAnimationRate(rate) {
      if (!animationRates.includes(rate)) throw RangeError('Unknown animation rate');
      pause(); state.animationRate = rate; return publish();
    },
    setHidden(value) { pause(); state.hidden = Boolean(value); return publish(); },
    setReducedMotion(value) { pause(); state.reducedMotion = Boolean(value); return publish(); },
    enable3D(enabled = true) {
      pause();
      state.renderer = {requestId: state.renderer.requestId + 1,
        enabled: Boolean(enabled), status: enabled ? 'loading' : 'standby'};
      return publish();
    },
    setRendererStatus(requestId, status) {
      if (requestId !== state.renderer.requestId || !state.renderer.enabled) return snapshot;
      if (!['loading', 'ready', 'flat', 'promoting', 'unavailable'].includes(status))
        throw RangeError('Unknown renderer status');
      if (status === state.renderer.status) return snapshot;
      pause(); state.renderer = {...state.renderer, status}; return publish();
    },
    clear() {
      pause(); route = null;
      state = {...state, phase: 'idle', requestId: state.requestId + 1, selection: null,
        identity: null, position: null, distanceM: null, totalDistanceM: null, chapterId: null,
        chapters: [], previousChapterId: null, nextChapterId: null, cameraMode: 'overview',
        renderer: {requestId: state.renderer.requestId + 1, enabled: false, status: 'standby'},
        estimatedRide: unavailable('No estimate supplied'),
        recordedClock: unavailable('No recording supplied'), error: null, seekNotice:null};
      return publish();
    },
  };
  return Object.freeze(api);
}
