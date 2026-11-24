import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRoutePlayback, playbackFrameSeconds } from '../js/route-playback.mjs';
import { createAnalysisPlaybackRoute, createSemonzoPlaybackRoute,
  createLegacyFlyoverAdapter } from '../js/route-playback-adapters.mjs';
import { analyzeRoute } from '../js/route-analysis.mjs';
import { estimateRouteTime, routeTimeAtDistance } from '../js/route-time.mjs';
import { createRideClock, createRouteClock } from '../js/ride-clock.mjs';
import { riderScenario } from '../js/rider-scenario.mjs';
import { readSelection } from '../js/route-state.mjs';
import { exampleCatalog } from '../js/example-catalog.mjs';
import { readExampleTrack } from '../js/semonzo-profile.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';

const deg = m => m / 6371000 * 180 / Math.PI;
function analysis(routeId = 'fixture') {
  return analyzeRoute({routeId, revisionId: `${routeId}-v1`, geometrySha256: 'a'.repeat(64),
    points: Array.from({length: 21}, (_, i) =>
      ({lat: 0, lon: deg(i * 100), elevationM: 100 + (i <= 10 ? i : 20 - i) * 5}))});
}
const a = analysis(), route = createAnalysisPlaybackRoute(a);
const selection = {routeId: a.routeId, revisionId: a.revisionId};
const near = (x, y, tolerance = 1e-8) => assert.ok(Math.abs(x - y) < tolerance, `${x} != ${y}`);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
async function ready(options = {}, selected = selection) {
  const c = createRoutePlayback({loadRoute: async () => route, ...options});
  await c.selectRoute(selected);
  return c;
}
// One fake monotonic clock, like the future single RAF owner.
function time(c) {
  let now = 0;
  return {tick(ms = 0) { now += ms; return c.tick(now); },
    run(count, ms = 100) { for (let i = 0; i < count; i++) this.tick(ms); return c.getSnapshot(); }};
}

test('explicit idle/loading/ready/playing/paused/finished/error; replay is deliberate', async () => {
  const pending = deferred(), c = createRoutePlayback({loadRoute: () => pending.promise,
    animationDurationSeconds: 1});
  assert.equal(c.getSnapshot().phase, 'idle');
  c.play(); assert.equal(c.getSnapshot().phase, 'idle');
  const load = c.selectRoute(selection);
  assert.equal(c.getSnapshot().phase, 'loading');
  assert.equal(c.getSnapshot().distanceM, null);
  c.play(); c.seekDistance(25);
  assert.equal(c.getSnapshot().phase, 'loading');
  pending.resolve(route); await load;
  assert.equal(c.getSnapshot().phase, 'ready');
  assert.equal(c.getSnapshot().renderer.enabled, false);
  const clock = time(c);
  c.play(); clock.tick(); clock.run(4);
  assert.equal(c.getSnapshot().phase, 'playing');
  near(c.getSnapshot().distanceM, a.distanceM * 0.4);
  c.pause();
  const paused = c.getSnapshot();
  clock.run(20);
  assert.equal(c.getSnapshot(), paused);
  c.play(); clock.tick(); clock.run(7);
  assert.equal(c.getSnapshot().phase, 'finished');
  assert.equal(c.getSnapshot().distanceM, a.distanceM);
  c.play(); assert.equal(c.getSnapshot().distanceM, 0);
  assert.equal(c.getSnapshot().phase, 'playing');
  const broken = await ready({loadRoute: async () => { throw Error('private URL'); }});
  assert.equal(broken.getSnapshot().phase, 'error');
  assert.deepEqual(broken.getSnapshot().selection, selection);
  assert.ok(!JSON.stringify(broken.getSnapshot()).includes('private URL'));
});

for (const rate of [0.5, 1, 2, 4]) test(`deterministic actions, single immutable consumer position at ${rate}x`, async () => {
  const run = async () => {
    const c = await ready();
    c.setAnimationRate(rate);
    c.seekDistance(310);
    c.play();
    const clock = time(c); clock.tick(); clock.run(10);
    near(c.getSnapshot().distanceM, 310 + a.distanceM / 150 * rate);
    // At every rate an explicit seek/chapter is exactly the same distance.
    c.seekDistance(123.25);
    assert.equal(c.getSnapshot().distanceM, 123.25);
    c.nextChapter();
    const s = c.getSnapshot();
    assert.equal(s.distanceM, a.chapters[1].startM);
    assert.equal(s.phase, 'paused');
    const [map, profile, hud] = [c.getSnapshot(), c.getSnapshot(), c.getSnapshot()];
    assert.equal(map, profile); assert.equal(hud.position, map.position);
    assert.equal(s.distanceM, s.position.distanceM);
    assert.throws(() => { map.position.distanceM = 5; }, TypeError);
    assert.throws(() => { map.chapters[0].startM = 5; }, TypeError);
    return s;
  };
  assert.deepEqual(await run(), await run());
});

