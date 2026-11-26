// Intentional live-provider observation, not an assertion that imagery will work
// on loopback. No substitutes, provider interception, credentials changes or retries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { browser, until } from '../../tests/browser.mjs';
import { previewServer } from './serve.mjs';

// Real input events on the isolated page; no map/proof overrides.
async function offRiderPan(b,width,height) {
  const x=width/2,y=height/2;
  await b.js(`(()=>{
    const canvas=observedTerrain.getCanvas();
    canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:${x},clientY:${y},button:0,buttons:1}));
  })()`);
  for(let i=1;i<=16;i++) {
    await b.js(`document.dispatchEvent(new MouseEvent('mousemove',{
      bubbles:true,clientX:${x}+${i}*60,clientY:${y},button:0,buttons:1}))`);
    await sleep(40);
  }
  await b.js(`document.dispatchEvent(new MouseEvent('mouseup',{
    bubbles:true,clientX:${x}+960,clientY:${y},button:0}))`);
}

async function steadyTraversal(b) {
  // Real reviewed model at the supported 60× rate, not the retired 90s movie.
  await b.js(`document.getElementById('ride-mode').value='explore';
    document.getElementById('ride-mode').dispatchEvent(new Event('change'));
    document.getElementById('playback-rate').value='60';
    document.getElementById('playback-rate').dispatchEvent(new Event('change'));`);
  const remaining=await b.js(`document.getElementById('ride-remaining').textContent`);
  const parts=remaining.match(/^(\d+):(\d+):(\d+) remaining$/);
  assert.ok(parts,remaining);
  const seconds=Number(parts[1])*3600+Number(parts[2])*60+Number(parts[3]);
  return Math.ceil(seconds/60*1000)+30000;
}

