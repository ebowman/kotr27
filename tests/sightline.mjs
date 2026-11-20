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

test('one missing sample on the ridge shot requires independent mesh proof, not a camera cut',()=>{
  const ridge={...focus,ridge:1}, full=solve({queryTerrainElevation:()=>500},gps,ridge,0,null,0);
  const dem=([,lat])=>lat<=full.eye[1] ? null : 500;
  const pose=solve({queryTerrainElevation:dem},gps,ridge,0,full,.064);
  assert.ok(!full.needsMeshProof && pose.needsMeshProof && pose.sampled);
  assert.deepEqual(pose.eye,full.eye);
  const missing=solve({queryTerrainElevation:()=>null},gps,focus,0,null,0);
  assert.ok(Number.isFinite(missing.altitude) && !missing.sampled);
});

test('flat raster accepts the union of drawn textures, not loaded neighbours or a missing quadrant',()=>{
  const coverage=runInNewContext(source+'\nrasterCoverage',{window:{}});
  const id=(z,x,y)=>({canonical:{z,x,y},wrap:0});
  const west=id(12,2,4),east=id(12,3,4),sat=[],cover=[];
  const cache=ids=>({getSource:()=>({}),getRenderableIds:()=>ids,getTileByID:tileID=>({tileID,texture:!tileID.missing})});
  const ready=coverage({getStyle:()=>({layers:['sat','cover'].map(k=>({id:k,source:k,type:'raster'}))}),
    setPaintProperty:(k,...args)=>assert.deepEqual(args,['raster-fade-duration',0]),
    style:{_getSourceCache:k=>cache(k==='sat'?sat:cover)},
    transform:{coveringTiles:()=>[west,east]}});
  assert.ok(!ready());
  cover.push(id(11,1,1)); assert.ok(!ready()); // unrelated loaded tile
  sat.push(id(11,1,2)); assert.ok(ready()); // drawn parent
  sat.splice(0,1,west);
  cover.push(id(13,6,8),id(13,7,8),id(13,6,9));
  assert.ok(!ready());
  const last=id(13,7,9); last.missing=true; sat.push(last); assert.ok(!ready());
  last.missing=false; assert.ok(ready()); // neither cache suffices alone
});

test('draped raster follows textured proxy bindings, not an ideal flat selection',()=>{
  const coverage=runInNewContext(source+'\nrasterCoverage',{window:{}});
  const id=(z,x,y,texture=true)=>({canonical:{z,x,y},wrap:0,texture});
  const proxy={...id(12,2,4),key:17};
  const bound={sat:[],cover:[]};
  const ready=coverage({getStyle:()=>({layers:['sat','cover'].map(id=>({id,type:'raster',source:id}))}),
    setPaintProperty(){},style:{_getSourceCache:id=>({id,getTile:key=>({texture:key.texture})})},
    transform:{elevation:{proxyCoords:[proxy],proxyToSource:{17:bound}}}});
  bound.sat=[id(11,1,2)]; assert.ok(ready());
  bound.sat=[id(11,1,2,false)]; assert.ok(!ready());
  bound.sat=[id(13,4,8),id(13,5,8),id(13,4,9),id(13,4,9),id(14,8,18)];
  assert.ok(!ready(),'duplicates and nested children cannot conceal a hole');
  bound.cover.push({...id(13,5,9),wrap:1}); assert.ok(!ready(),'another world copy cannot fill a hole');
  bound.cover.push(id(13,5,9)); assert.ok(ready(),'last bound quadrant comes from the coarse layer');
});

test('visible seam cache follows DEM replacement inside a drawn parent, in either axis',()=>{
  const make=runInNewContext(source+'\nvisibleSeamCheck',{window:{}});
  for (const axis of ['x','y']) {
    const tileID=(key,z,x,y)=>({key,canonical:{z,x,y}});
    const near=tileID(1,13,4362,2920), far=tileID(2,13,4362,2920);
    far.canonical[axis]++;
    let reads=0;
    const dem=get=>({dim:256,get(x,y){
      assert.ok(x>=0 && x<256 && y>=0 && y<256);
      reads++; return get(axis==='x'?x:y,axis==='x'?y:x);
    }});
    const coarse={tileID:tileID(3,12,2181,1460),dem:dem(i=>500+i)};
    const fine={tileID:far,dem:dem(i=>628+i/2)};
    const terrain={proxyCoords:[near,far],terrainTileForTile:{1:coarse,2:fine}};
    const bad=make();
    assert.ok(!bad(terrain));
    assert.equal(reads,2*256);
    assert.ok(!bad(terrain));
    assert.equal(reads,2*256,'unchanged render must not rescan the edge');
    // Replacement has a narrow notch only on this child edge. The parent
    // sample opposite it is *inside* the parent, not at column/row 255.
    fine.dem=dem((i,j)=>i===0 && j===173 ? 150 : 628+i/2);
    assert.ok(bad(terrain),'refinement at same proxy IDs must invalidate the previous pass');
  }
});
