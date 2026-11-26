// Camera geometry, bounded presentation interpolation and paint proof.
// No playback integration, network or route-state mutation.
import { positionAt } from './route-analysis.mjs';

export const cameraJobs = Object.freeze([
  ['follow','Follow','Look ahead along the riding direction.'],
  ['overview',"Overview / Bird’s-eye",'North-up, fit the whole route; the rider stays marked.'],
  ['side','Side','Look across the route from the right-hand side.'],
  ['cinematic','Cinematic','A wide trailing-quarter view turning with route distance, not a second clock.'],
]);
export const flyoverLimits = Object.freeze({vertices:2048, detailVertices:512, detailStep:128, tileRequests:240, tileCache:32,
  frameMs:200, loadMs:12000, coverageMs:2500, minZoom:10, maxZoom:16, maxPitch:55,maxPixels:4000000});
// Viewing distance, not simulation state. Owners keep this across renderer
// remounts/seek/pause/Return and reset it only on an explicit route change.
// In aerial, 16 overzooms z12 imagery / z11 DEM. Rider interprets this same
// preference as terrain-relative clearance and lazily enables bounded detail.
export function createRideCamera() {
  let zoom=12.6, view='aerial';
  return Object.freeze({
    get zoom() { return zoom; },
    get view() { return view; },
    setView(value) { if (['aerial','rider'].includes(value)) view=value; },
    setZoom(value) {
      if (Number.isFinite(value)) zoom=Math.max(flyoverLimits.minZoom,Math.min(flyoverLimits.maxZoom,value));
      return zoom;
    },
    reset() { zoom=12.6;view='aerial'; },
  });
}
// Dense whole-Grappa seeks used ~4,900 unique / 12,400 total tiles. The measured
// sustained upper-climb burst (923 unique / 2,940 loads per ~17 simulated min)
// projects to ~13,000 / 41,000 over its 3.9 h example ride. Allow finite headroom
// for continuous viewpoints; this projection is not a full-duration run claim.
export const riderLimits=Object.freeze({minClearance:2,maxClearance:9,maxPitch:85,maxZoom:24,tileRequests:16000,totalTileRequests:60000,
  yawRate:360,yawAcceleration:3600,yawSpeedScale:4});