test('normal frame partitions agree; stalls preserve legacy bounded step, not time debt', async () => {
  const slow = await ready(), fast = await ready();
  for (const c of [slow, fast]) c.play();
  const s = time(slow), f = time(fast);
  s.tick(); f.tick(); s.run(10, 100); f.run(100, 10);
  near(slow.getSnapshot().distanceM, fast.getSnapshot().distanceM);
  const before = slow.getSnapshot().distanceM;
  s.tick(10000);
  near(slow.getSnapshot().distanceM - before, a.distanceM / 150 / 60);
  assert.equal(playbackFrameSeconds(400), 0.15);
  assert.equal(playbackFrameSeconds(500), 0.15);
  assert.equal(playbackFrameSeconds(501), 1 / 60);
  for (const bad of [NaN, Infinity, -1, '100']) assert.equal(playbackFrameSeconds(bad), 0);
  slow.tick(-1);
  assert.equal(slow.getSnapshot().phase, 'paused', 'backwards time suspends playback');
});

test('seek clamps UI bounds; chapters use half-open ownership; restart differs from overview', async () => {
  const c = await ready();
  assert.equal(c.getSnapshot().previousChapterId, null);
  c.play(); c.previousChapter();
  assert.equal(c.getSnapshot().phase, 'paused');
  c.nextChapter();
  assert.equal(c.getSnapshot().chapterId, a.chapters[1].id);
  assert.equal(c.getSnapshot().nextChapterId, null);
  c.previousChapter(); assert.equal(c.getSnapshot().distanceM, 0);
  c.seekDistance(-100); assert.equal(c.getSnapshot().distanceM, 0);
  c.seekDistance(1e6); assert.equal(c.getSnapshot().distanceM, a.distanceM);
  c.seekDistance(400);
  c.play(); c.backToOverview();
  assert.equal(c.getSnapshot().distanceM, 400);
  assert.equal(c.getSnapshot().cameraMode, 'overview');
  assert.equal(c.getSnapshot().phase, 'paused');
  c.restart();
  assert.equal(c.getSnapshot().distanceM, 0);
  assert.equal(c.getSnapshot().cameraMode, 'follow');
  assert.equal(c.getSnapshot().phase, 'paused');
  for (const v of [NaN, Infinity, '100', undefined]) {
    c.seekDistance(v); assert.equal(c.getSnapshot().distanceM, 0);
  }
  c.seekDistance(1e6, {strict: true}); assert.equal(c.getSnapshot().distanceM, 0);
  c.selectChapter('absent'); assert.equal(c.getSnapshot().distanceM, 0);
});

test('all deliberate manipulation pauses; camera/rate/visibility never alter modeled distance', async () => {
  const c = await ready(); c.seekDistance(100);
  for (const action of [
    () => c.setCameraMode('side'), () => c.setAnimationRate(4),
    () => c.manipulate(), () => c.setReducedMotion(true), () => c.setHidden(true),
  ]) {
    c.play(); action();
    assert.equal(c.getSnapshot().phase, 'paused');
    assert.equal(c.getSnapshot().distanceM, 100);
  }
  c.play(); assert.equal(c.getSnapshot().phase, 'paused', 'hidden Play is ignored');
  c.setHidden(false);
  assert.equal(c.getSnapshot().phase, 'paused');
  const clock = time(c); clock.tick(900000);
  assert.equal(c.getSnapshot().distanceM, 100);
  c.play(); clock.tick(900000);
  assert.equal(c.getSnapshot().distanceM, 100, 'first resumed timestamp only anchors');
  clock.tick(100);
  assert.ok(c.getSnapshot().distanceM > 100, 'reduced motion still permits explicit Play');
  assert.throws(() => c.setAnimationRate(100), RangeError);
  assert.throws(() => c.setCameraMode('invented'), RangeError);
});