test('Grappa and Asolo full modeled 60× motion then off-rider manual pan zoom and return; desktop and phone',async t=>{
  const server=await previewServer(0);
  t.after(()=>{server.closeAllConnections();server.close();});
  for(const [label,width,height] of [['desktop',1440,900],['phone',375,812]]) {
    const cleanup=[];
    const b=await browser({after:fn=>cleanup.push(fn)});
    try {
      await b.cmd('Page.enable');
      t.diagnostic(JSON.stringify({device:{platform:platform(),release:release(),cpu:cpus()[0]?.model,
        memoryGiB:Math.round(totalmem()/1024**3)},label,width,height,
        dpr:1,headless:true,browser:await b.cmd('Browser.getVersion')}));
      await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
        window.maps=[];
        Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
          Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
          gl.Map=new Proxy(gl.Map,{construct(T,args){
            const m=new T(...args);maps.push(m);return window.observedTerrain=m;
          }});
        }});`});
      await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await b.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/prototypes/rider-first/`});
      await until(()=>b.js(`!document.getElementById('fly').disabled`));
      await b.js(`document.getElementById('fly').click()`);
      const state=()=>b.js(`({
        proof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
        visible:getComputedStyle(document.getElementById('terrain')).visibility,
        online:document.getElementById('player').classList.contains('online'),
        status:document.getElementById('terrain-status').textContent,
        requests:Number(document.getElementById('terrain').dataset.requests),
        distance:Number(document.getElementById('terrain').dataset.distance),
        progress:document.getElementById('seek').value,
        playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview'
      })`);
      const ready=async()=>{
        for(let i=0;i<34;i++) {
          const s=await state();
          if(s.proof.ok && s.proof.current && s.online)return;
          assert.ok(!s.status.includes('unavailable'),JSON.stringify(s));
          await sleep(500);
        }
        assert.fail('Live terrain did not verify');
      };
      await ready();
      for(const route of ['rwgps-57873019','rwgps-57873112']) {
        if(route==='rwgps-57873112') {
          await b.js(`document.getElementById('player-route').value='${route}';
            document.getElementById('player-route').dispatchEvent(new Event('change'))`);
          await until(()=>b.js(`!document.getElementById('play').disabled && maps.length===2`));
          await ready();
          assert.equal(await b.js(`maps[0]._removed`),true,'Route switch disposes the old map');
        }
        const traversalMs=await steadyTraversal(b);
        await b.js(`(()=>{
          window.sequenceProbe={hidden:0,fallback:0,valid:0,invalid:0,maxRequests:0,minPitch:90,maxPitch:0};
          const m=observedTerrain,t=document.getElementById('terrain'),start=performance.now();
          const motion=window.motionProbe={commands:[],renders:[],proofs:[],statusChanges:0};
          const jump=m.jumpTo;
          m.jumpTo=function(pose,...args){
            const at=performance.now();
            if(at-start<=31000)motion.commands.push({at,center:pose.center,bearing:pose.bearing});
            return jump.call(this,pose,...args);
          };
          let previousProof,previousCenter;
          const render=()=>{
            if(performance.now()-start>31000)return;
            const center=m.getCenter(),key=center.lng+','+center.lat;
            if(key!==previousCenter){
              const rider=m._markers.find(m=>m.getElement().classList.contains('route-rider')).getLngLat();
              const xy=m.project(rider),cxy=m.project(center);
              motion.renders.push({at:performance.now(),center:[center.lng,center.lat],
                riderGap:center.distanceTo(rider),riderGapPx:Math.hypot(xy.x-cxy.x,xy.y-cxy.y),
                distanceM:Number(t.dataset.distance),
                profileFraction:Number(document.getElementById('profile-cursor').getAttribute('x1'))/640,
                sequence:JSON.parse(t.dataset.pose||'{}').sequence});
              previousCenter=key;
            }
            queueMicrotask(()=>{
              const p=JSON.parse(t.dataset.frame||'{}');
              if(p.proofSequence!==previousProof){motion.proofs.push(p);previousProof=p.proofSequence;}
            });
          };
          m.on('render',render);
          const observer=new MutationObserver(()=>motion.statusChanges++);
          observer.observe(document.getElementById('terrain-status'),{childList:true,characterData:true,subtree:true});
          motion.dispose=()=>{m.jumpTo=jump;m.off('render',render);observer.disconnect();};
          const tick=()=>{
            const p=sequenceProbe,t=document.getElementById('terrain'),proof=JSON.parse(t.dataset.frame||'{}');
            if(getComputedStyle(t).visibility!=='visible')p.hidden++;
            if(!document.getElementById('player').classList.contains('online'))p.fallback++;
            if(proof.ok)p.valid++;else p.invalid++;
            p.maxRequests=Math.max(p.maxRequests,Number(t.dataset.requests||0));
            p.minPitch=Math.min(p.minPitch,observedTerrain.getPitch());
            p.maxPitch=Math.max(p.maxPitch,observedTerrain.getPitch());
            p.raf=requestAnimationFrame(tick);
          };tick();document.getElementById('play').click();
        })()`);
        const start=Date.now();
        {
          while(Date.now()-start<traversalMs) {
            await sleep(250);
            const s=await state();
            assert.equal(s.online,true,JSON.stringify(s));
            if(!s.playing && s.progress==='1000')break;
          }
          assert.equal((await state()).progress,'1000','Full modeled steady route at 60× ride time, not a seek');
        }
        await ready();
        const result=await b.js(`cancelAnimationFrame(sequenceProbe.raf);({...sequenceProbe,raf:undefined})`);
        const motion=await b.js(`motionProbe.dispose();({...motionProbe,dispose:undefined})`);
        const pacing=samples=>{
          const intervals=samples.slice(1).map((s,i)=>s.at-samples[i].at).sort((a,b)=>a-b);
          return {count:samples.length,spanMs:samples.at(-1).at-samples[0].at,
            median:intervals[Math.floor(intervals.length*.5)],p95:intervals[Math.floor(intervals.length*.95)],
            max:intervals.at(-1)};
        };
        const commands=pacing(motion.commands),renders=pacing(motion.renders);
        const yaw=motion.commands.slice(1).map((s,i)=>{
          const prior=motion.commands[i],delta=((s.bearing-prior.bearing+540)%360+360)%360-180;
          return Math.abs(delta)/((s.at-prior.at)/1000);
        });
        const proofIntervals=motion.proofs.slice(1).map((p,i)=>p.at-motion.proofs[i].at);
        const finalState=await state();
        const profileGapM=Math.max(...motion.renders.map(r=>Math.abs(r.profileFraction*finalState.distance-r.distanceM)));
        console.log('ACTUAL MOTION:',JSON.stringify({label,route,commands,renders,
          maxYawRate:Math.max(...yaw),maxRiderGapM:Math.max(...motion.renders.map(r=>r.riderGap)),
          maxRiderGapPx:Math.max(...motion.renders.map(r=>r.riderGapPx)),
          maxProfileGapM:profileGapM,
          proofs:motion.proofs.length,minProofMs:Math.min(...proofIntervals),statusChanges:motion.statusChanges}));
        for(const p of [commands,renders]){
          assert.ok(p.spanMs>=30000,'At least 30s of actual changing camera/rendered centers');
          assert.ok(p.median<=33,JSON.stringify(p));
          assert.ok(p.p95<=50,JSON.stringify(p));
          assert.ok(p.count>900,'Not 5Hz poses on a 60Hz display');
        }
        // Terrain-adjusted Mapbox centers are not bit-identical coordinates.
        // Use the existing visible registration bound, not a new centimetre
        // requirement; retain metres in the evidence rather than hiding drift.
        assert.ok(Math.max(...motion.renders.map(r=>r.riderGapPx))<2,'Rider stays registered to rendered center');
        assert.ok(profileGapM<1e-6,'Actual profile and rendered rider use the same distance, not separate clocks');
        assert.ok(Math.max(...yaw)<13,'Bounded actual yaw, allowing timestamp instrumentation jitter');
        assert.ok(Math.min(...proofIntervals)>=199.9,'Proof is throttled, not the pose');
        assert.ok(motion.proofs.some(p=>p.ok && p.road && p.aligned && p.clear),'Actual road/clearance proof');
        assert.equal(finalState.proof.current,true);
        assert.equal(finalState.proof.distanceM,finalState.distance,'Finish proof is for the exact endpoint, not the last moving pose');
        assert.equal(await b.js(`observedTerrain.getCenter().distanceTo(mapboxgl.LngLat.convert(
          observedTerrain.getSource('route')._data.geometry.coordinates.at(-1)))<.01`),true,'Exact rendered source endpoint');
        console.log('SEQUENCE ROUTE:',JSON.stringify({label,route,elapsedMs:Date.now()-start,...result,...await state()}));
        assert.equal(result.hidden,0);assert.equal(result.fallback,0);
        assert.equal(result.minPitch,45);assert.equal(result.maxPitch,45);
      }
      await offRiderPan(b,width,height);
      await sleep(3500);
      const manual=await state();
      console.log('SEQUENCE OFF-RIDER:',JSON.stringify({label,...manual}));
      assert.equal(manual.online,true,'Healthy off-rider exploration survives coverage deadline');
      assert.equal(manual.proof.mode,'manual');
      assert.equal(manual.proof.ok,true);
      assert.equal(manual.playing,false);
      assert.equal(await b.js(`(()=>{
        const rider=observedTerrain._markers.find(m=>m.getElement().classList.contains('route-rider'));
        const p=observedTerrain.project(rider.getLngLat());
        return p.x<0 || p.y<0 || p.x>innerWidth || p.y>innerHeight;
      })()`),true,'The rider really is off viewport, not just labelled manual');
      // Real wheel input, followed by another entire coverage interval.
      const zoom=await b.js(`observedTerrain.getZoom()`);
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:height/2,deltaX:0,deltaY:-100});
      await sleep(3500);
      assert.notEqual(await b.js(`observedTerrain.getZoom()`),zoom,'Wheel really changed the camera');
      assert.equal((await state()).online,true);
      assert.equal((await state()).distance,manual.distance,'Manual pan/zoom pauses playback');
      assert.equal(await b.js(`document.getElementById('return-rider').hidden`),false);
      await b.js(`document.getElementById('return-rider').click()`);
      await ready();
      const returned=await state();
      assert.equal(returned.proof.mode,'follow');
      for(const key of ['framed','aligned','clear','road','elevation','imagery'])assert.equal(returned.proof[key],true,key);
      assert.equal(returned.distance,manual.distance,'Return frames the current rider, not route start');
      assert.equal(returned.playing,false);
      console.log('SEQUENCE RETURN:',JSON.stringify({label,...returned}));
      await sleep(3000);
      assert.equal((await state()).online,true,'No stale manual/old-map deadline');
      assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),1);
      assert.ok(await b.js(`document.documentElement.scrollWidth<=innerWidth`));
      await b.js(`document.getElementById('back').click()`);
      assert.deepEqual(b.exceptions,[]);
    } finally {for(const fn of cleanup)await fn();}
  }
});

