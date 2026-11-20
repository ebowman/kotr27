// Enhance the local elevation profile. The controller owns playback time;
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

// Bound both work and camera height. The orbit follows the smoothed rail,
// but the clearance ray ends at the *actual* GPX rider on the SDK's DEM.
function terrainPose(map, point, focus, angle, prior, seconds, meshZoom=0) {
  const gps = [point.lon,point.lat], target = [focus.lon,focus.lat];
  const dx = focus.lon + 900*Math.sin(angle)/77450 - point.lon;
  const dy = focus.lat - 900*Math.cos(angle)/111200 - point.lat;
  const along = f => [point.lon + f*dx, point.lat + f*dy];
  const riderZ = map.queryTerrainElevation(gps), aimZ = map.queryTerrainElevation(target);
  const z0 = riderZ ?? point.height;
  let floor = 600 + Math.max(z0, aimZ ?? focus.height, focus.height);
  let rise = 0, firstMissing = Infinity;
  for (let i=1; i<=32; i++) {
    const f=i/32, z=map.queryTerrainElevation(along(f));
    if (z == null) { firstMissing = Math.min(firstMissing,f); continue; }
    if (i===32) floor = Math.max(floor,z+600);
    // At fraction f from the rider the sightline gains f * rise. Taper
    // the pad at its foot and leave headroom for coarser rendered meshes.
    rise=Math.max(rise,(1.5*(z-z0)+Math.min(45,180*f))/f);
  }
  // Instead of lifting the eye by an unbounded 1/f near the rider,
  // shorten its baseline along the same ray. Tighten immediately for
  // safety; ease back out when the terrain recedes.
  const relax = prior ? Math.exp(-seconds/.6) : 0;
  // When the SDK's coarser mesh disagrees, close in on the rider rather
  // than climbing ever higher (which can select even coarser tiles).
  floor = floor*(1-meshZoom) + (z0+600)*meshZoom;
  const altitude = floor + Math.max(0,(prior?.altitude ?? floor)-floor)*relax;
  // Tiles behind the lens may never be requested. Stop at the last
  // measured part of the ray rather than waiting for an offscreen tile
  // (or declaring an unmeasured baseline clear).
  const measured=riderZ==null ? 1 : Math.max(0,firstMissing-1/32);
  const limit = Math.min(measured,1-meshZoom, rise>0 ? (altitude-z0)/rise : 1);
  const reach = limit - Math.max(0,limit-(prior?.reach ?? limit))*relax;
  const eye = along(reach);
  const sampled = riderZ != null && aimZ != null && firstMissing>reach &&
    (reach===1 || map.queryTerrainElevation(eye)!=null);
  return {eye,altitude,target,aimZ,z0,reach,sampled,meshZoom};
}

// 2.15 has no public raster equivalent of queryRenderedFeatures. Inspect
// the pinned SDK's live raster source cache (not its speculative requests).
// A loaded parent is usable imagery while a sharper child is in flight.
function rasterCoverage(map) {
  const layer=map.getStyle().layers.find(l=>l.type==='raster');
  if (!layer) throw Error('Satellite layer unavailable');
  const cache=map.style._getSourceCache(layer.source), src=cache.getSource();
  return () => {
    const ids=cache.getRenderableIds();
    if (!ids.length) return false;
    // In 2.15 an errored tile is finished too. Even a settled source with
    // renderable neighbours can leave a hole in the destination viewport.
    const rendered=new Set(ids);
    const visible=map.transform.coveringTiles({tileSize:src.tileSize,minzoom:src.minzoom,
      maxzoom:src.maxzoom,roundZoom:src.roundZoom,reparseOverscaled:src.reparseOverscaled});
    return visible.length>0 && visible.every(id=>rendered.has(id.key) || cache.hasRenderableParent(id) ||
      id.children(src.maxzoom).every(child=>rendered.has(child.key)));
  };
}