test('rapid switches discard stale successes AND failures, including switching back to same ID', async () => {
  const loads = [deferred(), deferred(), deferred(), deferred()];
  let i = 0;
  const c = createRoutePlayback({loadRoute: () => loads[i++].promise});
  const first = c.selectRoute(selection);
  const b = analysis('second');
  const second = c.selectRoute({routeId: b.routeId, revisionId: b.revisionId});
  const third = c.selectRoute({...selection, distanceM: 250});
  loads[2].resolve(route); await third;
  const current = c.getSnapshot();
  loads[0].resolve(route); await first;
  assert.equal(c.getSnapshot(), current);
  loads[1].reject(Error('stale failure')); await second;
  assert.equal(c.getSnapshot(), current);
  const last = c.selectRoute(selection);
  c.clear(); const idle = c.getSnapshot();
  loads[3].resolve(route); await last;
  assert.equal(c.getSnapshot(), idle);
  assert.equal(idle.phase, 'idle');
});

test('switch pauses/clears old details; rejected load has explicit identity; retry is caller initiated', async () => {
  let calls = 0;
  const c = await ready({loadRoute: async () => {
    if (++calls === 2) throw Error('failed'); return route;
  }});
  c.seekDistance(200); c.play();
  const retry = c.selectRoute(selection);
  assert.equal(c.getSnapshot().phase, 'loading');
  assert.equal(c.getSnapshot().position, null);
  assert.equal(c.getSnapshot().identity, null);
  assert.deepEqual(c.getSnapshot().chapters, []);
  await retry;
  assert.equal(calls, 2);
  assert.equal(c.getSnapshot().phase, 'error');
  c.play(); assert.equal(calls, 2);
  await c.selectRoute(selection);
  assert.equal(calls, 3);
  assert.equal(c.getSnapshot().phase, 'ready');
  assert.equal(c.getSnapshot().distanceM, 0);
});

test('3D is opt-in, late terrain cannot seek/resume, stale terrain tokens cannot affect new load/retry', async () => {
  const c = await ready(); c.seekDistance(345);
  const firstToken = c.enable3D().renderer.requestId;
  c.play(); assert.equal(c.getSnapshot().phase, 'paused', 'buffering never queues Play');
  c.setRendererStatus(firstToken, 'ready');
  assert.equal(c.getSnapshot().phase, 'paused');
  assert.equal(c.getSnapshot().distanceM, 345);
  c.play(); c.setRendererStatus(firstToken, 'promoting');
  assert.equal(c.getSnapshot().phase, 'paused');
  c.setRendererStatus(firstToken, 'flat');
  assert.equal(c.getSnapshot().distanceM, 345);
  const secondToken = c.enable3D().renderer.requestId;
  const pending = c.getSnapshot();
  c.setRendererStatus(firstToken, 'unavailable'); assert.equal(c.getSnapshot(), pending);
  c.setRendererStatus(secondToken, 'unavailable');
  assert.equal(c.getSnapshot().phase, 'paused', 'renderer failure is not route error');
  assert.equal(c.getSnapshot().position.distanceM, 345);
  c.enable3D(false); c.play();
  assert.equal(c.getSnapshot().phase, 'playing', 'profile playback remains usable');
  await c.selectRoute(selection);
  const fresh = c.getSnapshot();
  c.setRendererStatus(secondToken, 'ready');
  assert.equal(c.getSnapshot(), fresh);
});

test('strict revision-pinned restoration never substitutes, clamps or autoplays', async () => {
  for (const patch of [{distanceM: '100'}, {distanceM: -1}, {distanceM: 1e6},
    {distanceM: NaN}, {revisionId: 'stale-v0'}, {chapterId: 'missing'}]) {
    const c = await ready({}, {...selection, ...patch});
    assert.equal(c.getSnapshot().phase, 'error', JSON.stringify(patch));
    assert.equal(c.getSnapshot().position, null);
  }
  const c = await ready({}, {...selection, chapterId: a.chapters[1].id});
  assert.equal(c.getSnapshot().phase, 'paused');
  assert.equal(c.getSnapshot().distanceM, a.chapters[1].startM);
  c.tick(10000);
  assert.equal(c.getSnapshot().distanceM, a.chapters[1].startM);
});