test('live fractional-DPR terrain remains verified through resize and playback',async t=>{
  const server=await previewServer(0);
  t.after(()=>{server.closeAllConnections();server.close();});
  const b=await browser(t);
  await b.cmd('Page.enable');
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
      Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
      gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
    }});`});
  await b.cmd('Emulation.setDeviceMetricsOverride',
    {width:375,height:812,deviceScaleFactor:1.25,mobile:false});
  await b.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/prototypes/rider-first/`});
  await until(()=>b.js(`!document.getElementById('fly').disabled`));
  await b.js(`document.getElementById('fly').click()`);
  for(let i=0;i<34;i++){
    if(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok ||
      document.getElementById('terrain-status').textContent.includes('unavailable')`))break;
    await sleep(500);
  }
  const state=()=>b.js(`({
    painter:[observedTerrain.painter.width,observedTerrain.painter.height],
    depth:[observedTerrain.painter.terrain?._depthFBO?.width,observedTerrain.painter.terrain?._depthFBO?.height],
    proof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
    status:document.getElementById('terrain-status').textContent,
    visible:getComputedStyle(document.getElementById('terrain')).visibility,
    pitch:observedTerrain.getPitch()
  })`);
  await until(async()=>{const s=await state();return s.proof.ok && s.proof.current;});
  const initial=await state();
  assert.deepEqual(initial.painter,[468.75,1015]);
  assert.deepEqual(initial.depth,[469,1015]);
  assert.equal(initial.proof.ok,true,JSON.stringify(initial));
  console.log('FRACTIONAL DPR initial:',JSON.stringify(initial));
  // Change CSS size with DPR: SDK resize is a no-op for unchanged CSS dimensions.
  for(const [width,height,dpr] of [[375,813,1.25],[377,815,1.5],[384,812,1.25]]){
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
    await b.js(`observedTerrain.resize();void 0`);
    await until(async()=>{
      const s=await state();
      return s.painter[0]===width*dpr && s.painter[1]===height*dpr &&
        s.depth[0]===Math.ceil(width*dpr) && s.depth[1]===Math.ceil(height*dpr) && s.proof.ok && s.proof.current;
    });
    const current=await state();
    assert.deepEqual(current.depth,[Math.ceil(width*dpr),Math.ceil(height*dpr)]);
    assert.equal(current.visible,'visible');
    assert.equal(current.pitch,45);
    console.log('FRACTIONAL DPR resize:',JSON.stringify(current));
  }
  await b.cmd('Emulation.setDeviceMetricsOverride',
    {width:375,height:812,deviceScaleFactor:1.25,mobile:false});
  await b.js(`observedTerrain.resize();document.getElementById('play').click();void 0`);
  await sleep(4000); // Longer than the unchanged 2.5s coverage deadline.
  await b.js(`document.getElementById('play').click()`);
  await until(async()=>{const s=await state();return s.proof.ok && s.proof.current;});
  const final=await state();
  assert.equal(final.visible,'visible');
  assert.equal(final.pitch,45);
  assert.ok(await b.js(`Number(document.getElementById('cockpit').dataset.distance)>0`),
    'Actual physics-backed travel at default 16×, not the retired >2km/4s geometry movie');
  console.log('FRACTIONAL DPR after 4s playback:',JSON.stringify(final));
  await b.js(`document.getElementById('back').click()`);
  assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
  assert.deepEqual(b.exceptions,[]);
});

test('complete modeled steady 60× Grappa terrain playback at desktop and phone sizes',async t=>{
  const server=await previewServer(0);
  t.after(()=>{server.closeAllConnections();server.close();});
  const evidence=process.env.RIDER_FIRST_EVIDENCE_DIR;
  if(evidence)await mkdir(evidence,{recursive:true});
  for(const [label,width,height] of [['desktop',1440,900],['phone',375,812]]) {
    const cleanup=[], responses=[], failures=[],providerIds=new Set();
    let bytes=0,providerBytes=0;
    const b=await browser({after:fn=>cleanup.push(fn)},m=>{
      if(m.method==='Network.responseReceived' && m.params.response.url.startsWith('https://')){
        providerIds.add(m.params.requestId);
        responses.push({host:new URL(m.params.response.url).host,status:m.params.response.status});
      }
      if(m.method==='Network.loadingFinished'){
        bytes+=m.params.encodedDataLength;
        if(providerIds.has(m.params.requestId))providerBytes+=m.params.encodedDataLength;
      }
      if(m.method==='Network.loadingFailed')failures.push(m.params.errorText);
    });
    try {
      await b.cmd('Page.enable');await b.cmd('Network.enable');
      // Observe the actual SDK instance, without replacing map behavior,
      // network results, proof, animation timing or route geometry.
      await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
        Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
          Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
          gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
        }});`});
      await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await b.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/prototypes/rider-first/`});
      await until(()=>b.js(`!document.getElementById('fly').disabled`));
      assert.equal(responses.length,0);
      await b.js(`document.getElementById('fly').click()`);
      for(let i=0;i<34;i++){
        if(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok ||
          document.getElementById('terrain-status').textContent.includes('unavailable')`))break;
        await sleep(500);
      }
      assert.equal(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok`),true,
        'Live provider must actually qualify; unavailable is a block, not a pass');
      const traversalMs=await steadyTraversal(b);
      await b.js(`(()=>{
        const terrain=document.getElementById('terrain');
        const p=window.fullProbe={frames:0,hidden:0,fallback:0,valid:0,invalid:0,
          maxYawStep:0,maxYawRate:0,minPitch:90,maxPitch:0,maxRequests:0,checkpoints:[],transitions:[],
          maxInverseM:0,inverseOver8Frames:0,approximatePickVisible:0,maxDepthGap:-1};
        let lastBearing,lastDistance,lastTime,lastStatus,lastCheckpoint=-1;
        const angle=(a,b)=>((b-a+540)%360+360)%360-180;
        observedTerrain.on('render',()=>{
          const now=performance.now(),bearing=observedTerrain.getBearing(),pitch=observedTerrain.getPitch();
          if(!terrain.dataset.distance)return;
          const distance=Number(terrain.dataset.distance);
          const gps=observedTerrain.getCenter(),proof=JSON.parse(terrain.dataset.frame||'{}');
          const inverse=gps.distanceTo(observedTerrain.unproject(observedTerrain.project(gps)));
          p.maxInverseM=Math.max(p.maxInverseM,inverse);
          if(inverse>8){p.inverseOver8Frames++;if(proof.ok)p.approximatePickVisible++;}
          if(Number.isFinite(proof.depthGap))p.maxDepthGap=Math.max(p.maxDepthGap,proof.depthGap);
          if(lastBearing!==undefined && distance!==lastDistance){
            const step=Math.abs(angle(lastBearing,bearing));
            p.maxYawStep=Math.max(p.maxYawStep,step);
            p.maxYawRate=Math.max(p.maxYawRate,step/((now-lastTime)/1000));
          }
          if(distance!==lastDistance){lastBearing=bearing;lastDistance=distance;lastTime=now;}
          p.minPitch=Math.min(p.minPitch,pitch);p.maxPitch=Math.max(p.maxPitch,pitch);
        });
        const tick=()=>{
          p.frames++;
          const status=document.getElementById('terrain-status').textContent;
          const surface=status.includes('unavailable') ? 'fallback' : 'terrain';
          if(surface!==lastStatus){p.transitions.push({distance:terrain.dataset.distance,surface});lastStatus=surface;}
          if(getComputedStyle(terrain).visibility!=='visible')p.hidden++;
          if(status.includes('unavailable'))p.fallback++;
          const proof=JSON.parse(terrain.dataset.frame||'{}');
          if(proof.ok)p.valid++;else if(proof.ok===false){p.invalid++;p.lastInvalid=proof;}
          p.maxRequests=Math.max(p.maxRequests,Number(terrain.dataset.requests||0));
          const bucket=Math.floor(Number(terrain.dataset.distance)/1000);
          if(terrain.dataset.distance && proof.ok && bucket!==lastCheckpoint){
            p.checkpoints.push({distance:terrain.dataset.distance,proof});lastCheckpoint=bucket;
          }
          p.raf=requestAnimationFrame(tick);
        };tick();
        document.getElementById('play').click();
      })()`);
      const start=Date.now(),captured=new Set();
      let completed=false;
      while(Date.now()-start<traversalMs) {
        await sleep(250);
        const state=await b.js(`({distance:Number(document.getElementById('terrain').dataset.distance),
          fallback:fullProbe.fallback,playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview',
          progress:document.getElementById('seek').value})`);
        assert.equal(state.fallback,0,`${label}: terminal fallback during functioning full-route playback`);
        for(const [name,distance] of [['clearance',12900],['switchbacks',24000],['summit',31600],['descent',37200]]) {
          if(evidence && state.distance>=distance && !captured.has(name)){
            captured.add(name);
            const {data}=await b.cmd('Page.captureScreenshot',{format:'png'});
            await writeFile(resolve(evidence,`${label}-full-${name}.png`),Buffer.from(data,'base64'));
          }
        }
        if(!state.playing && state.progress==='1000'){completed=true;break;}
      }
      // Pause flushes the last throttled snapshot. Wait for its actual render,
      // not a stale proof or the interval between invalidation and repaint.
      await until(()=>b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok===true &&
        JSON.parse(document.getElementById('terrain').dataset.frame||'{}').current`));
      await b.js(`cancelAnimationFrame(fullProbe.raf)`);
      const observation=await b.js(`({...fullProbe,raf:undefined,
        progress:document.getElementById('progress').textContent,
        finalDistance:Number(document.getElementById('terrain').dataset.distance),
        endAligned:observedTerrain.getCenter().distanceTo(mapboxgl.LngLat.convert(
          observedTerrain.getSource('route')._data.geometry.coordinates.at(-1)))<.01,
        finalProof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
        canvases:document.querySelectorAll('#terrain canvas').length})`);
      const result={label,width,height,elapsedMs:Date.now()-start,completed,...observation,
        responses:responses.length,statuses:[...new Set(responses.map(r=>r.host+':'+r.status))],bytes,providerBytes,failures};
      console.log('COMPLETE LIVE GRAPPA:',JSON.stringify({...result,checkpoints:result.checkpoints.length}));
      if(evidence)await writeFile(resolve(evidence,`${label}-full.json`),JSON.stringify(result,null,2)+'\n');
      assert.equal(completed,true,'Actual modeled steady 60× playback must reach the finish');
      assert.equal(observation.hidden,0);
      assert.equal(observation.fallback,0);
      assert.ok(observation.valid>100);
      assert.ok(observation.checkpoints.length>=63);
      assert.equal(observation.finalProof.ok,true);
      assert.equal(observation.endAligned,true,'The final throttled update must still reach the exact source endpoint');
      assert.equal(observation.canvases,1);
      assert.ok(observation.maxYawStep<=3.01,'Follow yaw is bounded even across switchbacks/wrap');
      assert.equal(observation.minPitch,45,'Follow retains its oblique terrain perspective throughout');
      assert.equal(observation.maxPitch,45,'Clearance verification must not alter the selected pitch');
      assert.ok(observation.approximatePickVisible>0,'Actual rendered depth distinguishes the approximate inverse-pick false positive');
      assert.ok(observation.maxRequests<=240);
      assert.deepEqual(failures,[]);
      assert.deepEqual(b.exceptions,[]);
      await b.js(`document.getElementById('back').click()`);
      assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
    } finally {for(const fn of cleanup)await fn();}
  }
});