window.startTerrain = function (points, connect, upcoming, setAvailability) {
  const container = document.getElementById('map');
  const message = document.getElementById('message');
  let map, stopped = false;
  let timer = setTimeout(fallback, 20000);
  function fallback() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    setAvailability('unavailable');
    message.textContent = 'Satellite terrain unavailable. Use the elevation profile below.';
    container.parentElement.hidden = true;
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
        const imageryReady=rasterCoverage(map);
        const coords = points.map(p => [p.lon, p.lat]);
        const bounds = coords.reduce((b, xy) => b.extend(xy), new gl.LngLatBounds());
        map.addSource('dem', {type:'raster-dem', url:'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize:512, maxzoom:14});
        map.setTerrain({source:'dem', exaggeration:1});
        map.addSource('ascent', {type:'geojson', data:{type:'LineString', coordinates:coords}});
        map.addLayer({id:'ascent', type:'line', source:'ascent', paint:{'line-color':'#ff932e','line-width':4}});
        const beacon = document.createElement('div');
        beacon.className = 'rider-beacon';
        beacon.setAttribute('aria-label', 'Rider position');
        const rider = new gl.Marker({element:beacon, anchor:'center'});
        let inOverview = false, pose, current, dirty = false, revision=0;
        function status(text) {
          if (message.textContent !== text) message.textContent = text;
        }
        // A discontinuous move can use stale parent tiles until the SDK's
        // first destination render. Only show a neutral loading surface in
        // that gap; ordinary playback never switches or hides renderers.
        function loading(cold=false,text='Loading satellite terrain…') {
          setAvailability('loading');
          if (cold) container.setAttribute('aria-busy','true');
          status(text);
          if (!timer) timer = setTimeout(fallback,20000);
        }
        function rendered() {
          clearTimeout(timer); timer=0;
          if (container.getAttribute('aria-busy')==='true') container.setAttribute('aria-busy','false');
          status('Satellite terrain · The orange line traces the ascent.');
          setAvailability('ready');
        }
        function overview() {
          loading(true);
          rider.remove();
          map.jumpTo({pitch:0, bearing:0});
          map.fitBounds(bounds, {padding:40, duration:0});
          inOverview = true;
          current = null;
        }
        function attachCamera() {
          // A marker fade can arrive after the final idle render of a seek
          // or pause. Check that pose again even without a player RAF.
          let previousOpacity=beacon.style.opacity;
          new MutationObserver(()=>{
            const opacity=beacon.style.opacity;
            if (opacity===previousOpacity) return; // unrelated transform write
            previousOpacity=opacity;
            if (!stopped && !inOverview) map.triggerRepaint();
          }).observe(beacon,{attributes:true,attributeFilter:['style']});
          map.on('sourcedata', e => {
            if (e.sourceId==='dem') dirty=true;
            if (timer && !stopped && e.sourceDataType==='content') {
              clearTimeout(timer); timer=setTimeout(fallback,20000);
            }
          });
          let nextCheck = 0, lastDistance = -Infinity, disabled = false;
          let meshZoom = 0, lastPick = -Infinity, adjusting = false, needsPick = false, lastMarkerRefresh=-Infinity;
          map.on('idle', () => {
            // A pause may end inside the moving camera's sampling interval.
            if (!stopped && !inOverview && needsPick && pose.sampled && imageryReady()) {
              lastPick = -Infinity;
              map.triggerRepaint();
            }
          });
          map.on('render', () => {
            if (stopped) return;
            const imagery=imageryReady();
            if (inOverview) { if (imagery) rendered(); else loading(); return; }
            const paintedRevision=revision;
            const now = performance.now();
            // A paused seek has no player RAF. Re-evaluate the *same* pose
            // after streamed DEM tiles enter the SDK's terrain mesh.
            const refreshed=dirty || !pose.sampled;
            if (refreshed) {
              dirty = false;
              drawPose(...current, 0, false);
              if (stopped) return;
            }
            // The SDK picks a simplified terrain mesh, not the underlying
            // raster samples. If that mesh still intercepts the rendered
            // ray, steepen the real camera gradually, with a hard upper
            // bound. Never infer an obstruction from unloaded tiles.
            const cold=container.getAttribute('aria-busy')==='true';
            const demReady=pose.sampled && (!cold || map.isSourceLoaded('dem'));
            const dim=+getComputedStyle(beacon).opacity!==1;
            const gps=rider.getLngLat(), p=map.project(gps);
            const road=imagery && demReady && map.queryRenderedFeatures(
              [[p.x-4,p.y-4],[p.x+4,p.y+4]],{layers:['ascent']}).length>0;
            // If road tiles are settled but the road is not at the projected
            // rider, the picked mesh may still be in front of the route.
            const roadHidden=!road && map.isSourceLoaded('ascent');
            let clear=!adjusting;
            if (demReady && imagery && (cold || needsPick || adjusting || dim || roadHidden) &&
                (cold && !adjusting || refreshed || now-lastPick>=(adjusting ? 32 : 150))) {
              const dt=Math.min(.05,(now-lastPick)/1000);
              lastPick=now;
              needsPick=false;
              try {
                const eye=map.getFreeCameraOptions().position.toLngLat();
                const hit=map.unproject(p), distance=eye.distanceTo(gps);
                clear = distance<1 ? gps.distanceTo(hit)<1 : eye.distanceTo(hit)>=.93*distance;
                if (cold) clear=clear && gps.distanceTo(hit)<Math.max(1,.01*distance);
                // Marker occlusion uses its rounded DOM pixel, which can
                // pick a different triangle on a steep terrain edge.
                if (dim && distance>=1) clear=clear && eye.distanceTo(map.unproject(
                  [Math.round(p.x),Math.round(p.y)]))>=.9*distance;
                const framed=Math.min(p.x,p.y,container.clientWidth-p.x,container.clientHeight-p.y)>=12;
                adjusting = (!clear || !framed || roadHidden) && meshZoom<1;
              } catch { fallback(); return; }
              if (adjusting) {
                meshZoom=Math.min(1,meshZoom+dt);
                drawPose(...current,dt,false,true);
                if (stopped) return;
              }
            }
            // render follows the SDK's DOM queue, but a DEM refinement
            // during that render may have changed the projected position.
            // Reproject via the SDK; don't reveal a camera written *after*
            // the paint or a marker still waiting on a queued DOM update.
            const m=container.getBoundingClientRect();
            const aligned=()=>{
              const b=beacon.getBoundingClientRect();
              return b.width>=19.99 && Math.min(b.left-m.left,m.right-b.right,b.top-m.top,m.bottom-b.bottom)>=2 &&
                Math.hypot(b.x+b.width/2-m.x-p.x,b.y+b.height/2-m.y-p.y)<1.6;
            };
            let registered=aligned();
            // A repaint alone does not schedule the SDK's marker fade check.
            // Reproject a stale dim marker at the same GPS position, giving
            // its normal occlusion timer time to sample the settled mesh.
            if (!registered || (dim && now-lastMarkerRefresh>=150)) {
              lastMarkerRefresh=now;
              rider.setLngLat(gps);
              registered=aligned();
            }
            const usable=imagery && demReady && clear && revision===paintedRevision &&
              registered && road && !dim;
            if (usable) rendered();
            else {
              loading(false,!imagery ? 'Loading satellite imagery…' : !demReady ? 'Loading terrain elevation…'
                : registered && !road ? 'Loading ascent road…' : 'Loading rider view…');
              if (imagery && demReady && (!registered || road || roadHidden || dim)) map.triggerRepaint();
              return;
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
          function drawPose(point, following, focus, angle, seconds, snap, correcting=false) {
            if (stopped) return;
            try {
              if (!following) { if (!inOverview) overview(); return; }
              if (snap || inOverview) { loading(true); adjusting=false; lastPick=-Infinity; }
              if (snap || inOverview) meshZoom=0;
              else if (!correcting && !adjusting) meshZoom*=Math.exp(-seconds/3);
              current = [point, following, focus, angle];
              const prior = pose;
              pose = terrainPose(map,point,focus,angle,snap || inOverview ? null : prior,seconds,meshZoom);
              const {eye,altitude,target,aimZ,z0} = pose;
              if (snap || inOverview || altitude!==prior.altitude || aimZ!==prior.aimZ || z0!==prior.z0 || meshZoom!==prior.meshZoom ||
                  eye.some((v,i)=>v!==prior.eye[i]) || target.some((v,i)=>v!==prior.target[i])) {
                const camera = map.getFreeCameraOptions();
                camera.position = gl.MercatorCoordinate.fromLngLat(eye, altitude);
                // The rail can cut across a high cliff or a deep ravine.
                // Keep its smooth horizontal aim without pointing the lens
                // hundreds of metres over (or under) the actual rider.
                if (meshZoom || !pose.reach || (aimZ!=null && Math.abs(aimZ-z0)>100)) {
                  const east=(target[0]+(point.lon-target[0])*meshZoom-eye[0])*77450;
                  const north=(target[1]+(point.lat-target[1])*meshZoom-eye[1])*111200;
                  const z=z0+Math.max(-100,Math.min(100,(aimZ ?? z0)-z0))*(1-meshZoom);
                  camera.setPitchBearing(Math.atan2(Math.hypot(east,north),altitude-z)*180/Math.PI,
                    (Math.hypot(east,north)<.01 ? -angle : Math.atan2(east,north))*180/Math.PI);
                } else camera.lookAtPoint(target);
                map.setFreeCameraOptions(camera);
                revision++;
              }
              rider.setLngLat([point.lon, point.lat]);
              needsPick=true;
              if (inOverview) rider.addTo(map);
              inOverview = false;
            } catch { fallback(); }
          }
          connect(drawPose);
        }
        overview();
        attachCamera();
      } catch { fallback(); }
    });
  }).catch(fallback);
};