test('empty chapter data still allows distance seek; broken adapters fail explicitly and atomically', async () => {
  const c = await ready({loadRoute: async () => ({...route, chapters: []})});
  c.seekDistance(123); assert.equal(c.getSnapshot().distanceM, 123);
  assert.equal(c.getSnapshot().chapterId, null);
  c.nextChapter(); assert.equal(c.getSnapshot().distanceM, 123);
  for (const bad of [
    {...route, chapters: [{id: 'bad', startM: 10, endM: a.distanceM}]},
    {...route, positionAt: d => ({distanceM: d + 1})},
    {...route, positionAt: () => { throw Error('projection'); }},
  ]) {
    const broken = await ready({loadRoute: async () => bad});
    assert.equal(broken.getSnapshot().phase, 'error');
    assert.equal(broken.getSnapshot().position, null);
  }
  const later = await ready({loadRoute: async () => ({...route,
    positionAt: d => { if (d > 100) throw Error('failed'); return route.positionAt(d); }})});
  later.seekDistance(50); later.seekDistance(150);
  assert.equal(later.getSnapshot().phase, 'error');
  assert.equal(later.getSnapshot().distanceM, 50, 'last useful profile position retained');
  assert.equal(later.getSnapshot().position.distanceM, 50);
});

test('estimated durations use shared physics/stop-arrival query, never animation rate', async () => {
  const estimate = estimateRouteTime(a, {stops: [{chapterId: a.chapters[1].id, seconds: 300}]});
  assert.equal(estimate.status, 'available');
  const c = await ready({loadRoute: async () => createAnalysisPlaybackRoute(a, {estimate})});
  c.nextChapter();
  const atStop = c.getSnapshot().estimatedRide;
  assert.deepEqual(atStop, routeTimeAtDistance(estimate, a.chapters[1].startM));
  for (const rate of [0.5, 1, 2, 4]) {
    c.setAnimationRate(rate);
    assert.deepEqual(c.getSnapshot().estimatedRide, atStop);
  }
  const clock = createRouteClock(estimate);
  const arrival = atStop.elapsedSeconds;
  const stopped = clock.atSecond(arrival + 150);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.distanceM, c.getSnapshot().distanceM);
  assert.equal(clock.atSecond(arrival + 300).status, 'moving');
  // Time within a stop remains a clock concern, not a second animation clock.
  assert.equal(c.getSnapshot().estimatedRide.elapsedSeconds, arrival);
  assert.equal(c.getSnapshot().recordedClock.status, 'unavailable');
  const changed = createAnalysisPlaybackRoute(a, {estimate: estimateRouteTime(a, {ftpW: 300})});
  assert.notEqual(changed.estimatedAtDistance(1000).elapsedSeconds,
    c.getSnapshot().estimatedRide.elapsedSeconds);
  assert.throws(() => createAnalysisPlaybackRoute(a, {estimate: {...estimate,
    identity: {...estimate.identity, revisionId: 'other'}}}), /different/);
  assert.throws(() => createAnalysisPlaybackRoute(a, {estimate: {...estimate, identity: undefined}}), /different/);
});

test('recorded clock is optional, revision-bound and explicit about gaps/ambiguous pauses', async () => {
  const recording = {identity: a.identity, atDistance: d => d === 100 ?
    {status: 'ambiguous', reason: 'Recorded pause', arrivalSeconds: 30, departureSeconds: 90} :
    {status: 'unavailable', reason: 'Recording gap'}};
  const c = await ready({loadRoute: async () => createAnalysisPlaybackRoute(a, {recording})});
  assert.equal(c.getSnapshot().recordedClock.status, 'unavailable');
  c.seekDistance(100);
  const recorded = c.getSnapshot().recordedClock;
  assert.equal(recorded.status, 'ambiguous');
  c.setAnimationRate(4); c.setCameraMode('cinematic');
  assert.deepEqual(c.getSnapshot().recordedClock, recorded);
  assert.throws(() => createAnalysisPlaybackRoute(a, {recording: {...recording,
    identity: {...a.identity, geometrySha256: 'b'.repeat(64)}}}), /exact/);
});

async function example() {
  const profile = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
  const gpx = await readFile(new URL('../assets/semonzo.gpx', import.meta.url), 'utf8');
  // Minimal read-only XML facade, same fixture strategy as the analysis tests.
  const nodes = [...gpx.matchAll(/<trkpt lon="([^"]+)" lat="([^"]+)">\s*<ele>([^<]+)<\/ele>\s*<\/trkpt>/g)]
    .map(m => ({getAttribute: k => m[k === 'lat' ? 2 : 1],
      querySelector: () => ({textContent: m[3]})}));
  const points = readExampleTrack({querySelectorAll: selector => selector === 'trk > trkseg' ?
    [{querySelectorAll: () => nodes}] : []});
  assert.equal(points.length, 1034);
  return {profile, points, route: createSemonzoPlaybackRoute(points, profile)};
}