test('native live map retains terminal provider, GPU-context and request-budget fallback',async t=>{
  const server=await previewServer(0);
  t.after(()=>{server.closeAllConnections();server.close();});
  for(const mode of ['follow','manual']) for(const failure of ['provider','context','budget']) {
    const cleanup=[];
    let requests=0;
    const b=await browser({after:fn=>cleanup.push(fn)},m=>{
      if(m.method==='Network.requestWillBeSent' && m.params.request.url.startsWith('https://'))requests++;
    });
    try {
      await b.cmd('Page.enable');await b.cmd('Network.enable');
      await b.cmd('Network.setCacheDisabled',{cacheDisabled:true});
      await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
        Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
          Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
          gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
        }});`});
      await b.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/prototypes/rider-first/`});
      await until(()=>b.js(`!document.getElementById('fly').disabled`));
      await b.js(`document.getElementById('fly').click()`);
      for(let i=0;i<34;i++){
        if(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok ||
          document.getElementById('terrain-status').textContent.includes('unavailable')`))break;
        await sleep(500);
      }
      assert.equal(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok`),true);
      if(mode==='manual') {
        await offRiderPan(b,800,600);
        await sleep(3500);
        assert.equal(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').mode`),'manual');
        assert.equal(await b.js(`JSON.parse(document.getElementById('terrain').dataset.frame||'{}').ok`),true);
      }
      if(failure==='context') {
        assert.equal(await b.js(`(()=>{
          const extension=observedTerrain.getCanvas().getContext('webgl2')?.getExtension('WEBGL_lose_context') ||
            observedTerrain.getCanvas().getContext('webgl')?.getExtension('WEBGL_lose_context');
          if(!extension)return false;extension.loseContext();return true;
        })()`),true,'Lose the actual GPU context, not a synthetic event');
      } else if(failure==='provider') {
        // A source reload can reuse SDK-cached tiles and is not a network
        // failure. Go offline and explicitly seek to an uncached route region.
        await b.cmd('Network.emulateNetworkConditions',
          {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
        if(mode==='manual') {
          // Keep manual semantics while moving into uncached geography.
          await offRiderPan(b,800,600);
        } else await b.js(`document.getElementById('seek').value=500;
          document.getElementById('seek').dispatchEvent(new Event('input'))`);
      } else {
        // Exercise the real map's configured request hook at its unchanged
        // boundary, without sending 240 wasteful external requests. This is
        // explicitly a boundary injection, not natural budget exhaustion.
        await b.js(`for(let i=Number(document.getElementById('terrain').dataset.requests);i<=240;i++)
          observedTerrain._requestManager.transformRequest('https://example.invalid/budget-boundary','Tile');void 0`);
      }
      await until(()=>b.js(`document.getElementById('terrain-status').textContent.includes('unavailable')`));
      const state=await b.js(`({status:document.getElementById('terrain-status').textContent,
        canvases:document.querySelectorAll('#terrain canvas').length,
        distance:document.getElementById('progress').textContent})`);
      assert.equal(state.canvases,0);
      await sleep(500);
      const settledRequests=requests;
      await sleep(2800);
      assert.equal(requests,settledRequests,'Terminal failure never initiates retries');
      assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
      console.log('NATIVE TERMINAL FALLBACK:',JSON.stringify({mode,failure,...state,requests}));
      await b.js(`document.getElementById('back').click()`);
      assert.deepEqual(b.exceptions,[]);
    } finally {for(const fn of cleanup)await fn();}
  }
});