// One map lifetime, not one view selection. A small SDK tile cache revisits
// resources on bends; separately bound distinct coverage and repeated loads.
// No URLs leave this closure and an exhausted budget cannot be revived.
export function createTerrainBudget() {
  let requests=0,rider=false,exhausted=false;
  const resources=new Set();
  return {
    enableRider(){rider=true;},
    get requests(){return requests;},
    get unique(){return resources.size;},
    consume(url,type) {
      if(type!=='Tile')return true;
      if(exhausted)return false;
      requests++;resources.add(url);
      exhausted=requests>(rider?riderLimits.totalTileRequests:flyoverLimits.tileRequests) ||
        resources.size>riderLimits.tileRequests;
      return !exhausted;
    },
  };
}
const metresBetween=(p,q)=>Math.hypot((q.lon-p.lon)*Math.cos(p.lat*Math.PI/180),q.lat-p.lat)*111319.49;
// Route distance is the owner's presented distance, never an integrated camera
// clock. Elevation is supplied ONLY by the current rendered DEM. At the finish
// stay on the last 12 m of source road rather than extrapolating a fictitious road.
export function riderGeometry(a,s,zoom,terrain,prior,elapsedMs=0,reset=false) {
  if (!Number.isFinite(s.distanceM) || s.identity?.geometrySha256!==a.identity.geometrySha256)
    throw Error('Exact rider distance unavailable');
  const fraction=(Math.max(10,Math.min(16,Number.isFinite(zoom)?zoom:12.6))-10)/6;
  const baseClearance=5/2.5**fraction;
  const distanceM=Math.max(0,Math.min(a.distanceM-12,s.distanceM));
  const p=positionAt(a,distanceM);
  let aim=positionAt(a,Math.min(a.distanceM,distanceM+10));
  if (metresBetween(p,aim)<1) aim=positionAt(a,Math.min(a.distanceM,distanceM+4));
  const ground=terrain([p.lon,p.lat]), aimGround=terrain([aim.lon,aim.lat]);
  if (!Number.isFinite(ground) || !Number.isFinite(aimGround)) return null;
  const horizontal=metresBetween(p,aim);
  if (!(horizontal>.1)) return null;
  const target=Math.atan2((aim.lon-p.lon)*Math.cos(p.lat*Math.PI/180),aim.lat-p.lat)*180/Math.PI;
  const continuous=!reset && prior && elapsedMs<=250 &&
    s.distanceM>=prior.riderDistanceM && s.distanceM-prior.riderDistanceM<30;
  const dt=Math.max(0,Math.min(250,Number.isFinite(elapsedMs)?elapsedMs:0))/1000;
  // The approximate DEM can rise much faster than the processed road grade.
  // Up to four disclosed metres of support keep nearby uphill road compatible
  // with the SDK's maximum pitch. Never invent a flat road or lift indefinitely.
  const needed=Math.max(0,Math.min(4,aimGround-ground+horizontal/Math.tan(85*Math.PI/180)-5/2.5**(2.6/6)));
  const support=continuous ? (prior.support ?? 0)+Math.max(-6*dt,Math.min(6*dt,needed-(prior.support ?? 0))) : needed;
  const clearance=baseClearance+support;
  const delta=continuous ? shortestAngle(prior.bearing,target) : 0;
  // A fixed local tangent avoids discontinuous adaptive-lookahead targets.
  // Critically damped yaw with explicit angular velocity AND acceleration
  // limits. Never instant catch-up, including when a tight turn outruns it.
  const oldRate=continuous ? prior.yawRate ?? 0 : 0;
  const speed=continuous && dt>0 ? (s.distanceM-prior.riderDistanceM)/dt : 0;
  const speedScale=Math.max(1,Math.min(riderLimits.yawSpeedScale,speed/15));
  // The model's normal road-speed cap is below 15 m/s. Preserve its calm 1x
  // limits; accelerated playback must turn the same bends faster rather than
  // leave a narrow phone looking into a hillside. Scale acceleration as time
  // squared, retaining the same damped response, not an instantaneous catch-up.
  const yawLimit=riderLimits.yawRate*speedScale;
  const accelerationLimit=riderLimits.yawAcceleration*speedScale**2;
  const targetRate=continuous && dt>0 ? Math.max(-yawLimit,Math.min(yawLimit,
    shortestAngle(prior.target,target)/dt)) : 0;
  const response=6*speedScale;
  const acceleration=Math.max(-accelerationLimit,Math.min(accelerationLimit,
    response**2*delta+2*response*(targetRate-oldRate)));
  const desiredRate=Math.max(-yawLimit,Math.min(yawLimit,oldRate+acceleration*dt));
  // When displayed speed drops (including pause/input between model frames),
  // brake toward the lower velocity cap rather than snapping to it. Acceleration
  // stays bounded even while the old rate temporarily exceeds that new cap.
  const yawRate=continuous ? oldRate+Math.max(-accelerationLimit*dt,
    Math.min(accelerationLimit*dt,desiredRate-oldRate)) : 0;
  const bearing=continuous ? prior.bearing+yawRate*dt : target;
  // Look just above nearby road terrain, not at an underfoot point. Descending
  // terrain needs a lower axis; uphill remains capped by the pinned SDK.
  // Distance input changes distance, not optical tilt. Otherwise lowering the
  // camera simultaneously aims farther away and can undo the visible zoom.
  const targetPitch=Math.max(45,Math.min(85,Math.atan2(horizontal,ground+support+5/2.5**(2.6/6)-aimGround-1)*180/Math.PI));
  const pitchStep=20*Math.max(1,Math.min(4,speed/15))*dt;
  const pitch=continuous ? prior.pitch+Math.max(-pitchStep,Math.min(pitchStep,targetPitch-prior.pitch)) : targetPitch;
  // A phone's narrow frustum can expose less than two metres of a hairpin.
  // Sample the nearby source road more densely; keep the same depth/ink gate.
  const sampleDistances=[...Array.from({length:37},(_,i)=>2+i*.5),...Array.from({length:20},(_,i)=>22+i*2)];
  const samples=sampleDistances.map(m=>positionAt(a,Math.min(a.distanceM,distanceM+m)))
    .filter((p,i,all)=>!i || metresBetween(p,all[i-1])>.1);
  return {position:[p.lon,p.lat],altitude:ground+clearance,ground,clearance,pitch,bearing,
    aim,aimGround,samples,distanceM,riderDistanceM:s.distanceM,yawRate,target,support,targetPitch,neededSupport:needed};
}

