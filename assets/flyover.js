// All geometry and relief are local. The shaded image, route overlay and camera
// use the same oblique projection (metres east, north and above sea level).
(() => {
  const el = id => document.getElementById(id);
  const scene = el('scene'), seek = el('seek'), play = el('play');
  const overview = [-290, -285, 610, 455];
  const km = metres => (metres / 1000).toFixed(1);

  async function load() {
    const response = await fetch('./assets/semonzo.gpx');
    if (!response.ok) throw Error('Route unavailable');
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const points = [];
    for (const pt of xml.querySelectorAll('trkpt')) {
      const lon = Number(pt.getAttribute('lon')), lat = Number(pt.getAttribute('lat'));
      const height = Number(pt.querySelector('ele')?.textContent);
      const east = (lon - 11.78) * 77450, north = (lat - 45.84) * 111200;
      const prev = points.at(-1);
      const d = prev ? prev.d + Math.hypot(east - prev.east, north - prev.north) : 0;
      if (!Number.isFinite(d + height)) throw Error('Invalid route');
      if (!prev || d > prev.d) points.push({ lon, lat, east, north, height, d,
        x: east / 15, y: -(north * .68 + height * .8) / 15 });
    }
    if (points.length < 2) throw Error('Empty route');
    return points;
  }

  function start(points) {
    const total = points.at(-1).d;
    const heights = points.map(p => p.height);
    const low = Math.min(...heights), high = Math.max(...heights);
    const profile = points.map(p => `${(p.d / total * 1000).toFixed(2)},${(94 - 88 * (p.height - low) / (high - low)).toFixed(2)}`);
    el('profile').setAttribute('d', `M0,100 L${profile.join(' ')} L1000,100Z`);
    seek.max = Math.ceil(total);
    el('length').textContent = `${km(total)} km`;

    let d = 0, following = false, playing = false, last = null, frame = 0;
    function sample(distance) {
      distance = Math.max(0, Math.min(total, distance));
      let a = 0, b = points.length - 1;
      while (b - a > 1) {
        const mid = (a + b) >> 1;
        if (points[mid].d < distance) a = mid; else b = mid;
      }
      const p = points[a], q = points[b], f = (distance - p.d) / (q.d - p.d);
      const lerp = k => p[k] + f * (q[k] - p[k]);
      return { x:lerp('x'), y:lerp('y'), lon:lerp('lon'), lat:lerp('lat'), height:lerp('height') };
    }
    // A uniform cubic B-spline through distance-spaced control samples. Its
    // centered support sees both sides of a switchback; position, velocity
    // and acceleration stay continuous without a speed-dependent time lag.
    const spans = Math.max(1, Math.ceil(total / 400)), step = total / spans;
    const controls = Array.from({length:spans+1}, (_, i) => sample(i*step));
    const keys = Object.keys(controls[0]);
    function rail(distance) {
      if (distance === 0 || distance === total) return sample(distance);
      const i = Math.min(spans-1, Math.floor(distance/step)), u = distance/step-i;
      const a = controls[i-1], b = controls[i], c = controls[i+1], e = controls[i+2];
      const w0 = (1-u)**3/6, w3 = u**3/6;
      const w1 = (4-6*u*u+3*u**3)/6, w2 = 1-w0-w1-w3;
      const result = {};
      // Linear ghost samples keep the endpoints exactly on the route.
      for (const k of keys) result[k] = w0*(a?.[k] ?? 2*b[k]-c[k]) + w1*b[k]
        + w2*c[k] + w3*(e?.[k] ?? 2*c[k]-b[k]);
      return result;
    }
    let terrain, focus, offset, anchor, angle = 0;
    const reliefHeight = 260 * 455 / 610;
    // Both cameras aim at the viewport center. During a handoff pan the
    // entire relief view (never the beacon alone) to match the perspective
    // camera's framing of the current route point.
    let panX = 0, panY = 0, startX, startY;
    function frameRelief() {
      scene.setAttribute('viewBox', following ?
        `${focus.x-130-panX} ${focus.y-reliefHeight/2-panY} 260 ${reliefHeight}` : overview.join(' '));
    }
    function alignRelief(point, screen, blend) {
      if (!blend) { startX = panX; startY = panY; }
      const target = screen.matrixTransform(scene.getScreenCTM().inverse());
      panX = startX + (panX + target.x-point.x-startX)*blend;
      panY = startY + (panY + target.y-point.y-startY)*blend;
      frameRelief();
    }
    function resetCamera() {
      focus = null;
      panX = panY = 0;
      angle = 0;
    }
    const rate = () => total / 90 * Number(el('speed').value);
    // Sample the same camera rail as playback, lazily (not every frame).
    function upcoming() {
      if (!playing || document.hidden) return;
      const velocity = rate(), distance = Math.min(total, d + 2.5 * velocity);
      if (distance - d < 180) return;
      return {focus:rail(distance), distance, turn:.08 * (distance-d)/velocity};
    }
    function render(seconds = 0) {
      const point = sample(d);
      const {x,y} = point;
      const snap = !focus;
      if (snap) {
        focus = {...point};
        offset = rail(d);
        for (const k of keys) offset[k] = point[k] - offset[k];
        anchor = d;
      } else if (seconds > 0) {
        focus = rail(d);
        // A seek starts at the exact rider. Ease its offset out over the next
        // span rather than popping onto the precomputed path on frame two.
        const u = Math.min(1, (d-anchor)/Math.min(step,total-anchor));
        for (const k of keys) focus[k] += offset[k]*(1-u)**2*(1+2*u);
      }
      angle = (angle + .08 * seconds) % (2 * Math.PI);
      frameRelief();
      const rider = el('relief-beacon');
      rider.setAttribute('transform', `translate(${x} ${y})`);
      rider.setAttribute('visibility', following ? 'visible' : 'hidden');
      const pos = (d / total * 1000).toFixed(2);
      el('cursor').setAttribute('x1', pos);
      el('cursor').setAttribute('x2', pos);
      seek.value = d === total ? seek.max : Math.round(d);
      const text = `${km(d)} km ridden · ${Math.round(point.height)} m elevation · ${km(total - d)} km remaining`;
      el('stats').textContent = text;
      seek.setAttribute('aria-valuetext', text);
      el('mode').textContent = playing ? 'Cinematic flyover' : !following ? 'Route overview' : d === total ? 'Summit' : 'Paused';
      play.textContent = playing ? 'Pause' : d === total ? 'Replay flyover' : 'Play flyover';
      terrain?.(point, following, focus, angle, seconds, snap);
    }
    function pause() {
      playing = false;
      cancelAnimationFrame(frame);
      last = null;
    }
    function tick(now) {
      if (!playing) return;
      const velocity = rate();
      const gap = last === null ? 0 : (now-last)/1000;
      // A stalled foreground frame is not distance owed. Discard its backlog
      // for all consumers, including the orbit, and rebase on this timestamp.
      const seconds = Math.min(gap > .15 ? 1/60 : gap, (total - d) / velocity);
      d = Math.min(total, d + seconds * velocity);
      last = now;
      if (d === total) pause();
      render(seconds);
      if (playing) frame = requestAnimationFrame(tick);
    }
    play.addEventListener('click', () => {
      if (playing) pause();
      else {
        if (d === total) { d = 0; resetCamera(); }
        following = playing = true;
        frame = requestAnimationFrame(tick);
      }
      render();
    });
    function scrub(value) {
      pause();
      following = true;
      d = Math.max(0, Math.min(total, value));
      resetCamera();
      render();
    }
    seek.addEventListener('input', () => scrub(Number(seek.value)));
    seek.addEventListener('keydown', e => {
      const delta = {ArrowRight: 100, ArrowUp: 100, ArrowLeft: -100, ArrowDown: -100}[e.key];
      if (delta) { e.preventDefault(); scrub(d + delta); }
    });
    el('reset').addEventListener('click', () => {
      pause(); following = false; d = 0; resetCamera(); render();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && playing) { pause(); render(); }
    });
    render();
    el('deck').hidden = false;
    window.startTerrain?.(points, draw => { terrain = draw; render(); }, upcoming, alignRelief);
  }
  load().then(start).catch(() => {
    el('message').textContent += ' Playback is unavailable; the full route is shown above.';
  });
  // Start the optional SDK alongside GPX, not before this deferred local
  // player (a slow satellite stylesheet must not hold up the controls).
  window.prepareTerrain?.();
})();
