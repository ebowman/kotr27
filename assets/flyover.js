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
    let terrain, focus, angle = 0;
    function resetCamera() {
      focus = null;
      angle = 0;
    }
    function render(seconds = 0) {
      const point = sample(d);
      const {x,y} = point;
      if (!focus) focus = {...point};
      else if (seconds > 0) {
        // Smooth only the framing, never the rider, profile or distance.
        const alpha = -Math.expm1(-seconds / .32);
        for (const key of Object.keys(focus)) focus[key] += alpha * (point[key] - focus[key]);
      }
      angle = (angle + .08 * seconds) % (2 * Math.PI);
      scene.setAttribute('viewBox', following ? `${focus.x - 130} ${focus.y - 110} 260 ${260 * 455 / 610}` : overview.join(' '));
      const rider = el('rider');
      rider.setAttribute('cx', x);
      rider.setAttribute('cy', y);
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
      terrain?.(point, following, focus, angle);
    }
    function pause() {
      playing = false;
      cancelAnimationFrame(frame);
      last = null;
    }
    function tick(now) {
      if (!playing) return;
      const rate = total / 90 * Number(el('speed').value);
      const seconds = last === null ? 0 : Math.min((now - last) / 1000, (total - d) / rate);
      d = Math.min(total, d + seconds * rate);
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
    window.startTerrain?.(points, draw => { terrain = draw; render(); });
  }
  load().then(start).catch(() => {
    el('message').textContent += ' Playback is unavailable; the full route is shown above.';
  });
})();