test('real Semonzo adapter preserves old paused seek, arrow, reset, replay and pinned legacy link', async () => {
  const ex = await example();
  const c = createRoutePlayback({loadRoute: async () => ex.route});
  const legacy = createLegacyFlyoverAdapter(c);
  const resolved = readSelection('index.html#seek-9000', exampleCatalog,
    {'semonzo-example-v1': ex.profile});
  await legacy.selection(resolved);
  assert.equal(c.getSnapshot().phase, 'paused');
  assert.equal(c.getSnapshot().distanceM, 9000);
  assert.equal(c.getSnapshot().chapterId, 'half-step');
  legacy.toggle(); legacy.scrub(11000);
  assert.equal(c.getSnapshot().phase, 'paused');
  assert.equal(c.getSnapshot().chapterId, 'high-step');
  legacy.arrow(100); assert.equal(c.getSnapshot().distanceM, 11100);
  legacy.reset();
  assert.equal(c.getSnapshot().distanceM, 0);
  assert.equal(c.getSnapshot().cameraMode, 'overview');
  assert.equal(c.getSnapshot().phase, 'paused');
  legacy.scrub(1e9); assert.equal(c.getSnapshot().distanceM, ex.points.at(-1).distanceM);
  legacy.toggle(); assert.equal(c.getSnapshot().distanceM, 0);
  legacy.tick(0); legacy.tick(100);
  near(c.getSnapshot().distanceM, ex.route.distanceM / 150 * 0.1);
  legacy.visibility(true); legacy.tick(1e9);
  assert.equal(c.getSnapshot().phase, 'paused');
  assert.equal(c.getSnapshot().renderer.enabled, false);
  // Exact legacy raw-coordinate interpolation; no rail/camera coordinates in position truth.
  const d = 10000, b = ex.points.findIndex(p => p.distanceM >= d), p = ex.points[b - 1], q = ex.points[b];
  const f = (d - p.distanceM) / (q.distanceM - p.distanceM);
  legacy.scrub(d);
  assert.equal(c.getSnapshot().position.lat, p.lat + f * (q.lat - p.lat));
  assert.equal(c.getSnapshot().position.rawElevationM, p.height + f * (q.height - p.height));
});

test('Semonzo existing 70/80 clock, stop boundary and invalid FTP never become playback gates', async () => {
  const ex = await example();
  const inputs = {mass: '', enteredUnit: 'kg', ftp: '', effort: 'slower'};
  const scenario = riderScenario(ex.profile, inputs);
  const clock = createRideClock(scenario, 'faster', 5);
  const arrival = scenario.estimate.chapters[0].faster.movingSeconds / 60;
  for (const minute of [arrival, arrival + 2.5, arrival + 5 - 1e-6]) {
    const state = clock.atMinute(minute);
    assert.equal(state.b.status, 'stopped');
    assert.equal(state.b.distanceM, 9000);
  }
  assert.equal(clock.atMinute(arrival + 5).b.status, 'moving');
  assert.equal(clock.atMinute(0).minute, 0);
  assert.equal(clock.atMinute(Infinity), null);
  assert.equal(createRideClock(riderScenario(ex.profile, {...inputs, ftp: 'invalid'}), 'faster'), null);
  const c = createRoutePlayback({loadRoute: async () => ex.route});
  await c.selectRoute(ex.route.identity);
  c.selectChapter('high-step');
  assert.equal(c.getSnapshot().distanceM, 11000);
  assert.equal(c.getSnapshot().estimatedRide.status, 'unavailable');
  assert.equal(c.getSnapshot().phase, 'paused');
  assert.equal(c.play().phase, 'playing');
  // The comparison clock is unchanged/stateless; animation has no write access.
  assert.deepEqual(clock.atMinute(arrival + 2.5), createRideClock(scenario, 'faster', 5).atMinute(arrival + 2.5));
});

