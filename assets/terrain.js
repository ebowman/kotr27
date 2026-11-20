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
  const ridge=focus.ridge || 0, radius=900+250*ridge;
  const dx = focus.lon + radius*Math.sin(angle)/77450 - point.lon;
  const dy = focus.lat - radius*Math.cos(angle)/111200 - point.lat;
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
  const relax = prior ? Math.exp(-seconds/(.6+1.4*ridge)) : 0;
  // A wider, elevated shot over the ridge absorbs normal DEM refinement.
  // Keep the measured safety floor for genuinely higher foreground terrain.
  floor=Math.max(floor,focus.height+600+700*ridge+400*(focus.opening || 0));
  // When the SDK's coarser mesh disagrees, close in on the rider rather
  // than climbing ever higher (which can select even coarser tiles).
  floor = floor*(1-meshZoom) + (z0+600)*meshZoom;
  const altitude = floor + Math.max(0,(prior?.altitude ?? floor)-floor)*relax;
  // Tile availability is not a camera control. When a raster sample
  // is absent, independently pick the drawn mesh before using this shot.
  const limit = Math.min(1-meshZoom, rise>0 ? (altitude-z0)/rise : 1);
  const reach = limit - Math.max(0,limit-(prior?.reach ?? limit))*relax;
  const eye = along(reach);
  const sampled = riderZ != null && aimZ != null;
  if (reach!==1 && map.queryTerrainElevation(eye)==null) firstMissing=Math.min(firstMissing,reach);
  const needsMeshProof=firstMissing<=reach;
  // The simplified picking mesh and raster surface need not intersect at
  // the identical metre. Require the first mesh hit inside the measured
  // rider-side interval, and within 3% of the baseline even on a long ray.
  const baseline=Math.hypot(dx*77450,dy*111200);
  const hitTolerance=baseline*Math.min(.03*reach,firstMissing/2);
  return {eye,altitude,target,aimZ,z0,reach,sampled,meshZoom,needsMeshProof,hitTolerance};
}

function visibleRasterTiles(map,src) {
  return map.transform.coveringTiles({tileSize:src.tileSize,minzoom:src.minzoom,
    maxzoom:src.maxzoom,roundZoom:src.roundZoom,reparseOverscaled:src.reparseOverscaled});
}
function rasterTileCovered(cache,rendered,id,maxzoom) {
  return rendered.has(id.key) || cache.hasRenderableParent(id) ||
    id.children(maxzoom).every(child=>rendered.has(child.key));
}

// 2.15 has no public raster equivalent of queryRenderedFeatures. Inspect
// the pinned SDK's live raster source cache (not its speculative requests).
// A loaded parent is usable imagery while a sharper child is in flight.
function rasterCoverage(map, layers=map.getStyle().layers.filter(l=>l.type==='raster')) {
  if (!layers.length) throw Error('Satellite layer unavailable');
  // A renderable flat raster tile can still be transparent on its first
  // paint during the default tile fade. Show its imagery on that paint.
  for (const layer of layers) map.setPaintProperty(layer.id,'raster-fade-duration',0);
  const contains=(a,b)=>a.z<=b.z && (b.x>>(b.z-a.z))===a.x && (b.y>>(b.z-a.z))===a.y;
  // On terrain the raster is NOT drawn into the camera's ideal tile
  // selection. The SDK draws textures onto its own proxy regions. A
  // textured ancestor or a complete mosaic of bound children suffices.
  function textured(proxy,tiles) {
    const p=proxy.canonical, regions=[];
    for (const id of tiles) {
      if (id.wrap!==proxy.wrap) continue;
      const c=id.canonical;
      if (contains(c,p)) return true;
      if (contains(p,c)) regions.push(c);
    }
    const covered=[];
    let area=0;
    for (const c of regions.sort((a,b)=>a.z-b.z)) {
      if (covered.some(a=>contains(a,c))) continue;
      covered.push(c);
      area+=4**(p.z-c.z);
    }
    return area===1;
  }
  return () => {
    // Use the caches bound to the current style. A successful response or
    // decoded preload tile is not evidence that the painter drew it.
    const caches=layers.map(l=>map.style._getSourceCache(l.source));
    const tr=map.transform.elevation;
    if (tr?.proxyToSource) return tr.proxyCoords.length>0 && tr.proxyCoords.every(proxy=>
      textured(proxy,caches.flatMap(cache=>(tr.proxyToSource[proxy.key]?.[cache.id] || [])
        .filter(id=>cache.getTile(id)?.texture))));
    const visible=visibleRasterTiles(map,caches[0].getSource());
    const drawn=caches.flatMap(cache=>cache.getRenderableIds().map(key=>cache.getTileByID(key))
      .filter(tile=>tile?.texture).map(tile=>tile.tileID));
    return visible.length>0 && visible.every(id=>textured(id,drawn));
  };
}

