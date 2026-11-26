import { cameraPose, createRoutePresentation, followBearing, routeBounds, routeLine, routeSection, frameEvidence, flyoverLimits as limits } from './route-flyover.mjs';

// One lazy map, no preloading/retries or independent playback clock.
// Only approved, already verified geometry may reach this adapter.
export async function mountRouteTerrain({container,analysis,snapshot,onStatus,onManual,onPresent,signal}) {
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
  let map, rider, ghost, ready=false, presented=false, stopped=false, manual=false, current=snapshot;
  let refinements={}, lastPaint=-Infinity, lastProof=-Infinity, timer, requests=0, updating=false;
  let bearing, frame, proofTimer, sequence=0, renderSequence=0, proofSequence=0, proof, status, outageAt;
  let highlighted;
  const presentation=createRoutePresentation(analysis);
  function announce(name,message) {
    const key=name+message;
    if (status===key) return;
    status=key;onStatus(name,message);
  }
  function invalidate() {
    if (proof?.current) {
      proof={...proof,current:false};
      container.dataset.frame=JSON.stringify(proof);
    }
  }
  const beacon=document.createElement('div'); beacon.className='route-rider';
  beacon.setAttribute('aria-label','Selected rider position');
  const ghostBeacon=document.createElement('div');ghostBeacon.className='route-ghost';
  ghostBeacon.setAttribute('aria-label','Diamond baseline rider');
  ghostBeacon.hidden=true;
  ghostBeacon.innerHTML='<svg viewBox="-22 -22 44 44" aria-hidden="true"><path class="ghost-diamond" d="M0,-20 L20,0 L0,20 L-20,0 Z"/></svg>';
  for (const key of ['frame','pose','renderSequence','distance','requests','camera']) delete container.dataset[key];
  function dispose() {
    if (stopped) return;
    stopped=true; clearTimeout(timer); clearTimeout(proofTimer); cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange',visibility);
    signal.removeEventListener('abort',dispose);
    invalidate();
    container.style.visibility='hidden'; map?.remove();
    gl.maxParallelImageRequests=imageConcurrency;
    if (window.kotrDisposeTerrain===dispose) delete window.kotrDisposeTerrain;
  }
  window.kotrDisposeTerrain=dispose;
  signal.addEventListener('abort',dispose,{once:true});
  function fail(reason) {
    if (stopped) return;
    dispose(); announce('unavailable',reason);
  }
  function waiting() {
    // Initial proof gates presentation, not every camera/tile refinement.
    // Keep an already presented map during the bounded verification interval;
    // this is NOT a valid-frame claim. Terminal failure still removes it.
    if (!presented) container.style.visibility='hidden';
    outageAt ??= performance.now();
    // A single transient missed proof is not a new cockpit/ARIA announcement.
    if (presented && performance.now()-outageAt>=400)
      announce('verifying',manual ? 'Manual exploration · verifying viewport terrain.' :
        'Satellite terrain · verifying the current rider view.');
    // One deadline per coverage outage. Motion/tile traffic cannot extend it.
    timer ??= setTimeout(()=>fail(manual ?
      'Manual viewport imagery, elevation or rendered depth could not be verified.' :
      'Imagery, elevation or an unobstructed rider view could not be verified.'),limits.coverageMs);
  }
  function visibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);frame=undefined;
      clearTimeout(proofTimer);proofTimer=undefined;
      invalidate();
    }
  }
  document.addEventListener('visibilitychange',visibility);
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
      if (stopped || !e.originalEvent || updating) return;
      manual=true; onManual();
      status=undefined;
      invalidate();
      waiting();
    });
    map.on('move',()=>{if (!stopped) invalidate();});
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
        map.addSource('selected-section',{type:'geojson',tolerance:0,
          data:{type:'FeatureCollection',features:[]}});
        map.addLayer({id:'selected-section',type:'line',source:'selected-section',
          paint:{'line-color':'#ffe097','line-width':7,'line-opacity':0.9}});
        // 2.15 produces its terrain depth texture for circle/symbol layers.
        // No visible geometry or extra source/request: this enables the SDK's
        // own current-frame occlusion pass, read by frameEvidence on render.
        map.addLayer({id:'terrain-depth-pass',type:'circle',source:'route',
          paint:{'circle-opacity':0}});
        map.setTerrain({source:'dem',exaggeration:1});
        ghost=new gl.Marker({element:ghostBeacon,anchor:'center'}).setLngLat(cameraPose(analysis,current).center).addTo(map);
        // Live rider paints last if the hollow ghost crosses its position.
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
            const now=performance.now();
            container.dataset.renderSequence=String(++renderSequence);
            invalidate();
            if (now-lastProof<limits.frameMs) {
              proofTimer ??= setTimeout(()=>{
                proofTimer=undefined;
                if (!stopped && !document.hidden) map.triggerRepaint();
              },limits.frameMs-(now-lastProof));
              return;
            }
            clearTimeout(proofTimer);proofTimer=undefined;
            lastProof=now;
            proof={...frameEvidence(map,current.position,beacon,container,imageryReady,manual?'manual':'follow'),
              current:true,at:now,sequence,renderSequence,proofSequence:++proofSequence,distanceM:current.distanceM,
              geometrySha256:analysis.identity.geometrySha256};
            container.dataset.frame=JSON.stringify(proof);
            container.dataset.distance=String(current.distanceM);
            container.dataset.requests=String(requests);
            if (!proof.ok) {
              waiting();
              proofTimer=setTimeout(()=>{
                proofTimer=undefined;
                if (!stopped && !document.hidden) map.triggerRepaint();
              },limits.frameMs);
              return;
            }
            clearTimeout(timer); timer=null;
            outageAt=undefined;
            presented=true;
            container.style.visibility='visible';
            announce('ready',manual ? 'Manual exploration · Return to rider to follow.' :
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
    cancelAnimationFrame(frame);frame=undefined;
    const now=performance.now();
    const reset=force || current.cameraMode!==s.cameraMode ||
      current.identity?.geometrySha256!==s.identity?.geometrySha256;
    if (reset) status=undefined;
    // Both existing owners publish on RAF and their other projections consume
    // that exact distance. Sparse owners must accept onPresent for their linked
    // profile too; never introduce a private lag behind an unaware consumer.
    paint(presentation.push(s,now,reset || !onPresent),now,force,reset);
    function tick(now) {
      frame=undefined;
      if (stopped || document.hidden) return;
      paint(presentation.sample(now),now);
      if (presentation.pending(now)) frame=requestAnimationFrame(tick);
    }
    if (!stopped && presentation.pending(now)) frame=requestAnimationFrame(tick);
  }
  function paint(s,now,force=false,reset=false) {
    const elapsed=now-lastPaint;
    current=s;
    lastPaint=now;
    try {
      updating=true;
      const pose=cameraPose(analysis,s,refinements);
      rider.setLngLat(pose.center);
      ghostBeacon.hidden=!s.baseline?.position;
      if (s.baseline?.position) {
        ghost.setLngLat([s.baseline.position.lon,s.baseline.position.lat]);
        ghostBeacon.dataset.distance=String(s.baseline.distanceM);
      }
      if (highlighted!==s.selectedChapterId) {
        highlighted=s.selectedChapterId;
        map.getSource('selected-section').setData(highlighted ? {type:'Feature',properties:{},
          geometry:{type:'LineString',coordinates:routeSection(analysis,highlighted)}} :
          {type:'FeatureCollection',features:[]});
        container.dataset.section=highlighted || '';
      }
      if (!manual || force) {
        manual=false;
        if (reset) bearing=undefined;
        if (s.cameraMode==='follow') pose.bearing=followBearing(pose.bearing,bearing,elapsed);
        bearing=pose.bearing;
        container.dataset.camera=JSON.stringify({bearing:pose.bearing,pitch:pose.pitch});
        if (['overview','section'].includes(s.cameraMode) && (reset || sequence===0)) map.fitBounds(routeBounds(analysis,
          s.cameraMode==='section' ? s.selectedChapterId : undefined),{
          padding:s.cameraMode==='section' ? refinements.sectionPadding ?? 40 : 40,
          duration:0,bearing:0,pitch:0,maxZoom:limits.maxZoom});
        // Section padding keeps the start/end out from under the cockpit.
        // Explicit Return must not carry that asymmetric framing into Follow.
        else if (!['overview','section'].includes(s.cameraMode)) map.jumpTo({...pose,...(reset ? {padding:0} : {})});
      }
      sequence++;
      container.dataset.pose=JSON.stringify({sequence,at:now,distanceM:s.distanceM,manual});
      container.dataset.distance=String(s.distanceM);
      invalidate();
      onPresent?.(s);
      map.triggerRepaint();
    } catch { fail('Selected route position or camera unavailable.'); }
    finally { updating=false; }
  }
  return {update,dispose,resize:()=>map?.resize()};
}