test('integrated legacy flyover uses the sole session clock for seek, reset, replay and hidden tabs', async () => {
  const ex = await example(), elements = new Map(), events = new Map(), frames = new Map();
  let frame = 0, pose;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'speed' ? '1' : '0', hidden: id !== 'climb', dataset: {},
      classList: {remove() {}, toggle() {}},
      parentElement: {classList: {remove() {}, toggle() {}}, hidden: false},
      setAttribute() {}, addEventListener(name, fn) { this[name] = fn; },
    });
    return elements.get(id);
  };
  const document = {hidden: false, getElementById: element,
    addEventListener: (name, fn) => events.set(name, fn),
    dispatchEvent() {},
  };
  // Execute the real session scheduler and flyover, substituting module loading
  // in memory. Compare rendered camera input to an independent pure controller.
  const source = await readFile(new URL('../assets/flyover.js', import.meta.url), 'utf8');
  const seam = "import('../js/semonzo-profile.mjs')";
  assert.equal(source.split(seam).length, 2);
  const context = vm.createContext({
    document, exampleModule: {loadExampleTrack: async () => ex.points},
    createRoutePlayback, adaptersModule:{createLegacyFlyoverAdapter},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    requestAnimationFrame: fn => { frames.set(++frame, fn); return frame; },
    cancelAnimationFrame: id => frames.delete(id),
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } },
    window: {startTerrain(points, install, upcoming, availability) {
      availability('ready');
      install((point, following, focus, angle, seconds, snap, playing) => {
        pose = {distanceM: point.d, following, playing};
      });
    }},
  });
  const sessionSource=await readFile(new URL('../js/route-session.mjs',import.meta.url),'utf8');
  vm.runInContext(sessionSource.replace("import { createRoutePlayback } from './route-playback.mjs';",'')
    .replaceAll('export ','')+'\nglobalThis.sessionModule={routePlayback,registerPlaybackRoute,subscribePlayback};',context);
  context.sessionModule.registerPlaybackRoute(ex.route);
  await context.sessionModule.routePlayback.selectRoute(ex.route.identity);
  vm.runInContext(source.replace(seam,'Promise.resolve(exampleModule)')
    .replace("import('../js/route-session.mjs')",'Promise.resolve(sessionModule)')
    .replace("import('../js/route-playback-adapters.mjs')",'Promise.resolve(adaptersModule)'),context);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pose, 'legacy loader completed');
  const c = createRoutePlayback({loadRoute: async () => ex.route});
  await c.selectRoute(ex.route.identity);
  const adapter = createLegacyFlyoverAdapter(c);
  const compare = () => {
    near(c.getSnapshot().distanceM, pose.distanceM);
    assert.equal(c.getSnapshot().phase === 'playing', pose.playing);
    assert.equal(c.getSnapshot().cameraMode !== 'overview', pose.following);
  };
  const oldTick = now => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(fn => fn(now));
  };
  compare();
  element('seek').value = '9000'; element('seek').input(); adapter.scrub(9000); compare();
  element('seek').keydown({key: 'ArrowRight', preventDefault() {}}); adapter.arrow(100); compare();
  element('reset').click(); adapter.reset(); compare();
  element('play').click(); adapter.toggle(); compare();
  for (const now of [0, 100, 200, 600, 10000, 10100]) {
    oldTick(now); adapter.tick(now); compare();
  }
  document.hidden = true; events.get('visibilitychange')(); adapter.visibility(true); compare();
  oldTick(1e9); adapter.tick(1e9); compare();
  document.hidden = false; events.get('visibilitychange')(); adapter.visibility(false);
  element('seek').value = '1000000'; element('seek').input(); adapter.scrub(1e6); compare();
  element('play').click(); adapter.toggle(); compare(); // exact finish replay -> zero
});

test('all approved routes use exact analysis positions; D4S unavailable estimate does not block playback', async () => {
  const {pack} = await readRoutePack('.');
  let unavailableCount = 0;
  for (const r of pack.catalog.routes) {
    const analysis = await loadRouteAnalysis({pack, routeId: r.id, revisionId: r.currentRevisionId,
      readAsset: path => readFile(path)});
    const estimate = estimateRouteTime(analysis);
    const c = await ready({loadRoute: async () => createAnalysisPlaybackRoute(analysis, {estimate})},
      {routeId: r.id, revisionId: r.currentRevisionId});
    assert.equal(c.getSnapshot().phase, 'ready');
    c.seekDistance(analysis.distanceM / 2);
    assert.equal(c.getSnapshot().position.distanceM, analysis.distanceM / 2);
    if (estimate.status === 'unavailable') {
      unavailableCount++;
      assert.equal(c.getSnapshot().estimatedRide.status, 'unavailable');
      assert.equal(c.play().phase, 'playing');
    }
  }
  assert.equal(unavailableCount, 1, 'D4S model-domain gap stays explicit');
});
