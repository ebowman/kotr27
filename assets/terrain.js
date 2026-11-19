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
window.startTerrain = function (points, connect, upcoming) {
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
        const rider = new gl.Marker({color:'#ffdc56', scale:.65});
        let inOverview = false, altitude;
        function overview() {
          rider.remove();
          map.jumpTo({pitch:0, bearing:0});
          map.fitBounds(bounds, {padding:40, duration:0});
          inOverview = true;
        }
        overview();
        map.once('idle', () => {
          if (stopped) return;
          clearTimeout(timer);
          container.parentElement.classList.add('terrain');
          message.textContent = 'Satellite terrain · The orange line traces the ascent.';
          let nextCheck = 0, lastDistance = -Infinity, disabled = false;
          map.on('render', () => {
            const now = performance.now();
            if (stopped || disabled || inOverview || now < nextCheck || savingTerrainData()) return;
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
          connect((point, following, focus, angle, seconds, snap) => {
            if (stopped) return;
            try {
              if (!following) { if (!inOverview) overview(); return; }
              // Wide orbit about the filtered focus, independent of road heading.
              const radius = 900;
              const eye = [focus.lon + radius * Math.sin(angle) / 77450,
                focus.lat - radius * Math.cos(angle) / 111200];
              const target = [focus.lon, focus.lat];
              const floor = 600 + Math.max(focus.height, map.queryTerrainElevation(eye) ?? focus.height,
                map.queryTerrainElevation(target) ?? focus.height);
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
            } catch { fallback(); }
          });
        });
      } catch { fallback(); }
    });
  }).catch(fallback);
};
