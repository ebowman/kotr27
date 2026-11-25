import { cameraPose, routeBounds, routeLine, frameEvidence, flyoverLimits as limits } from './route-flyover.mjs';

// One lazy map, no preloading, no automatic retries, no autonomous camera RAF.
// Only approved, already verified geometry may reach this adapter.
export async function mountRouteTerrain({container,analysis,snapshot,onStatus,onManual,signal}) {
  await import('../assets/terrain.js');
  if (signal.aborted) return;
  await import('./config.js');
  const tools=window.kotrTerrainTools;
  if (!await tools.loadSDK() || signal.aborted) {
    if (!signal.aborted) onStatus('unavailable','Map library unavailable.');
    return;
  }
  const gl=window.mapboxgl;
  if (!gl?.supported() || !window.KOTR_CONFIG?.MAPBOX_TOKEN) {
    onStatus('unavailable','WebGL or provider configuration unavailable.'); return;
  }
  window.kotrDisposeTerrain?.();
  const imageConcurrency=gl.maxParallelImageRequests;
  gl.maxParallelImageRequests=4;
  let map, rider, ready=false, presented=false, stopped=false, manual=false, current=snapshot;
  let refinements={}, lastPaint=-Infinity, timer, requests=0, updating=false;
  const beacon=document.createElement('div'); beacon.className='route-rider';
  beacon.setAttribute('aria-label','Selected rider position');
  function dispose() {
    if (stopped) return;
    stopped=true; clearTimeout(timer); container.style.visibility='hidden'; map?.remove();
    gl.maxParallelImageRequests=imageConcurrency;
    if (window.kotrDisposeTerrain===dispose) delete window.kotrDisposeTerrain;
  }
  window.kotrDisposeTerrain=dispose;
  signal.addEventListener('abort',dispose,{once:true});
  function fail(reason) {
    if (stopped) return;
    dispose(); onStatus('unavailable',reason);
  }
  function waiting() {
    // Initial proof gates presentation, not every camera/tile refinement.
    // Keep an already presented map during the bounded verification interval;
    // this is NOT a valid-frame claim. Terminal failure still removes it.
    if (!presented) container.style.visibility='hidden';
    else onStatus('verifying','Satellite terrain · verifying the current view.');
    // One deadline per coverage outage. Motion/tile traffic cannot extend it.
    timer ??= setTimeout(()=>fail('Imagery, elevation or an unobstructed rider view could not be verified.'),limits.coverageMs);
  }
  const withinPixels=()=>container.clientWidth*container.clientHeight*devicePixelRatio**2<=limits.maxPixels;
  if (!withinPixels()) {
    fail('This display exceeds the bounded 3D frame size. Use linked 2D/profile or a smaller window.');return;
  }
  timer=setTimeout(()=>fail('Online terrain did not become ready within 12 seconds.'),limits.loadMs);
  try {
    map=new gl.Map({
      container,accessToken:window.KOTR_CONFIG.MAPBOX_TOKEN,
      style:{version:8,sources:{
        satellite:{type:'raster',url:'mapbox://mapbox.satellite',tileSize:256,maxzoom:12},
        dem:{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:11},
      },layers:[{id:'satellite',type:'raster',source:'satellite',paint:{'raster-fade-duration':0}}]},
      ...cameraPose(analysis,current),maxZoom:limits.maxZoom,maxPitch:limits.maxPitch,
      maxTileCacheSize:limits.tileCache,fadeDuration:0,renderWorldCopies:false,
      antialias:false,refreshExpiredTiles:false,preserveDrawingBuffer:false,
      transformRequest(url,type) {
        if (type==='Tile' && ++requests>limits.tileRequests) {
          queueMicrotask(()=>fail('This view reached its bounded tile budget. Use 2D/profile, or explicitly enable again.'));
          return {url:'data:application/json,{}'};
        }
        return {url};
      },
    });
    map.addControl(new gl.NavigationControl({showZoom:false,visualizePitch:true}),'top-right');
    // Requests remain SDK-managed, visible-region only. No route-wide prefetch.
    map.on('error',()=>fail('Online imagery or elevation failed.'));
    map.on('webglcontextlost',()=>fail('WebGL context lost.'));
    map.on('movestart',e=>{
      if (!e.originalEvent || updating) return;
      manual=true; onManual();
    });
    map.on('moveend',()=>{
      if (manual && !stopped) map.triggerRepaint();
    });
    map.once('load',()=>{
      if (stopped) return;
      try {
        // As in the example adapter, retain a bounded coarse cover from the
        // SAME imagery source while oblique proxy regions refine. A loaded
        // detailed neighbour alone is not evidence for the entire viewport.
        const sat=map.getSource('satellite');
        map.addSource('sat-cover',{type:'raster',tiles:sat.tiles,tileSize:sat.tileSize,
          scheme:sat.scheme,maxzoom:10});
        map.addLayer({id:'sat-cover',type:'raster',source:'sat-cover',
          paint:{'raster-fade-duration':0}},'satellite');
        map.addSource('route',{type:'geojson',tolerance:0,data:{type:'Feature',
          properties:{},geometry:{type:'LineString',coordinates:routeLine(analysis)}}});
        map.addLayer({id:'route',type:'line',source:'route',
          paint:{'line-color':'#ff932e','line-width':5}});
        map.setTerrain({source:'dem',exaggeration:1});
        rider=new gl.Marker({element:beacon,anchor:'center'}).setLngLat(cameraPose(analysis,current).center).addTo(map);
        for(const [point,text,offset] of [[analysis.points[0],'S',[-12,-12]],[analysis.points.at(-1),'F',[12,12]]]) {
          const mark=document.createElement('span');mark.className='route-endpoint';mark.textContent=text;
          mark.title=text==='S' ? 'Source route start' : 'Source route finish';
          new gl.Marker({element:mark,offset}).setLngLat([point.lon,point.lat]).addTo(map);
        }
        const imageryReady=tools.rasterCoverage(map);
        ready=true;
        map.on('render',()=>{
          if (stopped || !ready || document.hidden) return;
          try {
            if (!withinPixels()) { fail('This display exceeds the bounded 3D frame size.');return; }
            const proof=frameEvidence(map,current.position,beacon,container,imageryReady);
            container.dataset.frame=JSON.stringify(proof);
            container.dataset.distance=String(current.distanceM);
            container.dataset.requests=String(requests);
            if (!proof.ok) { waiting(); return; }
            clearTimeout(timer); timer=null;
            presented=true;
            container.style.visibility='visible';
            onStatus('ready',manual ? 'Manual exploration · Return to rider to follow.' :
              'Satellite terrain · orange route, white-ring rider. Compass: north; route direction shown below.');
          } catch { fail('Rendered terrain could not be verified.'); }
        });
        update(current,true);
      } catch { fail('Terrain setup unavailable.'); }
    });
  } catch { fail('WebGL or terrain setup unavailable.'); }
  function update(s,force=false,options=refinements) {
    refinements=options;
    if (stopped || !ready || !s.position || document.hidden) return;
    if (!force && s.phase==='playing' && performance.now()-lastPaint<limits.frameMs) return;
    current=s;
    lastPaint=performance.now();
    try {
      updating=true;
      const pose=cameraPose(analysis,s,options);
      rider.setLngLat(pose.center);
      if (!manual || force) {
        manual=false;
        if (s.cameraMode==='overview') map.fitBounds(routeBounds(analysis),{
          padding:40,duration:0,bearing:0,pitch:0,maxZoom:limits.maxZoom});
        else map.jumpTo(pose);
      }
      delete container.dataset.frame;
      delete container.dataset.distance;
      waiting();
      map.triggerRepaint();
    } catch { fail('Selected route position or camera unavailable.'); }
    finally { updating=false; }
  }
  return {update,dispose,resize:()=>map?.resize()};
}
