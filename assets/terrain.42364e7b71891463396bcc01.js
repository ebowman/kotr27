// Enhance the already usable local preview. The controller owns playback time;
// even a late load or mid-ride WebGL failure never starts a second clock.
const savingTerrainData = () => navigator.connection?.saveData === true;
const terrainSDK = (() => {
  const sdk = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl';
  function resource(isScript) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement(isScript ? 'script' : 'link');
      tag.onload = resolve;
      tag.onerror = reject;
      if (isScript) tag.src = sdk + '.js';
      else { tag.rel = 'stylesheet'; tag.href = sdk + '.css'; }
      document.head.append(tag);
    });
  }
  let ready;
  return () => ready ??= Promise.all([resource(false), resource(true)]).then(() => true, () => false);
})();
window.prepareTerrain = () => {
  if (window.KOTR_CONFIG && !savingTerrainData()) terrainSDK();
};
window.startTerrain = function (points, connect, upcoming, alignRelief) {
  const container = document.getElementById('map');
  const message = document.getElementById('message');
  let map, stopped = false;
  const timer = setTimeout(fallback, 20000);
  function fallback() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    container.parentElement.classList.remove('terrain');
    message.textContent = 'Satellite terrain unavailable · Showing shaded relief.';
    map?.remove();
  }
  if (!window.KOTR_CONFIG) { fallback(); return; }
  terrainSDK().then(ready => {
    if (!ready) { fallback(); return; }
    if (stopped) return;
    const gl = window.mapboxgl;
    map = new gl.Map({
      accessToken: window.KOTR_CONFIG.MAPBOX_TOKEN,
      container, style:'mapbox://styles/mapbox/satellite-v9',
      center:[points[0].lon, points[0].lat], zoom:12, interactive:false
    });
    map.on('error', fallback);
    map.on('webglcontextlost', fallback);
    map.once('load', () => {
      if (stopped) return;
      try {
        const coords = points.map(p => [p.lon, p.lat]);
        const bounds = coords.reduce((b, xy) => b.extend(xy), new gl.LngLatBounds());
        map.addSource('dem', {type:'raster-dem', url:'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize:512, maxzoom:14});
        map.setTerrain({source:'dem', exaggeration:1});
        map.addSource('ascent', {type:'geojson', data:{type:'LineString', coordinates:coords}});
        map.addLayer({id:'ascent', type:'line', source:'ascent', paint:{'line-color':'#ff932e','line-width':4}});
        // This is a position indicator, not a feature on the terrain: keep
        // it legible when the sightline crosses a ridge, without moving it.
        const beacon = document.createElement('div');
        beacon.className = 'rider-beacon';
        beacon.setAttribute('aria-label', 'Rider position');
        const rider = new gl.Marker({element:beacon, anchor:'center', occludedOpacity:1});
        let inOverview = false, altitude;
        const viewport = container.parentElement;
        let staging = false, stableSince, panSince, pendingPose, blend = 0;
        function showTerrain(show) {
          viewport.classList.toggle('terrain', show);
          message.textContent = show ? 'Satellite terrain · The orange line traces the ascent.'
            : 'Shaded relief · Loading terrain at the rider.';
        }
        function overview() {
          rider.remove();
          map.jumpTo({pitch:0, bearing:0});
          map.fitBounds(bounds, {padding:40, duration:0});
          inOverview = true;
          if (staging) { staging = false; pendingPose = null; showTerrain(true); }
        }
        overview();
        map.once('idle', () => {
          if (stopped) return;
          clearTimeout(timer);
          showTerrain(true);
          let nextCheck = 0, lastDistance = -Infinity, disabled = false;
          map.on('render', () => {
            if (stopped || inOverview) return;
            const now = performance.now();
            if (staging) {
              // The SDK can project a marker against sea level (or a parent
              // tile) before it has drawn the new viewport. Stay on the live
              // GPX relief view until the rendered camera AND marker agree.
              try {
                const loaded = map.areTilesLoaded();
                if (!loaded) stableSince = null;
                if (!pendingPose || (!loaded && panSince == null)) return;
                const {point,eye,target,eyeZ,targetZ,draw} = pendingPose;
                const z = map.queryTerrainElevation(eye), aim = map.queryTerrainElevation(target);
                if (z == null || aim == null || map.queryTerrainElevation(rider.getLngLat()) == null) {
                  stableSince = null; return;
                }
                if (z !== eyeZ || aim !== targetZ) {
                  stableSince = null;
                  draw(); // Re-aim while hidden, even if playback is paused.
                  return;
                }
                const p = map.project(rider.getLngLat());
                const b = beacon.getBoundingClientRect(), m = container.getBoundingClientRect();
                if (!(b.width && b.left >= m.left+2 && b.right <= m.right-2 &&
                    b.top >= m.top+2 && b.bottom <= m.bottom-2 &&
                    Math.hypot(b.x+b.width/2-m.x-p.x,b.y+b.height/2-m.y-p.y) < 2)) {
                  stableSince = null; return;
                }
                // Neighboring tiles can stream in throughout a fast ride.
                // Don't restart the pan on each request; keep the independent
                // 150 ms loaded-camera check for the actual reveal.
                if (loaded) stableSince ??= now;
                panSince ??= now;
                const progress = Math.min(1,(now-panSince)/450);
                const alignedLastFrame = blend === 1;
                blend = progress**2*(3-2*progress);
                alignRelief(point,new DOMPoint(b.x+b.width/2,b.y+b.height/2),blend);
                if (!alignedLastFrame || stableSince == null || now-stableSince < 150) {
                  if (loaded) map.triggerRepaint();
                  return;
                }
                staging = false; pendingPose = null; showTerrain(true);
              } catch { fallback(); return; }
            }
            if (disabled || now < nextCheck || savingTerrainData()) return;
            nextCheck = now + 200;
            // After the visible render has selected/requested its tiles, never
            // issue another viewport while visible sources are still loading.
            if (!map.areTilesLoaded()) return;
            const view = upcoming();
            if (!view || Math.abs(view.distance-lastDistance) < 180) return;
            nextCheck = now + 1500;
            lastDistance = view.distance;
            try {
              // v2.15 jumpTo clones the live transform for preloadOnly.
              // Inherit the actual cinematic zoom/pitch (including terrain).
              map.jumpTo({preloadOnly:true, center:[view.focus.lon, view.focus.lat],
                bearing:map.getBearing() - view.turn*180/Math.PI});
            } catch { disabled = true; } // A failed hint must not stop the ride.
          });
          function drawPose(point, following, focus, angle, seconds, snap) {
            if (stopped) return;
            try {
              if (!following) { if (!inOverview) overview(); return; }
              if (snap || inOverview) {
                if (!staging) showTerrain(false);
                staging = true; stableSince = panSince = null; blend = 0;
              }
              // Wide orbit about the filtered focus, independent of road heading.
              const radius = 900;
              const eye = [focus.lon + radius * Math.sin(angle) / 77450,
                focus.lat - radius * Math.cos(angle) / 111200];
              const target = [focus.lon, focus.lat];
              const eyeZ = map.queryTerrainElevation(eye), targetZ = map.queryTerrainElevation(target);
              const floor = 600 + Math.max(focus.height, eyeZ ?? focus.height, targetZ ?? focus.height);
              // Rise immediately for clearance, but release gently when DEM
              // samples fall or go missing at tile boundaries.
              if (snap || inOverview || altitude < floor) altitude = floor;
              else if (seconds > 0) altitude = floor + (altitude-floor)*Math.exp(-seconds/.6);
              const camera = map.getFreeCameraOptions();
              camera.position = gl.MercatorCoordinate.fromLngLat(eye, altitude);
              camera.lookAtPoint(target);
              map.setFreeCameraOptions(camera);
              rider.setLngLat([point.lon, point.lat]);
              if (inOverview) rider.addTo(map);
              inOverview = false;
              if (staging) {
                pendingPose = {point,eye,target,eyeZ,targetZ,
                  draw:() => drawPose(point,true,focus,angle,0,false)};
                // The playback RAF may follow the SDK render RAF in the same
                // paint. Keep the relief registered to this newer pose too.
                if (blend && eyeZ != null && targetZ != null) {
                  const p = map.project(rider.getLngLat()), m = container.getBoundingClientRect();
                  alignRelief(point,new DOMPoint(m.x+p.x,m.y+p.y),blend);
                }
              }
            } catch { fallback(); }
          }
          connect(drawPose);
        });
      } catch { fallback(); }
    });
  }).catch(fallback);
};