// 2.15 can draw just part of a parent DEM beside a finer neighbour.
// Compare the DEMs bound to the touching *drawn* proxy regions; neither
// padding nor a comparison of canonical tile IDs captures that case.
function visibleSeamCheck() {
  const origin=id=>[(id.wrap || 0)+id.canonical.x/2**id.canonical.z,id.canonical.y/2**id.canonical.z];
  let previous=new Map(), bindings=new Map();
  return terrain=>{
    const {proxyCoords,terrainTileForTile}=terrain;
    if (bindings.size===proxyCoords.length &&
        proxyCoords.every(id=>bindings.has(id.key) && bindings.get(id.key)===terrainTileForTile[id.key]?.dem)) return false;
    bindings=new Map();
    const checked=new Map(), regions=[], starts=[new Map(),new Map()];
    for (const id of proxyCoords) {
      const tile=terrainTileForTile[id.key];
      bindings.set(id.key,tile?.dem);
      if (!tile?.dem) continue;
      const region={key:id.key, pos:origin(id), size:2**-id.canonical.z,
        dem:tile.dem, src:origin(tile.tileID), pixel:2**-tile.tileID.canonical.z/tile.dem.dim};
      regions.push(region);
      for (let axis=0;axis<2;axis++) {
        const k=region.pos[axis], index=starts[axis];
        if (!index.has(k)) index.set(k,[]);
        index.get(k).push(region);
      }
    }
    for (const a of regions) for (let axis=0;axis<2;axis++) {
      const edge=a.pos[axis]+a.size, along=1-axis;
      for (const b of starts[axis].get(edge) || []) {
        if (a.dem===b.dem) continue;
        const lo=Math.max(a.pos[along],b.pos[along]), hi=Math.min(a.pos[along]+a.size,b.pos[along]+b.size);
        if (lo>=hi) continue;
        const key=a.key+':'+b.key, prior=previous.get(key);
        if (prior?.[0]===a.dem && prior[1]===b.dem) { checked.set(key,prior); continue; }
        // Last interior sample on the low side, first on the high side.
        // Dyadic tile/pixel grids align, including clipped parent pixels.
        const cell=(r,k,n)=>Math.max(0,Math.min(r.dem.dim-1,n((edge-r.src[k])/r.pixel)));
        const ai=cell(a,axis,x=>Math.ceil(x)-1), bi=cell(b,axis,Math.floor);
        const normal=b.src[axis]+(bi+.5)*b.pixel-(a.src[axis]+(ai+.5)*a.pixel);
        const count=Math.ceil((hi-lo)/Math.min(a.pixel,b.pixel));
        for (let i=0;i<count;i++) {
          const at=lo+(i+.5)*(hi-lo)/count;
          const aj=Math.floor((at-a.src[along])/a.pixel), bj=Math.floor((at-b.src[along])/b.pixel);
          const delta=b.src[along]+(bj+.5)*b.pixel-(a.src[along]+(aj+.5)*a.pixel);
          const meters=27800000*Math.hypot(normal,delta);
          const za=axis ? a.dem.get(aj,ai) : a.dem.get(ai,aj);
          const zb=axis ? b.dem.get(bj,bi) : b.dem.get(bi,bj);
          // Don't allow coarse resolution to excuse a sheer 500 m tile edge.
          if (Math.abs(za-zb)>Math.min(400,80+8*meters)) { bindings.clear(); return true; }
        }
        checked.set(key,[a.dem,b.dem]);
      }
    }
    previous=checked; // retain only currently drawn seams
    return false;
  };
}

