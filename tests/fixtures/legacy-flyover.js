// The local GPX drives playback and the elevation profile, with or without a map.
(() => {
  const el = id => document.getElementById(id);
  const seek = el('seek'), play = el('play');
  const km = metres => (metres / 1000).toFixed(1);

  async function load() {
    const {loadExampleTrack} = await import('../js/semonzo-profile.mjs');
    // Same pinned geometry and horizontal distance axis as the chapter model.
    return (await loadExampleTrack()).map(({lon, lat, height, distanceM}) => {
      const east = (lon - 11.78) * 77450, north = (lat - 45.84) * 111200;
      return {lon, lat, east, north, height, d:distanceM};
    });
  }

  async function start(points) {
    const {routePlayback:controller, subscribePlayback} = await import('../js/route-session.mjs');
    const {createLegacyFlyoverAdapter} = await import('../js/route-playback-adapters.mjs');
    const legacy = createLegacyFlyoverAdapter(controller);
    const total = points.at(-1).d;
    const heights = points.map(p => p.height);
    const low = Math.min(...heights), high = Math.max(...heights);
    const profile = points.map(p => `${(p.d / total * 1000).toFixed(2)},${(94 - 88 * (p.height - low) / (high - low)).toFixed(2)}`);
    el('profile').setAttribute('d', `M0,100 L${profile.join(' ')} L1000,100Z`);
    seek.max = Math.ceil(total);
    el('length').textContent = `${km(total)} km`;

    // d/playing are read-only projections for the existing camera rail, never
    // integrated here. The document session is the sole RAF/position owner.
    let d = 0, following = false, playing = false;
    function sample(distance) {
      distance = Math.max(0, Math.min(total, distance));
      let a = 0, b = points.length - 1;
      while (b - a > 1) {
        const mid = (a + b) >> 1;
        if (points[mid].d < distance) a = mid; else b = mid;
      }
      const p = points[a], q = points[b], f = (distance - p.d) / (q.d - p.d);
      const lerp = k => p[k] + f * (q[k] - p[k]);
      return { lon:lerp('lon'), lat:lerp('lat'), height:lerp('height') };
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
    let terrain, focus, offset, anchor, angle = 0, availability = 'loading';
    function resetCamera() {
      focus = null;
      angle = 0;
    }
    const duration = 150;
    const rate = () => total / duration * controller.getSnapshot().animationRate;
    const ease = x => { x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); };
    // Block the shot in metres, not frames: the broad chord sees the exit of
    // a bend before the rider gets there. Unwrap and ease its trailing-quarter
    // angle on a fine distance grid so even a reversing chord can't spin the
    // lens. Seeking and changing frame rate traverse the same camera track.
    const clampD = v => Math.max(0, Math.min(total,v));
    const aim = v => rail(clampD(v+100));
    const count=Math.ceil(total/24), stride=total/count, yaw=[];
    for (let i=0;i<=count;i++) {
      const d=i*stride, a=rail(clampD(d-460)), b=rail(clampD(d+780));
      const course=Math.atan2((b.lon-a.lon)*77450,(b.lat-a.lat)*111200);
      const wanted=.72-course, prior=yaw[i-1] ?? wanted;
      const delta=Math.atan2(Math.sin(wanted-prior),Math.cos(wanted-prior));
      yaw.push(prior+stride*.0015*Math.tanh(delta/.35));
    }
    function composition(distance) {
      const ridge=ease((distance-2600)/1400)*ease((8700-distance)/1700);
      const i=Math.min(count-1,Math.floor(distance/stride));
      return {angle:yaw[i]+(yaw[i+1]-yaw[i])*(distance/stride-i),ridge,opening:1-ease(distance/1500)};
    }
    // Sample the same camera rail as playback, lazily (not every frame).
    function upcoming() {
      if (!playing || document.hidden) return;
      const velocity = rate(), distance = Math.min(total, d + Math.min(1800,4 * velocity));
      if (distance - d < 80) return;
      return {focus:aim(distance), distance, turn:composition(distance).angle-angle};
    }
    function render(seconds = 0) {
      const position=controller.getSnapshot().position;
      const point = position ? {lon:position.lon,lat:position.lat,height:position.rawElevationM} : sample(d);
      point.d=d;
      const snap = !focus;
      if (snap) {
        focus = {...point};
        offset = aim(d);
        for (const k of keys) offset[k] = point[k] - offset[k];
        anchor = d;
      } else if (seconds > 0) {
        focus = aim(d);
        // A seek starts at the exact rider. Ease its offset out over the next
        // span rather than popping onto the precomputed path on frame two.
        const u = Math.min(1, (d-anchor)/Math.min(step,total-anchor));
        for (const k of keys) focus[k] += offset[k]*(1-u)**2*(1+2*u);
      }
      const shot=composition(d);
      angle=shot.angle;
      focus.ridge=shot.ridge;
      focus.opening=shot.opening;
      const pos = (d / total * 1000).toFixed(2);
      el('cursor').setAttribute('x1', pos);
      el('cursor').setAttribute('x2', pos);
      seek.value = d === total ? seek.max : Math.round(d);
      const text = `${km(d)} km ridden · ${Math.round(point.height)} m elevation · ${km(total - d)} km remaining`;
      el('stats').textContent = text;
      seek.setAttribute('aria-valuetext', text);
      updateMode();
      if (!el('climb').hidden) terrain?.(point, following, focus, angle, seconds, snap, playing);
    }
    function updateMode() {
      el('mode').textContent = availability==='standby' ? 'Elevation profile' : playing ? (availability==='ready' ? 'Cinematic flyover' :
        availability==='flat' || availability==='promoting' ? 'Flat satellite ride' : 'Buffering')
        : !following ? 'Route overview' : d === total ? 'Summit' : availability==='loading' ? 'Buffering · paused' :
          availability==='unavailable' ? 'Elevation profile' : 'Paused';
      play.disabled=availability==='loading' || availability==='unavailable';
      play.textContent = availability==='unavailable' ? 'Flyover unavailable' : availability==='loading' ? 'Terrain loading · paused'
        : playing ? 'Pause' : d === total ? 'Replay flyover' : 'Play flyover';
    }
    let discardMap;
    function setAvailability(state, retryable=false, discard) {
      discardMap=discard;
      el('retry').hidden=!retryable;
      if (state===availability) return;
      availability=state;
      el('map').parentElement.classList.toggle('departing',playing && d===0 && state==='loading');
      if (!el('climb').hidden && (state==='loading' || state==='unavailable')) pause();
      if (state==='unavailable') {
        if (!el('climb').hidden) pause();
        terrain=null;
        play.disabled=true;
        play.textContent='Flyover unavailable';
      }
      updateMode();
    }
    function pause() {
      controller.pause();
      el('map').parentElement.classList.remove('departing');
    }
    play.addEventListener('click', () => {
      if (availability!=='loading' && availability!=='unavailable') {
        if (!playing) controller.setAnimationRate(Number(el('speed').value));
        // Rate changes publish the old finish pose. Reset after that publication
        // so replay's zero-distance snapshot, not the finish, anchors the rail.
        if (d === total) resetCamera();
        legacy.toggle();
      }
    });
    function scrub(value) {
      resetCamera();
      legacy.scrub(value);
    }
    const publishSeek = () => document.dispatchEvent(new CustomEvent('kotr-seek', {detail:{distanceM:d}}));
    seek.addEventListener('input', () => { scrub(Number(seek.value)); publishSeek(); });
    seek.addEventListener('keydown', e => {
      const delta = {ArrowRight: 100, ArrowUp: 100, ArrowLeft: -100, ArrowDown: -100}[e.key];
      if (delta) { e.preventDefault(); scrub(d + delta); publishSeek(); }
    });
    el('reset').addEventListener('click', () => {
      resetCamera(); legacy.reset(); publishSeek();
    });
    el('speed').addEventListener('change', () => controller.setAnimationRate(Number(el('speed').value)));
    subscribePlayback(snapshot => {
      if (snapshot.identity?.routeId !== 'semonzo-example' || !snapshot.position) return;
      const hud=el('flyover-ride-time'), time=snapshot.estimatedRide;
      if (hud) {
        hud.textContent=time.status==='available' ?
          `Estimated ride: ${(time.elapsedSeconds/60).toFixed(1)} min elapsed · ${(time.movingSeconds/60).toFixed(1)} min moving. Shared pace scenario; not animation or recorded time.` :
          'Estimated ride time unavailable; correct or clear rider inputs. Animation remains independent.';
        for (const k of ['movingSeconds','elapsedSeconds','stopSeconds']) {
          if (time.status==='available') hud.dataset[k]=String(time[k]);
          else delete hud.dataset[k];
        }
      }
      const previous = d;
      d = snapshot.distanceM;
      playing = snapshot.phase === 'playing';
      following = snapshot.cameraMode !== 'overview';
      const seconds = playing && d >= previous ? (d-previous)/rate() : 0;
      if (!playing && d !== previous) resetCamera();
      render(seconds);
    });
    render();
    el('deck').hidden = false;
    // A chapter link carries route metres only. Use the ordinary paused seek.
    const selectedDistance = Number(el('climb').dataset.distance || 0);
    if (selectedDistance > 0) scrub(selectedDistance);
    document.addEventListener('kotr-selection', event => {
      // Shell owns resolved selections; do not start a second async selection.
      if (event.detail?.bundle?.route.id !== 'semonzo-example') window.kotrDisposeTerrain?.();
      render();
      if (!el('preview-motion').hidden && el('preview-motion').textContent.startsWith('Pause'))
        el('preview-motion').click();
    });
    const startMap=()=>window.startTerrain(points, draw => { terrain = draw; render(); }, upcoming, setAvailability);
    el('retry').addEventListener('click',()=>{
      if (el('retry').hidden) return;
      discardMap?.();
      el('map').parentElement.classList.remove('satellite-standby');
      setAvailability('loading');
      el('map').setAttribute('aria-busy','true');
      el('map').parentElement.hidden=false;
      el('message').textContent='Loading satellite terrain…';
      play.disabled=false;
      render();
      startMap(); // same clock and seek position; no automatic retry loop
    });
    if (window.startTerrain) startMap();
    else {
      setAvailability('unavailable');
      el('map').parentElement.hidden = true;
      el('message').textContent = 'Satellite terrain unavailable. Use the elevation profile below.';
    }
  }
  load().then(start).catch(() => {
    el('map').parentElement.hidden = true;
    el('message').textContent = 'Route data unavailable. Playback and satellite preview are unavailable.';
  });
  // Start the optional SDK alongside GPX, not before this deferred local
  // player (a slow satellite stylesheet must not hold up the controls).
  window.prepareTerrain?.();
})();
