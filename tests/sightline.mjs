import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source = await readFile(new URL('../assets/terrain.js',import.meta.url),'utf8');
const solve = runInNewContext(source+'\nterrainPose', {window:{}});
const focus = {lon:11.76,lat:45.8,height:500};
// A smoothed switchback cuts inside the actual route by 120 metres.
const gps = {...focus,lon:focus.lon+120/77450};
const x = lon => (lon-focus.lon)*77450, y = lat => (lat-focus.lat)*111200;

test('off-axis rider ray clears a spur missed by the focus ray; bounded approach and release', () => {
  for (const fraction of [.45,1/32]) {
    let queries=0;
    const height=([lon,lat])=>500+700*Math.max(0,1-Math.hypot(
      x(lon)-120*(1-fraction),y(lat)+900*fraction)/32);
    const map={queryTerrainElevation(xy){ queries++; return height(xy); }};
    const pose=solve(map,gps,focus,0,null,0);
    assert.ok(queries<=35 && pose.sampled && pose.reach<1);
    const z0=height([gps.lon,gps.lat]);
    assert.equal(pose.altitude,z0+600,'a near-endpoint wall must not launch the camera');
    for(let i=1;i<=1000;i++) {
      const f=i/1000;
      const z=height([gps.lon+f*(pose.eye[0]-gps.lon),gps.lat+f*(pose.eye[1]-gps.lat)]);
      assert.ok(z0+(pose.altitude-z0)*f>z,'actual rider sightline');
    }
    const clear={queryTerrainElevation:()=>500};
    const next=solve(clear,gps,focus,0,pose,1/60);
    assert.ok(next.reach>pose.reach && next.reach-pose.reach<.03,'no instant orbit expansion');
  }
});

test('a missing DEM band truncates the ray; missing rider DEM cannot verify it',()=>{
  const dem=([,lat])=>y(lat)<-400 && y(lat)>-500 ? null : 500;
  const pose=solve({queryTerrainElevation:dem},gps,focus,0,null,0);
  assert.ok(pose.sampled && pose.reach<.45 && y(pose.eye[1])>-400);
  const missing=solve({queryTerrainElevation:()=>null},gps,focus,0,null,0);
  assert.ok(Number.isFinite(missing.altitude) && !missing.sampled);
});

test('visible raster coverage accepts a drawn parent, not a loaded tile elsewhere',()=>{
  const coverage=runInNewContext(source+'\nrasterCoverage',{window:{}});
  let rendered=[],parent=false,sourceLoaded=false;
  const cache={getSource:()=>({maxzoom:18}),getRenderableIds:()=>rendered,hasRenderableParent:()=>parent};
  const ready=coverage({getStyle:()=>({layers:[{source:'sat',type:'raster'}]}),
    style:{_getSourceCache:()=>cache},isSourceLoaded:()=>sourceLoaded,
    transform:{coveringTiles:()=>[{key:3,children:()=>[4,5,6,7].map(key=>({key}))}]}});
  assert.ok(!ready());
  rendered=[2]; assert.ok(!ready());
  parent=true; assert.ok(ready());
  parent=false; rendered=[4,5,6]; assert.ok(!ready());
  rendered.push(7); assert.ok(ready());
  sourceLoaded=true; rendered=[]; assert.ok(!ready());
});