window.startTerrain = function (points, connect, upcoming, setAvailability) {
  const container = document.getElementById('map');
  const message = document.getElementById('message');
  let map, stopped = false, recoverRide, retryTimer;
  const nonRetryable=new WeakSet();
  const timedOut=()=>recoverRide ? recoverRide() : fallback();
  let timer = setTimeout(timedOut, 20000);
  function fallback(reason) {
    if (stopped) return;
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(timer);
    setAvailability('unavailable',typeof reason==='string');
    message.textContent = typeof reason==='string' ? reason : 'Satellite terrain unavailable. Use the elevation profile below.';
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
    map.on('error', e => {
      // One DEM tile can 404 while its parent covers the draw. Let actual
      // coverage (and its deadline), not the request, decide readiness.
      const denied=[401,403].includes(e.error?.status);
      if (e.sourceId==='dem') {
        // Elevation and satellite imagery are independent sources. A DEM
        // denial disables mesh promotion, not the usable satellite ride.
        if (e.error?.status!==404) recoverRide?.(denied);
        return;
      }
      const code=e.error?.status;
      if (e.tile && code>=400 && code<500 && code!==408 && code!==404) nonRetryable.add(e.tile);
      if (!denied && (e.tile || recoverRide)) return;
      fallback();
    });
    map.on('webglcontextlost', fallback);
    // `load` waits for tiles in the constructor viewport, which is not the
    // fitted overview OR the pending Play shot. Cached source metadata is
    // sufficient to install the controller. Judge the destination only on
    // its actual render; never wait for an obsolete initial tile selection.
    let installed=false;
    function install() {
      if (stopped || installed) return;
      installed=true;
      try {
        const rasterLayer=map.getStyle().layers.find(l=>l.type==='raster');
        const rasters=[rasterLayer];
        // Keep a low-resolution drawing of the SAME satellite source under
        // the refining tiles. The SDK requests only visible coarse tiles;
        // no tile enumeration, new imagery provider or second WebGL map.
        const sat=map.getSource(rasterLayer.source);
        if (sat?.tiles?.length) {
          map.addSource('sat-cover',{type:'raster',tiles:sat.tiles,tileSize:sat.tileSize,
            // A route-scale floor: neighbouring close-up viewports share
            // these actual satellite textures rather than racing an entirely
            // new "coarse" viewport against the detailed imagery.
            scheme:sat.scheme,maxzoom:Math.min(10,sat.maxzoom)});
          const cover={id:'sat-cover',type:'raster',source:'sat-cover',paint:{'raster-fade-duration':0}};
          map.addLayer(cover,rasterLayer.id);
          rasters.push(cover);
        }
        const imageryReady=rasterCoverage(map,rasters);
        const coords = points.map(p => [p.lon, p.lat]);
        const heights=points.map(p=>p.height);
        const minDEM=Math.min(...heights)-600, maxDEM=Math.max(...heights)+1000;
        const checked=new WeakSet();
        const badSeam=visibleSeamCheck();
        function implausible({dem,tileID}) {
          if (!dem || checked.has(dem)) return false;
          // Pinned 2.15's picking tree subsamples the DEM: a narrow spike
          // between its samples could still displace rendered geometry.
          // Check each new tile once, not its entire raster on every frame.
          // Also reject impossible discontinuities inside that envelope:
          // allow a near-vertical 8:1 slope plus 80 m tolerance. Ground
          // resolution is evaluated at this route's latitude (~46°).
          const step=80+8*27800000/(2**tileID.canonical.z*dem.dim);
          // Interior samples are immutable; the SDK backfills its one-pixel
          // padding from neighbours, whose interiors are checked separately.
          for(let y=0;y<dem.dim;y++) {
            let prev;
            for(let x=0;x<dem.dim;x++) {
              const z=dem.get(x,y);
              if (!(z>=minDEM && z<=maxDEM) || Math.abs(z-prev)>step ||
                  (y>0 && Math.abs(z-dem.get(x,y-1))>step)) return true;
              prev=z;
            }
          }
          checked.add(dem);
          return false;
        }
        const bounds = coords.reduce((b, xy) => b.extend(xy), new gl.LngLatBounds());
        map.addSource('ascent', {type:'geojson', tolerance:0, data:{type:'LineString', coordinates:coords}});
        map.addLayer({id:'ascent', type:'line', source:'ascent', paint:{'line-color':'#ff932e','line-width':4}});
        const beacon = document.createElement('div');
        beacon.className = 'rider-beacon';
        beacon.setAttribute('aria-label', 'Rider position');
        const rider = new gl.Marker({element:beacon, anchor:'center'});
        // The draped vector tile is coarse on steep slopes. Project the
        // actual GPX neighbours (including the interpolated rider) through
        // the final terrain transform, not a feature from a nearby bend.
        const ns='http://www.w3.org/2000/svg', local=document.createElementNS(ns,'svg');
        local.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        local.setAttribute('aria-hidden','true');
        const trace=document.createElementNS(ns,'polyline');
        trace.setAttribute('stroke','#ff932e'); trace.setAttribute('stroke-width','4');
        trace.setAttribute('fill','none'); local.append(trace);
        let segment=0;
        function drawLocal(point,p) {
          while(segment && points[segment].d>point.d) segment--;
          while(segment+2<points.length && points[segment+1].d<point.d) segment++;
          const vertices=[];
          for(let i=segment;i>=0 && (i===segment || point.d-points[i].d<70);i--)
            vertices.unshift(map.project(coords[i]));
          vertices.push(p);
          for(let i=segment+1;i<points.length && (i===segment+1 || points[i].d-point.d<70);i++)
            vertices.push(map.project(coords[i]));
          if(!vertices.every(v=>Number.isFinite(v.x+v.y))) return false;
          trace.setAttribute('points',vertices.map(v=>v.x+','+v.y).join(' '));
          if(local.nextSibling!==beacon) beacon.before(local);
          return local.isConnected;
        }
        let inOverview = false, flatOnly=false, flatCamera, pose, current, dirty = false, revision=0;
        let safeFlat, holdFlat=false, moving=false, standby=false;
        const rideDeadline=()=>moving ? 2000 : 3500;
        let quarantined=false, attempts=0, flatSince=0, generation=0, rollbackCamera;
        // GL 2.15 silently retains 404s as errored tiles. Its ordinary
        // reload skips them; resetting the source would discard good cover.
        // Each uninterrupted flat wait gets four small SDK-managed batches.
        // Offsets from the *same* flat wait as the fixed eight-second timer.
        // Reserve the last six requests for 7.3 s, leaving ~700 ms to paint.
        // Restoration after that finite attempt is not guaranteed to recover.
        const retryAt=[500,1500,3500,7300];
        let flatWaitStart=0;
        let retryRound=0;
        function resetRetries() {
          clearTimeout(retryTimer); retryTimer=0; retryRound=0;
        }
        function retryImagery() {
          if (standby || retryTimer || retryRound===retryAt.length) return;
          const elapsed=performance.now()-flatWaitStart;
          retryTimer=setTimeout(()=>{
            retryTimer=0;
            if (stopped || !flatOnly || imageryReady()) return;
            // A delayed render/timer must not replay several overdue batches.
            const age=performance.now()-flatWaitStart;
            while (retryRound<retryAt.length && retryAt[retryRound]<=age) retryRound++;
            let budget=6;
            for (const source of ['sat-cover',rasterLayer.source]) {
              if (!map.getSource(source)) continue;
              const cache=map.style._getSourceCache(source), src=cache.getSource();
              const rendered=new Set(cache.getRenderableIds());
              for (const id of visibleRasterTiles(map,src)) {
                const tile=cache.getTile(id);
                if (tile?.state!=='errored' || nonRetryable.has(tile) ||
                    rasterTileCovered(cache,rendered,id,src.maxzoom)) continue;
                // 'loading', not 'reloading': a failed tile has no texture
                // and must not count as renderable before its reply.
                cache._reloadTile(id.key,'loading');
                if (!--budget) break;
              }
              if (!budget) break;
            }
            retryImagery();
          },Math.max(0,retryAt[retryRound++]-elapsed));
        }
        function status(text) {
          if (message.textContent !== text) message.textContent = text;
        }
        function markerMargin() {
          const b=beacon.getBoundingClientRect(), m=container.getBoundingClientRect();
          return Math.min(b.left-m.left,m.right-b.right,b.top-m.top,m.bottom-b.bottom);
        }
        function flatExpired() {
          timer=0;
          // A warm SDK tile can be waiting on local cache I/O with *no*
          // HTTP request in flight. Destroying the map here cancels the very
          // callbacks that could prove the frame. End the foreground wait
          // and stop retries, but retain an outstanding destination draw.
          const states=rasters.flatMap(l=>{
            const cache=map.style._getSourceCache(l.source);
            return visibleRasterTiles(map,cache.getSource()).map(id=>cache.getTile(id)?.state);
          });
          // A finished upload can also race the last render. Require a
          // settled destination error, not merely "nothing in flight",
          // before tearing down the map.
          if (!imageryReady() && states.includes('errored') &&
              !states.some(s=>s==='loading' || s==='reloading')) {
            fallback('Satellite view unavailable at this position. Use the elevation profile below.');
            return;
          }
          resetRetries();
          standby=true;
          container.parentElement.classList.add('satellite-standby');
          setAvailability('standby',true,()=>fallback());
          status('Showing the elevation profile. Satellite view will resume when ready, or retry now.');
          map.triggerRepaint(); // recheck a completion racing the deadline
        }
        function leaveStandby() {
          standby=false;
          container.parentElement.classList.remove('satellite-standby');
        }
        // A discontinuous move can use stale parent tiles until the SDK's
        // first destination render. Only show a neutral loading surface in
        // that gap or while a drawn terrain region has no DEM binding.
        function loading(cold=false,text='Loading satellite terrain…') {
          if (standby) return;
          setAvailability('loading');
          if (cold) container.setAttribute('aria-busy','true');
          status(text);
          // Start once per uninterrupted coverage loss. Neither render nor
          // tile traffic renews a flat wait; only a verified draw clears it.
          if (!timer) {
            if (flatOnly) {
              flatWaitStart=performance.now();
              timer=setTimeout(flatExpired,8000);
            } else timer=setTimeout(timedOut,recoverRide ? rideDeadline() : 20000);
          }
        }
        function rendered() {
          if (standby) leaveStandby();
          if (retryRound) resetRetries();
          clearTimeout(timer); timer=0;
          if (container.getAttribute('aria-busy')==='true') container.setAttribute('aria-busy','false');
          status(flatOnly ? 'Flat satellite ride · Oblique imagery without terrain relief.'
            : inOverview ? 'Satellite overview · The orange line traces the ascent.'
            : 'Satellite terrain · The orange line traces the ascent.');
          setAvailability(flatOnly ? 'flat' : 'ready');
        }
        function overview() {
          leaveStandby();
          resetRetries();
          generation++;
          attempts=0;
          rollbackCamera=null;
          safeFlat=null; holdFlat=false;
          flatOnly=false;
          recoverRide=null;
          clearTimeout(timer); timer=0;
          loading(true);
          rider.remove();
          local.remove();
          if (map.getTerrain()) map.setTerrain(null);
          map.jumpTo({pitch:0, bearing:0});
          map.fitBounds(bounds, {padding:40, duration:0});
          inOverview = true;
          current = null;
        }
        function restoreFlat(unsafe=false) {
          if (unsafe) quarantined=true;
          if (stopped || flatOnly || !current) return;
          flatOnly=true;
          local.remove();
          flatSince=performance.now();
          // Hide the suspect frame before the browser composites it. Preserve
          // the live framing on handoff, then ease the *mesh-free* view wide.
          container.setAttribute('aria-busy','true');
          clearTimeout(timer); timer=0;
          try {
            loading(true,'Preparing flat satellite ride…');
            if (quarantined) {
              // Never derive a replacement lens from a corrupt mesh.
              flatCamera={bearing:-current[3]*180/Math.PI,pitch:40,zoom:13.5,targetZoom:13.5,dx:0,dy:0};
            } else if (rollbackCamera) {
              flatCamera=rollbackCamera;
            } else {
              const center=map.getCenter(), focus=current[2];
              flatCamera={bearing:map.getBearing(),pitch:Math.max(34,Math.min(50,map.getPitch())),
                zoom:Math.max(13,Math.min(15,map.getZoom())),targetZoom:13.5,dx:0,dy:0};
              if (Math.hypot((center.lng-focus.lon)*77450,(center.lat-focus.lat)*111200)<180) {
                flatCamera.dx=center.lng-focus.lon; flatCamera.dy=center.lat-focus.lat;
              }
            }
            rollbackCamera=null;
            map.setTerrain(null);
            inOverview=false;
            holdFlat=false;
            if (safeFlat) {
              map.jumpTo(safeFlat);
              holdFlat=true;
            }
            drawFlat(...current);
          } catch { fallback(); }
        }
        function drawFlat(point,following,focus,angle,seconds=0,snap=false) {
          if (snap) {holdFlat=false; safeFlat=null;}
          // Keep the already textured shot, not a wider *unloaded* view,
          // while an optional mesh prepares. The rider still moves on GPX.
          if (holdFlat) {
            const p=map.project([point.lon,point.lat]);
            holdFlat=Math.min(p.x,p.y,container.clientWidth-p.x,container.clientHeight-p.y)>30;
            if (!holdFlat) safeFlat=null;
          }
          const keep=snap ? 0 : Math.exp(-seconds/.8);
          flatCamera.dx*=keep;
          flatCamera.dy*=keep;
          const targetPitch=38+6*(focus.ridge || 0);
          flatCamera.pitch=targetPitch+(flatCamera.pitch-targetPitch)*keep;
          flatCamera.zoom=flatCamera.targetZoom+(flatCamera.zoom-flatCamera.targetZoom)*keep;
          if (snap) flatCamera.bearing=-angle*180/Math.PI;
          if (!holdFlat) map.jumpTo({center:snap ? [point.lon,point.lat] : [focus.lon+flatCamera.dx,focus.lat+flatCamera.dy],
            zoom:flatCamera.zoom,pitch:flatCamera.pitch,bearing:flatCamera.bearing});
          rider.setLngLat([point.lon,point.lat]);
          if (!beacon.isConnected) rider.addTo(map);
          if (holdFlat) map.triggerRepaint(); // no jumpTo to schedule the GPX overlay
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
            if (e.sourceId==='dem') {
              if (!stopped && recoverRide && e.tile?.dem && implausible(e.tile)) {
                restoreFlat(true); return;
              }
              dirty=true;
            }
            // Only initial/ordinary overview loading uses a sliding timeout.
            // Tile traffic is not evidence that a failed ride's refit can finish.
            if (timer && !flatOnly && !recoverRide && !stopped && e.sourceDataType==='content') {
              clearTimeout(timer); timer=setTimeout(timedOut,20000);
            }
          });
          let nextCheck = 0, disabled = false, demCovered=false;
          let pending=false, phase=0, validated=false, waitingSince=0, missingSince=null, healthySince=0;
          // 2.15 jumpTo(preloadOnly) fans out across *all* sources, with no
          // completion signal. Use the same pinned cache primitive on one
          // cloned viewport, one source at a time; never queue a second batch.
          const raster=rasterLayer.source;
          const previousHints=new Map();
          function reuseDEM(cache,tiles) {
            for (const tile of tiles) if (tile?.dem && !implausible(tile) &&
                !cache.getTile(tile.tileID) && !cache._cache.has(tile.tileID)) {
              cache._cache.add(tile.tileID,tile,tile.getExpiryTimeout());
            }
          }
          function hint(now) {
            if (disabled || pending || now<nextCheck || savingTerrainData()) return;
            const v=upcoming();
            if (!v) return;
            nextCheck=now+200;
            try {
              const tr=map.transform.clone();
              tr.center=new gl.LngLat(v.focus.lon,v.focus.lat);
              const coarse=phase===0, elevation=phase===1 && !flatOnly;
              phase=(phase+1)%3;
              const source=coarse && map.getSource('sat-cover') ? 'sat-cover' : elevation ? 'dem' : raster;
              if (coarse || flatOnly) { tr.pitch=40; tr.zoom=13; tr.bearing-=v.turn*180/Math.PI; }
              else tr.bearing-=v.turn*180/Math.PI;
              const cache=map.style._getSourceCache(source), src=cache.getSource();
              if (!cache._sourceLoaded) return;
              const ids=tr.coveringTiles({tileSize:elevation ? map.painter.terrain.getScaledDemTileSize() : src.tileSize,
                minzoom:src.minzoom,maxzoom:src.maxzoom,roundZoom:src.roundZoom && !elevation,
                reparseOverscaled:src.reparseOverscaled,isTerrainDEM:elevation});
              const signature=ids.map(id=>id.key).sort().join(',');
              if (!ids.length || ids.length>32 || previousHints.get(source)===signature) return;
              previousHints.set(source,signature);
              if (ids.every(id=>cache.getTile?.(id)?.hasData())) return;
              pending=true;
              nextCheck=performance.now()+1000;
              cache._preloadTiles(tr,(err,tiles)=>{
                pending=false;
                if (!err && elevation && !stopped && !quarantined && cache._cache && tiles) reuseDEM(cache,tiles);
              });
            } catch { disabled=true; }
          }
          let meshZoom = 0, lastPick = -Infinity, adjusting = false, needsPick = false, lastMarkerRefresh=-Infinity;
          // Warm a single local DEM viewport *while riding on satellite*.
          // The SDK's preload callback supplies decoded tiles. Put only
          // validated tiles into its bounded reuse cache; never enable a
          // mesh just because a request finished. A failed/absent batch is
          // not polled again. Corrupt DEM quarantines 3D for this map.
          let priming=false, promotionEpoch=-1, nextPrep=0;
          function preparePromotion(now) {
            if (!moving || quarantined || now<nextPrep || priming || promotionEpoch===generation || attempts>=3 ||
                now-flatSince<1500*2**attempts || savingTerrainData()) return;
            nextPrep=now+250;
            const cache=map.style._getSourceCache('dem');
            if (!cache?._sourceLoaded || !cache._cache) return;
            const epoch=generation, tr=map.transform.clone();
            tr.pitch=0; tr.zoom=11;
            const ids=tr.coveringTiles({tileSize:512,maxzoom:11});
            if (!ids.length || ids.length>12) return;
            const cached=ids.map(id=>cache.getTile(id) || cache._cache.get(id));
            const reusable=cached.every(tile=>tile?.dem && tile.state==='loaded');
            if (!reusable && (pending || now<nextCheck)) return; // share the single fetch budget
            priming=true; attempts++;
            const finish=(err,tiles)=>{
              priming=false;
              if (epoch!==generation || stopped || !flatOnly || quarantined) return;
              if (err || !tiles?.length || tiles.some(t=>!t?.dem)) { attempts=3; return; }
              if (tiles.some(implausible)) { quarantined=true; return; }
              // Only admit tiles still covering this shot. A slow response
              // after a seek must not switch a different location to 3D.
              const {lon,lat}=current[0], xy=gl.MercatorCoordinate.fromLngLat([lon,lat]);
              if (!tiles.some(({tileID:{canonical:c}})=>Math.floor(xy.x*2**c.z)===c.x &&
                  Math.floor(xy.y*2**c.z)===c.y)) return;
              reuseDEM(cache,tiles);
              promotionEpoch=epoch;
              map.triggerRepaint();
            };
            try {
              if (reusable) finish(null,cached);
              else { nextCheck=performance.now()+1000; cache._preloadTiles(tr,finish); }
            }
            catch { priming=false; attempts=3; }
          }
          map.on('idle', () => {
            // A pause may end inside the moving camera's sampling interval.
            if (!stopped && !inOverview && !flatOnly && demCovered && needsPick && pose.sampled && imageryReady()) {
              lastPick = -Infinity;
              map.triggerRepaint();
            }
          });
          map.on('render', () => {
            if (stopped) return;
            // Validate newly visible tiles off the rider ray as well. This
            // render callback runs before the browser composites the frame.
            const terrain=!inOverview && map.transform.elevation, tiles=terrain?.visibleDemTiles;
            if (tiles?.length && (tiles.some(implausible) || badSeam(terrain))) { restoreFlat(true); return; }
            // visibleDemTiles omits unbound regions, even when a 404 has
            // settled and the SDK reports source-loaded. The bindings are
            // for this draw, including any parent DEM the SDK selected.
            demCovered=!!terrain?.proxyCoords?.length &&
              terrain.proxyCoords.every(id=>terrain.terrainTileForTile[id.key]?.dem);
            const imagery=imageryReady();
            if (inOverview) {
              previousHints.clear();
              phase=0;
              if (imagery && map.isSourceLoaded('ascent') &&
                  map.queryRenderedFeatures({layers:['ascent']}).length) rendered();
              else loading(true);
              return;
            }
            const now = performance.now();
            if (imagery && !priming && (!flatOnly || quarantined || attempts>=3)) hint(now);
            if (flatOnly) {
              const p=map.project(rider.getLngLat());
              if (Math.min(p.x,p.y,container.clientWidth-p.x,container.clientHeight-p.y)<13 || markerMargin()<2) {
                loading(true,'Preparing flat satellite ride…'); drawFlat(...current,0,true); return;
              }
              // If the handoff lens itself lacks coverage, don't sit waiting
              // for unrelated detail. Use the already-warmed coarse layer's
              // oblique viewport, then verify its actual draw before reveal.
              if (!imagery && safeFlat && !holdFlat) {
                holdFlat=true;
                map.jumpTo(safeFlat);
                loading(true,'Preparing flat satellite ride…');
                drawFlat(...current);
                return;
              }
              if (!imagery && !safeFlat && flatCamera.targetZoom!==13) {
                loading(true,'Loading satellite cover…');
                flatCamera.targetZoom=13;
                drawFlat(...current,0,true); return;
              }
              if (!imagery) {
                retryImagery();
                loading(true,'Loading flat satellite ride…'); return;
              }
              // With no mesh the line and GPX project onto the same plane.
              // A line tile on the far side of the viewport is not proof
              // that the worker has delivered the rider's destination.
              if (!map.queryRenderedFeatures([[p.x-6,p.y-6],[p.x+6,p.y+6]],{layers:['ascent']}).length) {
                loading(true,'Loading ascent road…'); return;
              }
              if (!drawLocal(current[0],p)) { loading(true,'Preparing local route trace…'); return; }
              safeFlat={center:map.getCenter(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
              holdFlat=true;
              rendered();
              if (promotionEpoch===generation && moving && !quarantined) {
                rollbackCamera={...flatCamera};
                promotionEpoch=-1; flatOnly=false; validated=false; missingSince=null;
                waitingSince=now; meshZoom=0; adjusting=false; lastPick=-Infinity;
                loading(true);
                try {
                  map.setTerrain({source:'dem',exaggeration:1});
                  drawPose(...current,0,true);
                } catch { restoreFlat(true); }
              } else preparePromotion(now);
              return;
            }
            const paintedRevision=revision;
            // A paused seek has no player RAF. Re-evaluate the *same* pose
            // after streamed DEM tiles enter the SDK's terrain mesh.
            const refreshed=dirty || !pose.sampled;
            if (refreshed) {
              dirty = false;
              drawPose(...current, 0, false);
              if (stopped || flatOnly) return;
            }
            // The SDK picks a simplified terrain mesh, not the underlying
            // raster samples. If that mesh still intercepts the rendered
            // ray, steepen the real camera gradually, with a hard upper
            // bound. Never infer an obstruction from unloaded tiles.
            const cold=container.getAttribute('aria-busy')==='true';
            const gps=rider.getLngLat(), p=map.project(gps);
            const demReady=demCovered && pose.sampled && (!pose.needsMeshProof ||
              (revision===paintedRevision && gps.distanceTo(map.unproject(p))<=pose.hitTolerance));
            if (!imagery || !demReady) {
              missingSince??=now;
              if (now-missingSince>(validated ? 160 : rollbackCamera ? 250 : moving ? 1000 : 2500)) { restoreFlat(); return; }
              loading(true,!imagery ? 'Loading satellite imagery…' : 'Loading terrain elevation…');
              map.triggerRepaint(); return;
            }
            missingSince=null;
            // Once composed, slight marker DOM lag or a sharper road tile
            // arriving is not starvation. Mesh integrity and raster cover
            // above are still checked before every browser composite.
            const road=revision===paintedRevision && map.queryRenderedFeatures({layers:['ascent']}).length>0 &&
              drawLocal(current[0],p);
            // Framing is a paint invariant, not a 250 ms mesh-pick sample.
            // The marker is rounded by the SDK; check its actual box too.
            const framed=Math.min(p.x,p.y,container.clientWidth-p.x,container.clientHeight-p.y)>=13 && markerMargin()>=2;
            if (validated && moving && road && framed) {
              if (now-lastPick>250) {
                lastPick=now;
                const eye=map.getFreeCameraOptions().position.toLngLat();
                const distance=eye.distanceTo(gps);
                const clear=distance<1 || eye.distanceTo(map.unproject(p))>=.90*distance;
                if (!clear || +getComputedStyle(beacon).opacity!==1) {
                  validated=false; waitingSince=now; loading(true); map.triggerRepaint(); return;
                }
              }
              // Only a sustained *moving*, validated shot replenishes the
              // recovery budget. A permanently absent mesh cannot loop.
              if (now-healthySince>5000) { attempts=0; rollbackCamera=null; }
              rendered(); return;
            }
            const dim=+getComputedStyle(beacon).opacity!==1;
            let clear=!adjusting;
            if (demReady && imagery && (cold || needsPick || adjusting || dim || !framed) &&
                ((cold || !framed) && !adjusting || refreshed || now-lastPick>=(adjusting ? 32 : 150))) {
              const dt=Math.min(.05,(now-lastPick)/1000);
              lastPick=now;
              needsPick=false;
              try {
                const eye=map.getFreeCameraOptions().position.toLngLat();
                const hit=map.unproject(p), distance=eye.distanceTo(gps);
                clear = distance<1 ? gps.distanceTo(hit)<1 : eye.distanceTo(hit)>=.93*distance;
                if (cold || !moving) clear=clear && gps.distanceTo(hit)<Math.min(8,Math.max(1,.01*distance));
                // Marker occlusion uses its rounded DOM pixel, which can
                // pick a different triangle on a steep terrain edge.
                if (dim) clear=clear && eye.distanceTo(map.unproject(
                  [Math.round(p.x),Math.round(p.y)]))>=.9*distance;
                adjusting = (!clear || !framed) && meshZoom<1;
              } catch { fallback(); return; }
              if (adjusting) {
                meshZoom=Math.min(1,meshZoom+dt);
                drawPose(...current,dt,false,true);
                if (stopped || flatOnly) return;
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
              registered && framed && road && !dim;
            if (usable) { if (!validated) healthySince=now; validated=true; rendered(); }
            else {
              if (validated) { validated=false; waitingSince=now; }
              if (now-waitingSince>1400) { restoreFlat(); return; }
              loading(!road || !framed,registered && !road ? 'Loading ascent road…' : 'Loading rider view…');
              map.triggerRepaint();
              return;
            }
          });
          function drawPose(point, following, focus, angle, seconds, snap, correcting=false) {
            if (stopped) return;
            try {
              if (!following) { if (!inOverview) overview(); return; }
              if (snap || inOverview) { loading(true); adjusting=false; lastPick=-Infinity;
                validated=false; missingSince=null; waitingSince=performance.now(); }
              current = [point, following, focus, angle];
              if (flatOnly) {
                if (snap) {
                  generation++;
                  if (standby) { leaveStandby(); loading(true); }
                }
                drawFlat(...current,seconds,snap); return;
              }
              if (inOverview) {
                recoverRide=restoreFlat;
                if (quarantined) { restoreFlat(true); return; }
                clearTimeout(timer);
                timer=setTimeout(timedOut,rideDeadline());
                // At the cinematic lens height a stable mountain surface
                // matters more than DEM refinement under every switchback.
                // Satellite detail is independent and can continue refining.
                if (!map.getSource('dem')) map.addSource('dem', {type:'raster-dem',
                  url:'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize:512, maxzoom:11});
                map.setTerrain({source:'dem', exaggeration:1});
                if (stopped || flatOnly) return;
              }
              if (snap || inOverview) meshZoom=0;
              else if (!correcting && !adjusting) meshZoom*=Math.exp(-seconds/3);
              const prior = pose;
              pose = terrainPose(map,point,focus,angle,snap || inOverview ? null : prior,seconds,meshZoom);
              // GPX is independent of the DEM decode. Allow resolution and
              // registration differences, not a rider hundreds of metres off
              // the road. Missing samples still take the buffering path.
              if (pose.sampled && !(Math.abs(pose.z0-point.height)<=300)) { restoreFlat(true); return; }
              const {eye,altitude,target,aimZ,z0} = pose;
              if (snap || inOverview || altitude!==prior.altitude || aimZ!==prior.aimZ || z0!==prior.z0 || meshZoom!==prior.meshZoom ||
                  eye.some((v,i)=>v!==prior.eye[i]) || target.some((v,i)=>v!==prior.target[i])) {
                const camera = map.getFreeCameraOptions();
                camera.position = gl.MercatorCoordinate.fromLngLat(eye, altitude);
                // The rail can cut across a high cliff or a deep ravine.
                // Keep its smooth horizontal aim without pointing the lens
                // hundreds of metres over (or under) the actual rider.
                if (focus.ridge || meshZoom || !pose.reach || (aimZ!=null && Math.abs(aimZ-z0)>100)) {
                  const east=(target[0]+(point.lon-target[0])*meshZoom-eye[0])*77450;
                  const north=(target[1]+(point.lat-target[1])*meshZoom-eye[1])*111200;
                  const ground=z0+Math.max(-100,Math.min(100,(aimZ ?? z0)-z0))*(1-meshZoom);
                  const z=ground+(focus.height-ground)*(focus.ridge || 0);
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
            } catch { if (recoverRide && !flatOnly) restoreFlat(); else fallback(); }
          }
          connect((point,following,focus,angle,seconds,snap,playing)=>{
            moving=playing;
            drawPose(point,following,focus,angle,seconds,snap);
          });
        }
        overview();
        attachCamera();
      } catch { fallback(); }
    }
    map.on('sourcedata', e=>{
      if (stopped || installed || e.sourceDataType!=='metadata') return;
      const layer=map.getStyle()?.layers?.find(l=>l.type==='raster');
      if (layer?.source===e.sourceId) queueMicrotask(install);
    });
    map.once('load', install);
  }).catch(fallback);
};