// Solve the optical-axis intersection with the SAME sampled DEM as jumpTo.
// v2.15 setFreeCameraOptions recenters via simplified DEM-tree triangles;
// their elevation differs from the draped surface at near-road scale.
// A legal orbit avoids that raycast and is checked through getFreeCameraOptions.
export function riderOrbit(geometry,terrainAtRange,maxRange=4096) {
  const tangent=Math.tan(geometry.pitch*Math.PI/180);
  const height=r=>{
    const z=terrainAtRange(r);
    return Number.isFinite(z) ? z+r/tangent-geometry.altitude : NaN;
  };
  let low=0,high;
  for(let r=4;r<=maxRange;r+=r<128?4:32) {
    const h=height(r);
    if (!Number.isFinite(h)) return null;
    if (h>=0) {high=r;break;}
    low=r;
  }
  if (!high) return null;
  for(let i=0;i<16;i++) {
    const mid=(low+high)/2,h=height(mid);
    if (!Number.isFinite(h)) return null;
    if (h>=0) high=mid;else low=mid;
  }
  return (low+high)/2;
}

// Separate forward proof: no underfoot beacon requirement and no demand that
// sky/distant naturally occluded hills be ground. Still current rendered depth,
// current DEM, actual camera clearance AND visible nearby source-road ink.
export function riderTerrainElevation(map,point,version) {
  const publicHeight=map.queryTerrainElevation(point);
  if(Number.isFinite(publicHeight)) return {height:publicHeight,via:'public'};
  // Pinned 2.15 Elevation.getAtPoint searches active tiles, not SourceCache's
  // retained loaded tiles. At a tile edge the underfoot tile leaves the frustum
  // before the camera crosses its boundary. Read the actual current tile, never
  // a retained elevation scalar. No cache removal, reload or SDK state mutation.
  return loadedRiderDEM(map,point,version,false);
}
// A loaded current-source DEM can precede the SDK's per-frame lookup-cache
// reset/upload. It is a safety ceiling for the imminent refinement, NOT proof
// that this surface has rendered. Current-frame proof remains independent.
export const riderTerrainCeiling=(map,point,version)=>loadedRiderDEM(map,point,version,true);
function loadedRiderDEM(map,point,version,allowPending) {
  const terrain=map.painter?.terrain,cache=terrain?.sourceCache,source=cache?.getSource();
  if(version!=='2.15.0' || !terrain?.enabled || map.getTerrain()?.exaggeration!==1 ||
    map.getTerrain()?.source!=='rider-dem' || map.getSource('rider-dem')!==source ||
    source?.type!=='raster-dem' || source.url!=='mapbox://mapbox.mapbox-terrain-dem-v1' ||
    source.maxzoom!==14 || !cache._sourceLoaded) return null;
  const lon=Array.isArray(point)?point[0]:point.lng,lat=Array.isArray(point)?point[1]:point.lat;
  if(!Number.isFinite(lon+lat) || Math.abs(lat)>=85 || Math.abs(lon)>180)return null;
  const mx=(lon+180)/360,my=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
  const covers=tile=>{
    const c=tile?.tileID?.canonical;
    return c && c.z===14 && !tile.tileID.wrap && Math.floor(mx*2**c.z)===c.x && Math.floor(my*2**c.z)===c.y;
  };
  // Never substitute an old cached revision for an active (possibly reloading)
  // revision. Source reload clears this cache in pinned SourceCache.reload.
  const active=Object.values(cache._tiles ?? {}).filter(covers);
  if(active.length && !allowPending)return null;
  const candidates=active.length?active:Object.values(cache._cache?.data ?? {}).flat().map(x=>x.value).filter(covers);
  if(candidates.length!==1)return null;
  const tile=candidates[0],dem=tile.dem,c=tile.tileID.canonical;
  if(tile.state!=='loaded' || tile.aborted || (active.length?tile.uses<1:tile.uses!==0) || !tile.hasData?.() ||
    !dem || dem.uid!==tile.uid || dem.dim!==512 ||
    !allowPending && (!tile.demTexture || tile.needsDEMTextureUpload) ||
    Number.isFinite(tile.expirationTime) && tile.expirationTime<=Date.now())return null;
  const x=(mx*2**c.z-c.x)*dem.dim,y=(my*2**c.z-c.y)*dem.dim,i=Math.floor(x),j=Math.floor(y);
  if(i<0 || j<0 || i>=dem.dim || j>=dem.dim)return null;
  const q=[dem.get(i,j),dem.get(i+1,j),dem.get(i,j+1),dem.get(i+1,j+1)];
  if(!q.every(Number.isFinite))return null;
  const height=(q[0]*(1-x+i)+q[1]*(x-i))*(1-y+j)+(q[2]*(1-x+i)+q[3]*(x-i))*(y-j);
  return {height,via:allowPending?'loaded-source-ceiling':'current-source-tile',
    source:source.id,tile:[c.z,c.x,c.y],uid:tile.uid,demUid:dem.uid};
}
export function riderFrameEvidence(map,geometry,imageryReady,uncovered=()=>true,version,distanceM=geometry?.riderDistanceM) {
  const position=map.getFreeCameraOptions().position;
  const ll=position.toLngLat(), altitude=position.toAltitude();
  const terrain=riderTerrainElevation(map,ll,version),ground=terrain?.height;
  const clearance=Number.isFinite(ground) ? altitude-ground : null;
  const located=!!geometry && geometry.riderDistanceM===distanceM && metresBetween({lon:ll.lng,lat:ll.lat},
    {lon:geometry.position[0],lat:geometry.position[1]})<3;
  const elevation=Number.isFinite(clearance) && clearance>=1.5 && clearance<=riderLimits.maxClearance+1;
  const samples=(geometry?.samples ?? []).map(p=>{
    const xy=map.project([p.lon,p.lat]),z=map.queryTerrainElevation([p.lon,p.lat]);
    const depth=terrainDepthEvidence(map,p,xy,z,true);
    return {distanceM:p.distanceM,lon:p.lon,lat:p.lat,x:xy.x,y:xy.y,z,...depth,
      // At near-road pitch 2.15's queryRenderedFeatures can report zero
      // features despite visible draped ink (its terrain query bounds use a
      // different raycast). These are exact source-road samples with current
      // DEM/depth, not arbitrary viewport pixels. Still require real ink.
      road:depth.visible && uncovered(xy) && renderedRoadInk(map,xy)};
  });
  const road=samples.filter(p=>p.covered && p.visible && p.road).length>=2;
  // Also inspect real DEM patches beside the forward corridor, not just the
  // route ink. These are terrain probes, never manufactured road geometry.
  const yaw=map.getBearing()*Math.PI/180,lon=ll.lng,lat=ll.lat;
  const patches=[5,15,40].flatMap(ahead=>[-15,0,15].map(side=>{
    const p={lon:lon+(Math.sin(yaw)*ahead+Math.cos(yaw)*side)/(111319.49*Math.cos(lat*Math.PI/180)),
      lat:lat+(Math.cos(yaw)*ahead-Math.sin(yaw)*side)/111319.49};
    const xy=map.project([p.lon,p.lat]),z=map.queryTerrainElevation([p.lon,p.lat]);
    return {...p,...terrainDepthEvidence(map,p,xy,z,true)};
  }));
  const raster=imageryReady([...samples,...patches]),imagery=typeof raster==='boolean'?raster:raster?.ok===true;
  return {mode:'rider',located,elevation,road,imagery,raster:typeof raster==='object'?raster:undefined,altitude,ground,clearance,terrain,
    position:[ll.lng,ll.lat],pitch:map.getPitch(),bearing:map.getBearing(),samples,
    ok:located && elevation && road && imagery};
}
export const followMotion = Object.freeze({behindM:1500,aheadM:2500,yawDegreesPerSecond:12});
export const shortestAngle = (from,to)=>((to-from+540)%360+360)%360-180;
// Dense controllers already supply one route position per frame: preserve that
// exact shared position. Sparse controllers can present between KNOWN targets,
// never extrapolate a velocity. onPresent in the adapter exposes this same
// distance to linked projections. Gaps/commands flush rather than catch up.
export function createRoutePresentation(analysis) {
  let target, shown, start, at, duration=0;
  return {
    push(snapshot,now,reset=false) {
      const gap=now-at;
      const continuous=!reset && target?.phase==='playing' && snapshot.phase==='playing' &&
        !snapshot.reducedMotion && !snapshot.hidden &&
        target.cameraMode===snapshot.cameraMode &&
        target.identity?.revisionId===snapshot.identity?.revisionId &&
        target.identity?.geometrySha256===snapshot.identity?.geometrySha256 &&
        snapshot.distanceM>=target.distanceM && snapshot.distanceM<analysis.distanceM &&
        gap>50 && gap<=250;
      start=this.sample(now) ?? snapshot;
      target=snapshot;at=now;duration=continuous ? gap : 0;
      return this.sample(now);
    },
    sample(now) {
      if (!target) return;
      const fraction=duration ? Math.max(0,Math.min(1,(now-at)/duration)) : 1;
      const distanceM=start.distanceM+(target.distanceM-start.distanceM)*fraction;
      shown=fraction===1 ? target : {...target,distanceM,position:positionAt(analysis,distanceM)};
      return shown;
    },
    pending:now=>duration>0 && now<at+duration,
  };
}
// This is an update filter, not another playback clock. Explicit framing
// commands reset it; suspended time cannot be accumulated into a large turn.
export function followBearing(target,prior,elapsedMs) {
  if (!Number.isFinite(prior)) return target;
  const step=followMotion.yawDegreesPerSecond*Math.max(0,Math.min(250,elapsedMs))/1000;
  return prior+Math.max(-step,Math.min(step,shortestAngle(prior,target)));
}
export function officialFlyover(resolved) {
  const {bundle:b, profile:a, state:s} = resolved;
  return s?.area==='explore' && s.view==='flyover' && b?.route.kind==='organizer' &&
    b.route.rights?.redistribution==='approved' && b.revision.rights?.redistribution==='approved' &&
    !b.route.id.startsWith('user:') && a?.status==='supported' &&
    a.identity?.routeId===b.route.id && a.identity?.revisionId===b.revision.id;
}
export function routeBounds(a, chapterId) {
  const points=chapterId ? sectionPoints(a,chapterId) : a.points;
  const xs=points.map(p=>p.lon), ys=points.map(p=>p.lat);
  return [[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]];
}
function sectionPoints(a,chapterId) {
  const c=a.chapters.find(c=>c.id===chapterId);
  if (!c) throw Error('Section outside selected revision');
  return [positionAt(a,c.startM),...a.points.filter(p=>p.distanceM>c.startM && p.distanceM<c.endM),
    positionAt(a,c.endM)];
}
export function routeSection(a,chapterId) {
  return routeLine({points:sectionPoints(a,chapterId)});
}
export function routeLine(a,focusIndex) {
  // Spend part of the SAME vertex budget on consecutive source points near
  // the rider. Uniform thinning alone cuts across switchbacks at closer zoom.
  // The adapter changes this window only every 128 source points, not per RAF.
  const detailed=Number.isInteger(focusIndex) && focusIndex>=0 && focusIndex<a.points.length;
  const from=detailed ? Math.max(0,focusIndex-flyoverLimits.detailStep) : 0;
  const to=detailed ? Math.min(a.points.length-1,from+flyoverLimits.detailVertices-1) : -1;
  const budget=flyoverLimits.vertices-(to-from+1);
  const step=Math.max(1,Math.ceil((a.points.length-1)/(budget-1)));
  return a.points.filter((p,i)=>i%step===0 || i===a.points.length-1 || i>=from && i<=to).map(p=>[p.lon,p.lat]);
}
export function cameraPose(a, snapshot, refinements={}) {
  const p=snapshot.position;
  if (!p || snapshot.identity?.revisionId!==a.identity.revisionId ||
      snapshot.identity?.geometrySha256!==a.identity.geometrySha256 ||
      !Number.isFinite(p.rawElevationM)) throw Error('Exact route position/elevation unavailable');
  const d=snapshot.distanceM;
  const mode=snapshot.cameraMode;
  const before=positionAt(a,Math.max(0,d-(mode==='follow' ? followMotion.behindM : 180)));
  const after=positionAt(a,Math.min(a.distanceM,d+(mode==='follow' ? followMotion.aheadM : 300)));
  const course=Math.atan2((after.lon-before.lon)*Math.cos(p.lat*Math.PI/180),after.lat-before.lat)*180/Math.PI;
  const side=refinements.side===-1 ? -1 : 1;
  const bearing=mode==='overview' ? 0 : mode==='side' ? course+90*side :
    mode==='cinematic' ? course-35+20*Math.sin(d/3000) : course;
  return {center:[p.lon,p.lat], bearing,
    pitch:mode==='overview' ? 0 : Math.max(20,Math.min(flyoverLimits.maxPitch,refinements.pitch ?? (mode==='side' ? 55 : 45))),
    zoom:Math.max(flyoverLimits.minZoom,Math.min(flyoverLimits.maxZoom,
      Number.isFinite(refinements.zoom) ? refinements.zoom : (mode==='cinematic' ? 12 : 12.6)))};
}
// Pinned Mapbox 2.15 rendered-terrain depth, using the SAME NDC bias as its
// _prelude_terrain.vertex.glsl isOccluded(). CPU unproject instead raycasts
// simplified DEM-tree triangles: it is not the inverse of DEM-sampled project.
// A transparent circle layer requests the SDK's normal depth pass. Read only
// the rider pixel after that draw; never manufacture a second terrain mesh.
function depthState(map,local) {
  const terrain=map.painter?.terrain, t=map.transform;
  const c=local && t.locationCoordinate({lng:local.lon,lat:local.lat});
  const proxies=(terrain?.proxyCoords ?? []).filter(id=>{
    if (!c) return true;
    const tile=id.canonical,n=2**tile.z;
    return Math.floor((c.x-(id.wrap || 0))*n)===tile.x && Math.floor(c.y*n)===tile.y;
  });
  const covered=!!proxies.length && proxies.every(id=>terrain.terrainTileForTile[id.key]?.dem);
  const fbo=terrain?._depthFBO, gl=map.painter?.context?.gl;
  // SDK 2.15 drawDepth allocates ceil(painter dimensions) at fractional DPR.
  const ready=covered && !!fbo && !!gl && !gl.isContextLost() &&
    t.projection?.name==='mercator' && fbo.width===Math.ceil(map.painter.width) &&
    fbo.height===Math.ceil(map.painter.height);
  return {covered,ready,fbo,gl,t};
}
function surfaceDepth({gl,fbo,t},xy) {
  const rgba=new Uint8Array(4), previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo.framebuffer);
    gl.readPixels(Math.floor(xy.x/t.width*fbo.width),
      Math.min(fbo.height-1,Math.floor((1-xy.y/t.height)*fbo.height)),
      1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  } finally {gl.bindFramebuffer(gl.FRAMEBUFFER,previous);}
  // SDK pack_depth/unpack_depth stores clip depth in RGBA, not metres.
  return 2*(rgba[0]/255**4+rgba[1]/255**3+rgba[2]/255**2+rgba[3]/255)-1;
}
// At pitch 85 the SDK selects distant proxies behind local hills. Require
// current raster bindings at every depth-verified nearby road/terrain probe,
// not at naturally hidden regions. No inference from empty depth pixels:
// pinned drawTerrainDepth clears depth, NOT its colour attachment, so sky can
// retain old encoded values. Aerial/manual retain their all-proxy contract.
export function riderRasterEvidence(map,points=[]) {
  const tr=map.painter?.terrain,samples=[];
  if(!tr?.proxyCoords?.length || !tr.proxyToSource)return {ok:false,samples};
  const caches=map.getStyle().layers.filter(l=>l.type==='raster' && l.layout?.visibility!=='none')
    .map(l=>({source:l.source,cache:map.style._getSourceCache(l.source)}));
  const contains=(id,x,y)=>{
    const c=id.canonical,n=2**c.z;
    return Math.floor((x-(id.wrap||0))*n)===c.x && Math.floor(y*n)===c.y;
  };
  for(const p of points.filter(p=>p.covered && p.visible)) {
    if(!Number.isFinite(p.lon+p.lat))return {ok:false,samples};
    const {x,y}=map.transform.locationCoordinate({lng:p.lon,lat:p.lat});
    if(!Number.isFinite(x+y))return {ok:false,samples};
    const proxies=tr.proxyCoords.filter(p=>contains(p,x,y));
    const sources=proxies.flatMap(p=>caches.flatMap(({source,cache})=>
      (tr.proxyToSource[p.key]?.[cache.id]||[]).filter(id=>contains(id,x,y)&&!!cache.getTile(id)?.texture)
        .map(id=>({source,z:id.canonical.z}))));
    samples.push({lon:p.lon,lat:p.lat,textured:sources.length>0,sources});
  }
  return {ok:samples.length>=2 && samples.every(p=>p.textured),samples};
}
export function terrainDepthEvidence(map,p,xy,z,local=false) {
  const state=depthState(map,local?p:undefined), {covered,ready,t}=state;
  const unknown={covered,visible:false,gap:null};
  if (!ready || !Number.isFinite(z) || !Number.isFinite(xy.x+xy.y) ||
      xy.x<0 || xy.y<0 || xy.x>=t.width || xy.y>=t.height) return unknown;
  const c=t.locationCoordinate({lng:p.lon,lat:p.lat});
  const x=c.x*t.worldSize,y=c.y*t.worldSize,m=t.projMatrix;
  const w=m[3]*x+m[7]*y+m[11]*z+m[15];
  const depth=(m[2]*x+m[6]*y+m[10]*z+m[14])/w;
  if (!(w>0) || !Number.isFinite(depth) || depth < -1 || depth > 1) return unknown;
  const surface=surfaceDepth(state,xy);
  const gap=depth-surface;
  return {covered,visible:gap<=.0005 && (!local || surface>-1 && surface<1),gap};
}
// Screen-point feature picking in SDK 2.15 raycasts the simplified DEM tree;
// at close zoom it can miss a visibly drawn road under the rider. Require a
// rendered route feature AND actual route/section ink in the current colour
// buffer near that pixel instead. Satellite/DEM coverage and occlusion remain
// separate mandatory gates. This reads the existing draw, not a second render.
export function renderedRoadEvidence(map,xy) {
  if (!map.queryRenderedFeatures({layers:['route']}).length) return false;
  return renderedRoadInk(map,xy);
}
function renderedRoadInk(map,xy) {
  const gl=map.painter?.context?.gl,t=map.transform;
  if (!gl || gl.isContextLost() || !Number.isFinite(xy.x+xy.y)) return false;
  const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
  const left=Math.max(0,Math.floor((xy.x-8)/t.width*width));
  const right=Math.min(width,Math.ceil((xy.x+8)/t.width*width));
  const bottom=Math.max(0,Math.floor((1-(xy.y+8)/t.height)*height));
  const top=Math.min(height,Math.ceil((1-(xy.y-8)/t.height)*height));
  if (!(right>left && top>bottom)) return false;
  const pixels=new Uint8Array((right-left)*(top-bottom)*4);
  const previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.readPixels(left,bottom,right-left,top-bottom,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER,previous); }
  // Opaque #ff932e route or the #ffe097, .9-opacity selected-section over it.
  // Allow byte rounding only, not a broad satellite-colour/brightness heuristic.
  let ink=0;
  for(let i=0;i<pixels.length;i+=4) if (pixels[i]>=253 && pixels[i+3]>=253 &&
    (Math.abs(pixels[i+1]-147)<=2 && Math.abs(pixels[i+2]-46)<=2 ||
     Math.abs(pixels[i+1]-216)<=2 && Math.abs(pixels[i+2]-140)<=2)) ink++;
  return ink>=2;
}
// HTTP success/queued tiles and the marker's delayed opacity alone are not
// paint evidence. Require current DEM bindings and actual rendered depth too.
export function frameEvidence(map, p, marker, container, imageryReady, mode='follow') {
  if (mode==='manual') {
    // Manual exploration proves the visible terrain, NOT an off-screen rider.
    // Require every current proxy's DEM binding and the existing whole-view
    // raster coverage gate, plus actual depth/DEM at a viewport sampling grid.
    // Unproject is only a ground sample here, never an inverse-rider/occlusion
    // test. No raw route elevation or route pixel is expected in this view.
    const state=depthState(map), imagery=imageryReady();
    let elevation=state.covered, depth=state.ready;
    if (state.ready) for(const x of [.05,.5,.95]) for(const y of [.05,.5,.95]) {
      const xy={x:x*state.t.width,y:y*state.t.height};
      const ground=map.unproject(xy), z=map.queryTerrainElevation(ground);
      elevation &&= Number.isFinite(z);
      const surface=surfaceDepth(state,xy);
      depth &&= Number.isFinite(surface) && surface>-1 && surface<1;
    }
    return {mode,imagery,elevation,depth,ok:imagery && elevation && depth};
  }
  const gps=[p.lon,p.lat], xy=map.project(gps), z=map.queryTerrainElevation(gps);
  const box=container.getBoundingClientRect(), dot=marker.getBoundingClientRect();
  const framed=Number.isFinite(xy.x+xy.y) &&
    Math.min(xy.x,xy.y,box.width-xy.x,box.height-xy.y)>=14 &&
    Math.min(dot.left-box.left,box.right-dot.right,dot.top-box.top,box.bottom-dot.bottom)>=2;
  const aligned=Math.hypot(dot.left+dot.width/2-box.left-xy.x,dot.top+dot.height/2-box.top-xy.y)<2;
  const depth=terrainDepthEvidence(map,p,xy,z);
  const elevation=depth.covered && Number.isFinite(z) && Math.abs(z-p.rawElevationM)<=300;
  const clear=depth.visible && Number(getComputedStyle(marker).opacity)===1;
  const road=renderedRoadEvidence(map,xy);
  return {mode,framed,aligned,elevation,clear,road,depthGap:depth.gap,imagery:imageryReady(),
    ok:framed && aligned && elevation && clear && road && imageryReady()};
}
