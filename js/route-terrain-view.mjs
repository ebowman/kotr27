import { cameraPose, createRideCamera, createTerrainBudget, createRoutePresentation, followBearing, shortestAngle, routeBounds, routeLine, routeSection, frameEvidence, riderGeometry, riderOrbit, riderFrameEvidence, riderRasterEvidence, riderTerrainElevation, riderTerrainCeiling, riderLimits, flyoverLimits as limits } from './route-flyover.mjs';

// One lazy map, no preloading/retries or independent playback clock.
// Only approved, already verified geometry may reach this adapter.
export async function mountRouteTerrain({container,analysis,snapshot,onStatus,onManual,onPresent,signal,
  camera=createRideCamera(),onCamera}) {
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
  let refinements={}, lastPaint=-Infinity, lastProof=-Infinity, timer, updating=false;
  let bearing, frame, proofTimer, sequence=0, renderSequence=0, proofSequence=0, proof, status, outageAt;
  let sceneLoading=true, hasPresented=false, deadlineVersion=0;
  let highlighted, routeDetail;
  let forward, riderView=false, riderRelocation=false, imageryReady, zoomStart, zoomPreference;
  const budget=createTerrainBudget();
  const wantsRider=s=>camera.view==='rider' && s.cameraMode==='follow';
  const detailAt=s=>Math.floor((s.position?.pointIndexes?.[0] ?? 0)/limits.detailStep)*limits.detailStep;
  const zoomIntent=e=> {
    const input=e.originalEvent;
    return input && (input.type==='wheel' || input.type==='dblclick' ||
      input.type==='keydown' && ['+','=','-','_'].includes(input.key) ||
      input.type.startsWith('touch') && input.touches?.length>=2);
  };
  let nativeZoom=false, touching=false, pointing=false, wheelUntil=0;
  const inputCleanup=[];
  let pinch, restoreDrag=false;
  function cancelPinch() {
    pinch=undefined;
    if (restoreDrag) {map.dragPan.enable();restoreDrag=false;}
  }
  function configureRiderInput(active) {
    cancelPinch();
    for (const handler of [map.scrollZoom,map.touchZoomRotate,map.doubleClickZoom,map.keyboard]) {
      if (active) handler.disable();else handler.enable({around:'center'});
    }
    touching=false;nativeZoom=false;wheelUntil=0;
  }
  function installRiderInput() {
    const surface=map.getCanvasContainer();
    const listen=(name,fn)=> {
      surface.addEventListener(name,fn,{capture:true,passive:false});
      inputCleanup.push(()=>surface.removeEventListener(name,fn,true));
    };
    const owned=e=>riderView && !manual && !stopped && !e.defaultPrevented;
    const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
    const distance=value=>{
      camera.setZoom(value);onCamera?.(camera.zoom);
      container.dataset.input=JSON.stringify({view:'rider',desiredZoom:camera.zoom,at:performance.now()});
      update(current);
    };
    listen('wheel',e=>{
      if (!owned(e)) return;
      consume(e);
      const pixels=e.deltaY*(e.deltaMode===1?40:e.deltaMode===2?container.clientHeight:1);
      distance(camera.zoom-Math.max(-240,Math.min(240,pixels))*.006);
    });
    listen('keydown',e=>{
      if (!owned(e) || e.target!==map.getCanvas() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['+','=','-','_'].includes(e.key)) {
        consume(e);distance(camera.zoom+(['+','='].includes(e.key)?.5:-.5));
      } else if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        consume(e);manual=true;onManual();invalidate();waiting();
        const offset={ArrowLeft:[-100,0],ArrowRight:[100,0],ArrowUp:[0,-100],ArrowDown:[0,100]}[e.key];
        map.panBy(offset,{duration:0});
      }
    });
    const gap=e=>Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    listen('touchstart',e=>{
      if (!owned(e) || e.touches.length<2) return;
      consume(e);touching=false;pointing=false;
      if (!pinch) {
        restoreDrag=map.dragPan.isEnabled();
        if (restoreDrag) map.dragPan.disable();
        pinch={gap:gap(e),zoom:camera.zoom};
      }
    });
    listen('touchmove',e=>{
      if (!owned(e) || !pinch || e.touches.length<2) return;
      consume(e);
      if (pinch.gap>0) distance(pinch.zoom+Math.log2(gap(e)/pinch.gap)*3);
    });
    for(const name of ['touchend','touchcancel']) listen(name,e=>{
      if (!pinch) return;
      consume(e);
      if (name==='touchcancel' || e.touches.length<2) {
        cancelPinch();touching=false;
        update(current);
      }
    });
  }
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
  for (const key of ['frame','pose','renderSequence','distance','requests','uniqueRequests','camera','input']) delete container.dataset[key];
  function dispose() {
    if (stopped) return;
    stopped=true; clearDeadline(); clearTimeout(proofTimer); cancelAnimationFrame(frame);
    cancelPinch();
    for(const cleanup of inputCleanup) cleanup();
    document.removeEventListener('visibilitychange',visibility);
    document.removeEventListener('mouseup',releasePointer);
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
  function clearDeadline() {
    clearTimeout(timer);timer=null;deadlineVersion++;
  }
  function deadline(ms,reason) {
    clearDeadline();
    const version=deadlineVersion;
    timer=setTimeout(()=>{if(version===deadlineVersion)fail(reason);},ms);
  }
  function beginRiderScene() {
    sceneLoading=true;presented=false;outageAt=undefined;
    deadline(limits.loadMs,'Selected Rider terrain did not become ready within 12 seconds.');
    invalidate();container.style.visibility='hidden';
    announce('relocating','Loading selected Rider terrain · 2D preview.');
  }
  function waiting() {
    // Initial proof gates presentation, not every camera/tile refinement.
    // Keep an already presented map during the bounded verification interval;
    // this is NOT a valid-frame claim. Terminal failure still removes it.
    if (!presented) container.style.visibility='hidden';
    // A newly requested scene has never had current proof. It gets the same
    // finite acquisition budget as initial map loading, not the short outage
    // budget of an established view. Traffic and render retries never renew it.
    if(sceneLoading)return;
    outageAt ??= performance.now();
    // A single transient missed proof is not a new cockpit/ARIA announcement.
    if (presented && performance.now()-outageAt>=400)
      announce('verifying',manual ? 'Manual exploration · verifying viewport terrain.' :
        'Satellite terrain · verifying the current rider view.');
    // One deadline per coverage outage. Motion/tile traffic cannot extend it.
    if(timer===null || timer===undefined)deadline(limits.coverageMs,manual ?
      'Manual viewport imagery, elevation or rendered depth could not be verified.' :
      'Imagery, elevation or an unobstructed rider view could not be verified.');
  }
  function visibility() {
    if (document.hidden) {
      cancelPinch();
      touching=false;pointing=false;
      cancelAnimationFrame(frame);frame=undefined;
      clearTimeout(proofTimer);proofTimer=undefined;
      invalidate();
    }
  }
  document.addEventListener('visibilitychange',visibility);
  function releasePointer() {
    pointing=false;
    if (!stopped && ready) update(current);
  }
  document.addEventListener('mouseup',releasePointer);
  const withinPixels=()=>container.clientWidth*container.clientHeight*devicePixelRatio**2<=limits.maxPixels;
  if (!withinPixels()) {
    fail('This display exceeds the bounded 3D frame size. Use linked 2D/profile or a smaller window.');return;
  }
  deadline(limits.loadMs,'Online terrain did not become ready within 12 seconds.');
  try {
    map=new gl.Map({
      container,accessToken:window.KOTR_CONFIG.MAPBOX_TOKEN,
      style:{version:8,sources:{
        satellite:{type:'raster',url:'mapbox://mapbox.satellite',tileSize:256,maxzoom:12},
        dem:{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:11},
      },layers:[{id:'sky-background',type:'background',paint:{'background-color':'#bdcfdb'}},
        {id:'satellite',type:'raster',source:'satellite',paint:{'raster-fade-duration':0}},
        {id:'sky',type:'sky',paint:{'sky-type':'gradient','sky-gradient-center':[0,0],'sky-gradient-radius':90,
          'sky-gradient':['interpolate',['linear'],['sky-radial-progress'],0,'#a8c4d6',1,'#d7e2e8']}}]},
      ...cameraPose(analysis,current,{zoom:camera.zoom}),
      // v2.15 snapshots map.maxZoom when constructing its drape proxy source.
      // Initialize that render resolution for Rider; restore the aerial input
      // bound after its first terrain draw. Later setMaxZoom alone cannot refine
      // an already-created proxy and makes close route ink blurred/discontinuous.
      minZoom:limits.minZoom,maxZoom:riderLimits.maxZoom,maxPitch:limits.maxPitch,
      scrollZoom:{around:'center'},touchZoomRotate:{around:'center'},
      maxTileCacheSize:limits.tileCache,fadeDuration:0,renderWorldCopies:false,
      antialias:false,refreshExpiredTiles:false,preserveDrawingBuffer:false,
      transformRequest(url,type) {
        if (!budget.consume(url,type)) {
          queueMicrotask(()=>fail('This view reached its bounded tile budget. Use 2D/profile, or explicitly enable again.'));
          return {url:'data:application/json,{}'};
        }
        return {url};
      },
    });
    map.addControl(new gl.NavigationControl({showZoom:false,visualizePitch:true}),'top-right');
    installRiderInput();
    // Requests remain SDK-managed, visible-region only. No route-wide prefetch.
    map.on('error',()=>fail('Online imagery or elevation failed.'));
    map.on('webglcontextlost',()=>fail('WebGL context lost.'));
    map.on('sourcedata',e=>{
      // The SDK updates its elevation lookup and constrains the camera before
      // its next draw. Account for newly loaded DEM data before that boundary,
      // not on the render event after an already-displaced frame.
      if(e.sourceId==='rider-dem' && ready && riderView && !manual && !updating && !stopped)
        update(current);
    });
    // Gestures need samples before the SDK calls them zooming/dragging.
    // A follow jumpTo/stop during recognition resets the native handler.
    // Hold only camera following, not the ride clock; actual pan/rotation
    // below explicitly transfers ownership and pauses the ride.
    map.on('mousedown',()=>{pointing=true;});
    // Aerial/manual retain SDK wheel recognition. FOLLOW Rider captures wheel
    // before SDK handlers and applies its own distance intent instead.
    map.on('wheel',()=>{wheelUntil=performance.now()+120;});
    map.on('touchstart',e=>{touching=e.originalEvent.touches.length>0;});
    map.on('touchend',e=>{touching=e.originalEvent.touches.length>0;});
    map.on('touchcancel',()=>{touching=false;});
    const inspect=e=>{
      if (stopped || !e.originalEvent || updating) return;
      // Two-finger translation is part of a pinch, not deliberate inspection.
      if (e.type==='dragstart' && e.originalEvent.touches?.length>1) return;
      manual=true; onManual();
      status=undefined;
      invalidate();
      waiting();
    };
    for (const event of ['dragstart','rotatestart','pitchstart']) map.on(event,inspect);
    map.on('movestart',e=>{
      if (e.originalEvent?.type==='keydown' && e.originalEvent.key.startsWith('Arrow')) inspect(e);
    });
    map.on('zoomstart',e=>{
      if (!updating) {
        nativeZoom=!!zoomIntent(e);
        if (nativeZoom) {zoomStart=map.getZoom();zoomPreference=camera.zoom;}
      }
    });
    map.on('zoom',e=>{
      if (stopped || updating || !nativeZoom && !zoomIntent(e)) return;
      const zoom=map.getZoom();
      // SDK terrain anchoring can round an endpoint by a fraction of a pixel.
      camera.setZoom(riderView ? zoomPreference+zoom-zoomStart :
        Math.abs(zoom-limits.maxZoom)<.001 ? limits.maxZoom :
        Math.abs(zoom-limits.minZoom)<.001 ? limits.minZoom : zoom);
      onCamera?.(camera.zoom);
    });
    map.on('zoomend',()=>{
      // Finish the SDK's animation before applying follow again. jumpTo during
      // that animation calls stop(), cancelling wheel/keyboard/pinch zoom.
      nativeZoom=false;
      if (!stopped && !updating) update(current);
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
        routeDetail=detailAt(current);
        map.addSource('route',{type:'geojson',tolerance:0,data:{type:'Feature',
          properties:{},geometry:{type:'LineString',coordinates:routeLine(analysis,routeDetail)}}});
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
        map.once('render',()=>{
          if (!stopped && !riderView) {
            updating=true;
            try {map.setMaxZoom(limits.maxZoom);} finally {updating=false;}
          }
        });
        ghost=new gl.Marker({element:ghostBeacon,anchor:'center'}).setLngLat(cameraPose(analysis,current).center).addTo(map);
        // Live rider paints last if the hollow ghost crosses its position.
        rider=new gl.Marker({element:beacon,anchor:'center'}).setLngLat(cameraPose(analysis,current).center).addTo(map);
        for(const [point,text,offset] of [[analysis.points[0],'S',[-12,-12]],[analysis.points.at(-1),'F',[12,12]]]) {
          const mark=document.createElement('span');mark.className='route-endpoint';mark.textContent=text;
          mark.title=text==='S' ? 'Source route start' : 'Source route finish';
          new gl.Marker({element:mark,offset}).setLngLat([point.lon,point.lat]).addTo(map);
        }
        imageryReady=tools.rasterCoverage(map);
        ready=true;
        map.on('render',()=>{
          if (stopped || !ready || document.hidden) return;
          try {
            if (!withinPixels()) { fail('This display exceeds the bounded 3D frame size.');return; }
            const now=performance.now();
            // Finish bounded camera damping after Pause without advancing the
            // shared route distance/time. Otherwise a mid-switchback pause can
            // freeze a lagging heading with the road outside a phone frustum.
            if (riderView && !manual && !frame && now>=wheelUntil && !map.isZooming() && !touching && !pointing &&
                (!forward || Math.abs(map.queryTerrainElevation(forward.position)-forward.ground)>.25 ||
                  Math.abs(map.getFreeCameraOptions().position.toAltitude()-forward.altitude)>.5 ||
                  current.phase!=='playing' && (Math.abs(shortestAngle(forward.bearing,forward.target))>.1 ||
                    Math.abs(forward.yawRate)>.1 || Math.abs(forward.pitch-forward.targetPitch)>.1 ||
                    Math.abs(forward.support-forward.neededSupport)>.01)))
              frame=requestAnimationFrame(()=>{frame=undefined;update(current);});
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
            // Validate hit testing of a new scene before presenting it. The
            // synchronous render callback restores hidden visibility on
            // failure, before browser composition; no UI-occlusion exemption.
            const initialHidden=!presented && container.style.visibility==='hidden';
            if(initialHidden && riderView)container.style.visibility='visible';
            proof={...(riderView && !manual ? riderFrameEvidence(map,forward,points=>riderRasterEvidence(map,points),xy=>{
              const box=container.getBoundingClientRect();
              return document.elementFromPoint(box.left+xy.x,box.top+xy.y)===map.getCanvas();
            },gl.version,current.distanceM) :
              frameEvidence(map,current.position,beacon,container,imageryReady,manual?'manual':'follow')),
              current:true,at:now,sequence,renderSequence,proofSequence:++proofSequence,distanceM:current.distanceM,
              geometrySha256:analysis.identity.geometrySha256};
            if(initialHidden && !proof.ok)container.style.visibility='hidden';
            container.dataset.frame=JSON.stringify(proof);
            container.dataset.distance=String(current.distanceM);
            container.dataset.requests=String(budget.requests);
            container.dataset.uniqueRequests=String(budget.unique);
            if (!proof.ok) {
              waiting();
              proofTimer=setTimeout(()=>{
                proofTimer=undefined;
                if (!stopped && !document.hidden) map.triggerRepaint();
              },limits.frameMs);
              return;
            }
            clearDeadline();sceneLoading=false;hasPresented=true;
            outageAt=undefined;
            presented=true;
            container.style.visibility='visible';
            announce('ready',manual ? 'Manual exploration · Return to rider to follow.' : riderView ?
              'Rider · 2–9 m above approximate terrain; lifts on steep DEM. Not Street View.' :
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
    const previousDistance=current.distanceM;
    current=s;
    lastPaint=now;
    try {
      updating=true;
      // Deliberate inspection pauses and uses the existing aerial/manual proof
      // (no sky exemption). Return restores the requested Rider view/distance.
      const nextRider=wantsRider(s) && (!manual || force);
      if(hasPresented && nextRider &&
          (!riderView || reset && s.distanceM!==previousDistance))beginRiderScene();
      else if(hasPresented && riderView && !nextRider && sceneLoading) {
        // Explicitly leaving an unproved Rider scene cancels its deadline.
        // The returned aerial/manual view still has to obtain its own proof.
        clearDeadline();sceneLoading=false;outageAt=undefined;
      }
      if (nextRider!==riderView) {
        riderView=nextRider;forward=undefined;reset=true;
        riderRelocation=riderView;
        configureRiderInput(riderView);
        // Close imagery/DEM at two separated switchback regions needs more
        // distinct visible tiles than aerial z12/z11. One lifetime ceiling,
        // never reset by toggling views; concurrency 4/cache 32 remain fixed.
        if (riderView) budget.enableRider();
        // Public v2.15 APIs only. Detail is lazy, visible-region only and uses
        // the stated Rider request bounds and unchanged concurrency/cache,
        // not a route prefetch.
        if (riderView && !map.getSource('rider-dem')) {
          map.addSource('rider-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});
          map.addSource('rider-satellite',{type:'raster',url:'mapbox://mapbox.satellite',tileSize:256,maxzoom:18});
          map.addLayer({id:'rider-satellite',type:'raster',source:'rider-satellite',
            paint:{'raster-fade-duration':0}},'route');
        }
        if (map.getLayer('rider-satellite'))
          map.setLayoutProperty('rider-satellite','visibility',riderView?'visible':'none');
        map.setTerrain({source:riderView?'rider-dem':'dem',exaggeration:1});
        map.setMaxZoom(riderView?riderLimits.maxZoom:limits.maxZoom);
        map.setMaxPitch(riderView?riderLimits.maxPitch:limits.maxPitch);
        imageryReady=tools.rasterCoverage(map,map.getStyle().layers.filter(l=>l.type==='raster' &&
          l.layout?.visibility!=='none'));
      }
      beacon.hidden=riderView;
      const pose=cameraPose(analysis,s,{...refinements,zoom:camera.zoom});
      rider.setLngLat(pose.center);
      const detail=detailAt(s);
      if (detail!==routeDetail) {
        routeDetail=detail;
        map.getSource('route').setData({type:'Feature',properties:{},
          geometry:{type:'LineString',coordinates:routeLine(analysis,routeDetail)}});
      }
      ghostBeacon.hidden=riderView || !s.baseline?.position;
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
      if ((!manual || force) && ((now>=wheelUntil && !map.isZooming() && !touching && !pointing) || force)) {
        manual=false;
        if (reset) bearing=undefined;
        if (s.cameraMode==='follow' && !riderView) pose.bearing=followBearing(pose.bearing,bearing,elapsed);
        bearing=pose.bearing;
        container.dataset.camera=JSON.stringify({bearing:pose.bearing,pitch:pose.pitch});
        if (riderView) {
          // Continuous geometry needs the same current-source DEM lookup as frame proof.
          // The public lookup can omit an uploaded tile just outside the active
          // frustum. Dropping the pose there freezes the camera while the one
          // ride clock continues. This reads guarded current texels, not a held
          // height, route elevation or an invented surface.
          // Entry/seeks still require the local active viewport: a cached tile
          // at a distant destination cannot establish its SDK camera orbit.
          const continuousDEM=s.phase==='playing' && !reset && !riderRelocation;
          let next=riderGeometry(analysis,s,camera.zoom,p=>continuousDEM ?
            riderTerrainElevation(map,p,gl.version)?.height : map.queryTerrainElevation(p),forward,elapsed,reset);
          const ceiling=riderTerrainCeiling(map,next?.position ?? pose.center,gl.version);
          const missingDetail=!next || !ceiling || Math.abs(ceiling.height-next.ground)>.01;
          // Explicit entry/paused seek is a new scene, not continuous motion.
          // Let the SDK request only that local nadir viewport at z18 (DEM
          // cover is downscaled by the SDK) until its z14 DEM is usable.
          // Show the honest linked 2D scene meanwhile; never
          // certify the old near-road pose at the newly requested distance.
          // Established playback never takes this relocation/hiding path.
          if(missingDetail && (riderRelocation || reset && s.phase!=='playing')) {
            riderRelocation=true;next=null;presented=false;
            invalidate();container.style.visibility='hidden';
            announce('relocating','Loading selected Rider terrain · 2D preview.');
            map.jumpTo({...pose,zoom:18,pitch:0,padding:0});
            container.dataset.camera=JSON.stringify({view:'loading-rider',requestedDistanceM:s.distanceM,
              position:pose.center,ground:map.queryTerrainElevation(pose.center),ceiling});
          } else riderRelocation=false;
          forward=next ?? undefined;
          if (next) {
            if(ceiling && ceiling.height>next.ground) {
              next.clearance=Math.max(next.clearance,Math.min(riderLimits.maxClearance,
                ceiling.height-next.ground+riderLimits.minClearance));
              next.altitude=next.ground+next.clearance;
              next.terrainCeiling=ceiling;
            }
            if (reset) map.setPadding({top:0,bottom:0,left:0,right:0});
            const origin=gl.MercatorCoordinate.fromLngLat(next.position),unit=origin.meterInMercatorCoordinateUnits();
            const yaw=next.bearing*Math.PI/180;
            const point=r=>new gl.MercatorCoordinate(origin.x+Math.sin(yaw)*r*unit,
              origin.y-Math.cos(yaw)*r*unit).toLngLat();
            // A kilometre-away valley intersection changes center DEM/LOD and
            // can recenter the actual camera hundreds of metres off the road.
            // On a descending DEM aim down its real slope instead. Never
            // accept that far orbit or raise the camera to hide the failure.
            const opticalPitch=next.pitch;
            let range=riderOrbit(next,r=>map.queryTerrainElevation(point(r)),128);
            while(!range && next.pitch>45) {
              next.pitch=Math.max(45,next.pitch-1);
              range=riderOrbit(next,r=>map.queryTerrainElevation(point(r)),128);
            }
            if(next.pitch<opticalPitch)next.targetPitch=Math.min(next.targetPitch,next.pitch);
            if (range) {
              const orbit=range/Math.sin(next.pitch*Math.PI/180)*unit;
              // v2.15's fixed vertical FOV is 2 atan(1/3), tileSize 512.
              const zoom=Math.log2(container.clientHeight*1.5/(orbit*512));
              const centerGround=map.queryTerrainElevation(point(range));
              map.jumpTo({center:point(range),zoom,pitch:next.pitch,bearing:next.bearing});
              let actual=map.getFreeCameraOptions().position;
              const firstAltitude=actual.toAltitude();
              // jumpTo applies zoom, center, bearing, pitch sequentially in
              // 2.15. A constraint against the intermediate old orientation
              // can displace an otherwise legal final pose. Reconcile once at
              // the now-current orientation, before any render; no flag patch.
              if(Math.abs(actual.toAltitude()-next.altitude)>.1) {
                map.jumpTo({center:point(range),zoom,pitch:next.pitch,bearing:next.bearing});
                actual=map.getFreeCameraOptions().position;
              }
              next.orbit={range,zoom,centerGround,centerAfter:map.queryTerrainElevation(point(range)),
                groundAfter:map.queryTerrainElevation(next.position),firstAltitude,altitude:actual.toAltitude(),
                position:actual.toLngLat()};
            }
            container.dataset.camera=JSON.stringify({...next,view:'rider',desiredZoom:camera.zoom});
          }
        }
        else if (['overview','section'].includes(s.cameraMode) && (reset || sequence===0)) map.fitBounds(routeBounds(analysis,
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
  function setZoom(value) {
    if (stopped || !ready) return;
    camera.setZoom(value);
    // Button/slider zoom is immediate: no competing native animation and no
    // second clock. Leave inspection ownership and the ride snapshot untouched.
    updating=true;
    try { map.stop();if (!riderView || manual) map.jumpTo({zoom:camera.zoom}); }
    finally { updating=false; }
    onCamera?.(camera.zoom);
    update(current);
  }
  return {update,dispose,setZoom,resize:()=>map?.resize()};
}