test('bounded live terrain observation in native Chrome', async t => {
  const server = await previewServer(0);
  t.after(()=>{server.closeAllConnections();server.close();});
  const responses = [];
  const b = await browser(t,m=>{
    if (m.method==='Network.responseReceived' && m.params.response.url.startsWith('https://'))
      responses.push({status:m.params.response.status,host:new URL(m.params.response.url).host});
  });
  await b.cmd('Page.enable');await b.cmd('Network.enable');
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
      Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
      gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
    }});`});
  await b.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await b.cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/prototypes/rider-first/`});
  await until(()=>b.js(`!document.getElementById('fly').disabled`));
  assert.equal(responses.length,0,'No provider before entry');
  await b.js(`document.getElementById('fly').click()`);
  // Wait within one bounded load attempt; do not retry failed provider setup.
  for (let i=0;i<34;i++) {
    if (await b.js(`/Satellite|unavailable/.test(document.getElementById('terrain-status').textContent)`)) break;
    await sleep(500);
  }
  const state = await b.js(`({
    status:document.getElementById('terrain-status').textContent,
    proof:document.getElementById('terrain').dataset.frame || null,
    visible:getComputedStyle(document.getElementById('terrain')).visibility,
    localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)
  })`);
  const evidence = process.env.RIDER_FIRST_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence,{recursive:true});
  const shot = async name => {
    if (!evidence) return;
    const {data} = await b.cmd('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(evidence,name+'.png'),Buffer.from(data,'base64'));
  };
  const settled = async () => {
    for(let i=0;i<34;i++) {
      if(await b.js(`document.getElementById('terrain-status').textContent.includes('unavailable') ||
        JSON.parse(document.getElementById('terrain').dataset.frame || '{}').ok === true`)) return;
      await sleep(500);
    }
    assert.fail('Terrain neither verified nor honestly unavailable within bounded attempt');
  };
  // Observe actual presentation continuously, including style mutations between
  // Node samples. No map input, readiness, proof or browser timing is replaced.
  const installProbe = () => b.js(`(()=>{
    const terrain=document.getElementById('terrain'),player=document.getElementById('player');
    let raf;
    let previousStatus;
    const p=window.presentationProbe={frames:0,hiddenOnline:0,invalid:0,valid:0,hides:0,statusChanges:0,disposed:false};
    const observer=new MutationObserver(records=>{
      for(const [i,r] of records.entries())if(r.oldValue?.includes('visibility: visible') &&
        (records[i+1]?.oldValue ?? terrain.getAttribute('style'))?.includes('visibility: hidden'))p.hides++;
    });
    observer.observe(terrain,{attributes:true,attributeFilter:['style'],attributeOldValue:true});
    function tick(){
      p.frames++;
      if(player.classList.contains('online') && getComputedStyle(terrain).visibility!=='visible')p.hiddenOnline++;
      const proof=JSON.parse(terrain.dataset.frame || '{}');
      if(proof.ok===true)p.valid++;
      if(proof.ok===false){p.invalid++;p.lastInvalid=proof;}
      const status=document.getElementById('terrain-status').textContent;
      if(status!==previousStatus){p.statusChanges++;previousStatus=status;}
      raf=requestAnimationFrame(tick);
    }
    p.stop=()=>{cancelAnimationFrame(raf);observer.disconnect();p.disposed=true;};
    tick();
  })()`);
  await installProbe();
  const observePlayback = async label => {
    const before = await b.js(`parseFloat(document.getElementById('progress').textContent)`);
    await b.js(`document.getElementById('play').click()`);
    await sleep(8000);
    await b.js(`document.getElementById('play').click()`);
    const after = await b.js(`parseFloat(document.getElementById('progress').textContent)`);
    const observed = await b.js(`({
      ...presentationProbe,stop:undefined,status:document.getElementById('terrain-status').textContent,
      requests:document.getElementById('terrain').dataset.requests
    })`);
    console.log(label+' sustained 8s playback:',JSON.stringify({...observed,before,after}));
    assert.ok(after>before,'Actual playback advances during the observation');
    assert.equal(observed.hiddenOnline,0,'Online terrain never reveals the outline between proofs');
    assert.ok(observed.frames>20,'Continuous rendered-frame observation, not one eventual-ready sample');
    assert.ok(observed.hides<=1,'At most one terminal fallback, never repeated surface switching');
    if(observed.status.includes('unavailable')) {
      const count=responses.length;
      await sleep(2800);
      assert.equal(await b.js(`document.getElementById('terrain-status').textContent`),observed.status);
      assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
      assert.equal(responses.length,count,'Terminal terrain stays stopped');
    }
  };
  await shot('desktop-live-provider');
  console.log('LIVE PROVIDER OBSERVATION (not a readiness assertion):',JSON.stringify(state));
  console.log('Provider response statuses:',JSON.stringify([...new Set(responses.map(r=>`${r.host}: ${r.status}`))]));
  if (state.status.startsWith('Satellite')) {
    await observePlayback('desktop start');
    for (const [label,width,height] of [['desktop',1440,900],['phone',375,812]]) {
      await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      if(label==='phone') {
        // A deliberate fresh entry, not an automatic recovery/retry: observe
        // phone terrain from the start even if desktop hit a genuine outage.
        await b.js(`presentationProbe.stop();document.getElementById('back').click();
          document.getElementById('restart').click();document.getElementById('fly').click()`);
        await settled();
        // The visibility observer was stopped for intentional lifecycle changes.
        // Install the same read-only probe for the independent phone entry below.
        await installProbe();
        await observePlayback('phone start');
      }
      await b.js(`document.getElementById('profile-toggle').click();document.getElementById('seek').value=500;document.getElementById('seek').dispatchEvent(new Event('input'))`);
      await settled();
      await b.js(`document.getElementById('profile-toggle').click()`);
      const current = await b.js(`({
        status:document.getElementById('terrain-status').textContent,
        proof:document.getElementById('terrain').dataset.frame,
        progress:document.getElementById('progress').textContent,
        width:document.documentElement.scrollWidth
      })`);
      await shot(label+'-live-summit');
      console.log(label+' paused at halfway after start playback:',JSON.stringify(current));
      assert.equal(current.width,width);
      const creditOverlap = await b.js(`(()=>{
        const a=document.querySelector('.player-credit').getBoundingClientRect();
        return [...document.querySelectorAll('.mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib')].some(el=>{
          const b=el.getBoundingClientRect();
          return b.width && b.height && a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
        });
      })()`);
      assert.equal(creditOverlap,false,'Attribution must not overlap player credit');
      await observePlayback(label+' post-seek');
      if(label==='phone' && !await b.js(`document.getElementById('terrain-status').textContent.includes('unavailable')`)){
        await b.js(`document.getElementById('play').click()`);
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:400});
        await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:400,button:'left',clickCount:1});
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:125,y:400,button:'left',buttons:1});
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:125,y:400,button:'left',clickCount:1});
        await until(()=>b.js(`document.getElementById('play').getAttribute('aria-label')==='Play route preview'`));
        await sleep(500);
        const manual=await b.js(`({center:observedTerrain.getCenter().toArray(),progress:document.getElementById('progress').textContent})`);
        await sleep(500);
        assert.deepEqual(await b.js(`({center:observedTerrain.getCenter().toArray(),progress:document.getElementById('progress').textContent})`),manual,
          'Trusted manual exploration pauses the single clock and is not fought by the camera');
        await b.js(`document.getElementById('restart').click()`);
        await settled();
        assert.equal(await b.js(`observedTerrain.getCenter().distanceTo(mapboxgl.LngLat.convert(
          observedTerrain.getSource('route')._data.geometry.coordinates[0]))<.01`),true);
      }
    }
  }
  await b.js(`presentationProbe.stop();document.getElementById('player-route').value='rwgps-57874121';
    document.getElementById('player-route').dispatchEvent(new Event('change'))`);
  await until(()=>b.js(`!document.getElementById('play').disabled && document.getElementById('route-title').textContent==='D0 Warm-up'`));
  await settled();
  assert.ok(await b.js(`document.querySelectorAll('#terrain canvas').length<=1`));
  await b.js(`document.getElementById('back').click()`);
  assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
  assert.equal(await b.js(`typeof window.kotrDisposeTerrain`),'undefined');
  assert.equal(await b.js(`document.activeElement.id`),'fly');
  await b.js(`document.getElementById('fly').click()`);
  await settled();
  assert.ok(await b.js(`document.querySelectorAll('#terrain canvas').length<=1`));
  await b.js(`document.getElementById('back').click()`);
  assert.equal(await b.js(`typeof window.kotrDisposeTerrain`),'undefined');
  assert.deepEqual(b.exceptions,[]);
});
