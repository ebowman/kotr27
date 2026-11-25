// Camera geometry only. No clock, estimation, network or route-state mutation.
import { positionAt } from './route-analysis.mjs';

export const cameraJobs = Object.freeze([
  ['follow','Follow','Look ahead along the riding direction.'],
  ['overview',"Overview / Bird’s-eye",'North-up, fit the whole route; the rider stays marked.'],
  ['side','Side','Look across the route from the right-hand side.'],
  ['cinematic','Cinematic','A wide trailing-quarter view turning with route distance, not a second clock.'],
]);
export const flyoverLimits = Object.freeze({vertices:2048, tileRequests:240, tileCache:32,
  frameMs:200, loadMs:12000, coverageMs:2500, maxZoom:13, maxPitch:55,maxPixels:4000000});
export function officialFlyover(resolved) {
  const {bundle:b, profile:a, state:s} = resolved;
  return s?.area==='explore' && s.view==='flyover' && b?.route.kind==='organizer' &&
    b.route.rights?.redistribution==='approved' && b.revision.rights?.redistribution==='approved' &&
    !b.route.id.startsWith('user:') && a?.status==='supported' &&
    a.identity?.routeId===b.route.id && a.identity?.revisionId===b.revision.id;
}
export function routeBounds(a) {
  const xs=a.points.map(p=>p.lon), ys=a.points.map(p=>p.lat);
  return [[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]];
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
  const before=positionAt(a,Math.max(0,d-180)), after=positionAt(a,Math.min(a.distanceM,d+300));
  const course=Math.atan2((after.lon-before.lon)*Math.cos(p.lat*Math.PI/180),after.lat-before.lat)*180/Math.PI;
  const mode=snapshot.cameraMode;
  const side=refinements.side===-1 ? -1 : 1;
  const bearing=mode==='overview' ? 0 : mode==='side' ? course+90*side :
    mode==='cinematic' ? course-35+20*Math.sin(d/3000) : course;
  return {center:[p.lon,p.lat], bearing,
    pitch:mode==='overview' ? 0 : Math.max(20,Math.min(flyoverLimits.maxPitch,refinements.pitch ?? (mode==='side' ? 55 : 45))),
    zoom:Math.max(10,Math.min(flyoverLimits.maxZoom,refinements.zoom ?? (mode==='cinematic' ? 12 : 12.6)))};
}
// Match the legacy painter's actual mesh-pick, framing and rendered-road checks.
// A successful HTTP response or queued tile is never paint evidence.
export function frameEvidence(map, p, marker, container, imageryReady) {
  const gps=[p.lon,p.lat], xy=map.project(gps), z=map.queryTerrainElevation(gps);
  const box=container.getBoundingClientRect(), dot=marker.getBoundingClientRect();
  const framed=Number.isFinite(xy.x+xy.y) &&
    Math.min(xy.x,xy.y,box.width-xy.x,box.height-xy.y)>=14 &&
    Math.min(dot.left-box.left,box.right-dot.right,dot.top-box.top,box.bottom-dot.bottom)>=2;
  const aligned=Math.hypot(dot.left+dot.width/2-box.left-xy.x,dot.top+dot.height/2-box.top-xy.y)<2;
  const hit=map.unproject(xy);
  const delta=Math.hypot((hit.lng-p.lon)*111200*Math.cos(p.lat*Math.PI/180),(hit.lat-p.lat)*111200);
  const elevation=Number.isFinite(z) && Math.abs(z-p.rawElevationM)<=300;
  const clear=delta<8 && Number(getComputedStyle(marker).opacity)===1;
  const road=map.queryRenderedFeatures([[xy.x-8,xy.y-8],[xy.x+8,xy.y+8]],{layers:['route']}).length>0;
  return {framed,aligned,elevation,clear,road,imagery:imageryReady(),
    ok:framed && aligned && elevation && clear && road && imageryReady()};
}
