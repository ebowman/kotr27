// Camera geometry, bounded presentation interpolation and paint proof.
// No playback integration, network or route-state mutation.
import { positionAt } from './route-analysis.mjs';

export const cameraJobs = Object.freeze([
  ['follow','Follow','Look ahead along the riding direction.'],
  ['overview',"Overview / Bird’s-eye",'North-up, fit the whole route; the rider stays marked.'],
  ['side','Side','Look across the route from the right-hand side.'],
  ['cinematic','Cinematic','A wide trailing-quarter view turning with route distance, not a second clock.'],
]);
export const flyoverLimits = Object.freeze({vertices:2048, tileRequests:240, tileCache:32,
  frameMs:200, loadMs:12000, coverageMs:2500, maxZoom:13, maxPitch:55,maxPixels:4000000});
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
export function routeLine(a) {
  const step=Math.max(1,Math.ceil((a.points.length-1)/(flyoverLimits.vertices-1)));
  return a.points.filter((p,i)=>i%step===0 || i===a.points.length-1).map(p=>[p.lon,p.lat]);
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
    zoom:Math.max(10,Math.min(flyoverLimits.maxZoom,refinements.zoom ?? (mode==='cinematic' ? 12 : 12.6)))};
}
// Pinned Mapbox 2.15 rendered-terrain depth, using the SAME NDC bias as its
// _prelude_terrain.vertex.glsl isOccluded(). CPU unproject instead raycasts
// simplified DEM-tree triangles: it is not the inverse of DEM-sampled project.
// A transparent circle layer requests the SDK's normal depth pass. Read only
// the rider pixel after that draw; never manufacture a second terrain mesh.
function depthState(map) {
  const terrain=map.painter?.terrain, t=map.transform;
  const covered=!!terrain?.proxyCoords?.length &&
    terrain.proxyCoords.every(id=>terrain.terrainTileForTile[id.key]?.dem);
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
export function terrainDepthEvidence(map,p,xy,z) {
  const state=depthState(map), {covered,ready,t}=state;
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
  return {covered,visible:gap<=.0005,gap};
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
  const road=map.queryRenderedFeatures([[xy.x-8,xy.y-8],[xy.x+8,xy.y+8]],{layers:['route']}).length>0;
  return {mode,framed,aligned,elevation,clear,road,depthGap:depth.gap,imagery:imageryReady(),
    ok:framed && aligned && elevation && clear && road && imageryReady()};
}
