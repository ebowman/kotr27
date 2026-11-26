// One continuous public terrain → experiment → private actual → public journey.
// Real public provider tiles; synthetic recording only. Never user's Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';
import { parseGPX } from '../js/local-route-parser.mjs';

// Test-only event observer. A current proof can legitimately be invalidated by
// the next render before a 500ms Node poll. Observe it when it is actually
// current, never relabel a cached stale proof. Runtime gates remain unchanged.
function observeTerrainReady(read,subscribe,emit) {
  let stopped=false;
  const check=()=>{
    if(stopped)return;
    const state=read(),error=state.status.includes('unavailable');
    if(!error&&!(state.online&&state.proof.ok&&state.proof.current))return;
    stopped=true;disconnect();emit({state,error});
  };
  const disconnect=subscribe(check);
  check();
  return ()=>{stopped=true;disconnect();};
}

test('terrain readiness observer: current proof between polls, invalid states, failure and cancellation',()=>{
  let state={online:true,status:'Manual exploration · paused',proof:{ok:true,current:false}};
  const listeners=new Set(),results=[];
  const subscribe=fn=>{listeners.add(fn);return ()=>listeners.delete(fn);};
  const publish=next=>{state=next;for(const listener of [...listeners])listener();};
  const stop=observeTerrainReady(()=>state,subscribe,r=>results.push(r));
  assert.equal(results.length,0);
  publish({...state,proof:{ok:false,current:true}});
  assert.equal(results.length,0,'Current but failed proof is never accepted');
  publish({...state,online:false,proof:{ok:true,current:true}});
  assert.equal(results.length,0,'An offline/fallback view is never accepted as terrain');
  const verified={...state,online:true,proof:{ok:true,current:true,sequence:42}};
  publish(verified);
  publish({...verified,proof:{...verified.proof,current:false}});
  assert.equal(state.proof.current,false,'A later periodic read would miss the verified event');
  assert.deepEqual(results,[{state:verified,error:false}]);
  assert.equal(listeners.size,0);stop();
  observeTerrainReady(()=>({...state,status:'Terrain unavailable · 2D route preview'}),subscribe,r=>results.push(r));
  assert.equal(results.at(-1).error,true);assert.equal(listeners.size,0);
  const cancel=observeTerrainReady(()=>state,subscribe,r=>results.push(r));
  cancel();publish(verified);
  assert.equal(results.length,2,'A disposed wait cannot succeed later');
});

for (const [width,height] of [[1440,900],[375,812]]) {
  test(`integrated packaged Explore ${width}: Grappa, switchbacks, Asolo manual, private actual and public return`,async t=>{
    const tmp=await mkdtemp(join(tmpdir(),'kotr-integrated-'));
    const out=process.env.KOTR_INTEGRATION_BUILD||join(tmp,'public'),cleanup=[];
    let server;
    t.after(async()=>{
      for (const close of cleanup.reverse()) await close();
      server?.closeAllConnections();
      if(server) await new Promise(resolve=>server.close(resolve));
      await rm(tmp,{recursive:true,force:true});
    });
    if(!process.env.KOTR_INTEGRATION_BUILD) await build('.',out);
    const paths=(await readdir(out,{recursive:true})).filter(p=>extname(p));
    const files=new Map(await Promise.all(paths.map(async p=>[p,await readFile(join(out,p))])));
    const requests=[],network=[],nativeSelections=[],networkFailures=[],networkPaths=new Map(),proofWaiters=new Map();
    const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
      '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
    server=createServer((req,res)=>{
      const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
      requests.push({path,method:req.method});
      if(!url.pathname.startsWith('/kotr27/')||!files.has(path))return res.writeHead(404).end();
      res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(files.get(path));
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
    const b=await browser({after:fn=>cleanup.push(fn)},m=>{
      if(m.method==='Network.requestWillBeSent') {
        network.push(m.params.request);
        const url=new URL(m.params.request.url);
        networkPaths.set(m.params.requestId,url.origin+url.pathname);
      }
      if(m.method==='Network.responseReceived'&&m.params.response.status>=400)
        networkFailures.push({at:Date.now(),path:networkPaths.get(m.params.requestId),status:m.params.response.status});
      if(m.method==='Network.loadingFailed')
        networkFailures.push({at:Date.now(),path:networkPaths.get(m.params.requestId),error:m.params.errorText,canceled:m.params.canceled});
      if(m.method==='Runtime.bindingCalled'&&m.params.name==='kotrTestTerrainReady') {
        const reply=JSON.parse(m.params.payload);
        proofWaiters.get(reply.id)?.resolve(reply);
      }
    });
    await b.cmd('Page.enable');await b.cmd('Network.enable');
    await b.cmd('Runtime.addBinding',{name:'kotrTestTerrainReady'});
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.inputTrace=[];
      for(const type of ['mousedown','keydown','keypress','input','change','focusin'])
        document.addEventListener(type,e=>inputTrace.push({
          type,key:e.key,trusted:e.isTrusted,target:e.target.id,focus:document.activeElement?.id,
          value:document.getElementById('playback-rate')?.value,targetValue:e.target.value,
          playerHidden:document.getElementById('player')?.hidden
        }),true);
      const value=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
      Object.defineProperty(HTMLSelectElement.prototype,'value',{...value,set(v){
        if(this.id==='playback-rate')inputTrace.push({type:'value-write',value:v,stack:new Error().stack});
        value.set.call(this,v);
      }});
      window.maps=[];window.providerInputCount=0;
      Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
        Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
        const marker=gl.Marker.prototype.setLngLat;
        gl.Marker.prototype.setLngLat=function(...a){providerInputCount++;return marker.apply(this,a)};
        gl.Map=new Proxy(gl.Map,{construct(T,args){
          const m=new T(...args);maps.push(m);window.map=m;
          for(const key of ['jumpTo','addSource']){
            const fn=m[key];m[key]=function(...a){providerInputCount++;return fn.apply(this,a)};
          }
          const remove=m.remove;m.remove=function(...a){
            window.disposedPublicBounds=this.getBounds().toArray();return remove.apply(this,a);
          };return m;
        }});
      }});`});
    await b.cmd('Page.navigate',{url:base});
    await until(()=>b.js(`!document.getElementById('fly')?.disabled`));
    const external=()=>network.filter(r=>/^https?:/.test(r.url)&&!r.url.startsWith(base));
    assert.equal(external().length,0,'No external request before explicit provider entry');
    const pointer=async(selector,scroll=false,fraction=.5)=>{
      if(scroll)await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      const p=await b.js(`(()=>{
        const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
        return {x:r.x+r.width*${fraction},y:r.y+r.height/2,w:r.width,h:r.height,
          hit:el.contains(document.elementFromPoint(r.x+r.width*${fraction},r.y+r.height/2))};
      })()`);
      assert.ok(p.hit&&p.w>=44&&p.h>=44,JSON.stringify({selector,...p}));
      for(const type of ['mousePressed','mouseReleased'])
        await b.cmd('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1});
    };
    const key=async(key,code=key,windowsVirtualKeyCode)=>{
      for(const type of ['keyDown','keyUp'])await b.cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode});
    };
    const select=async(id,value)=>{
      await b.js('inputTrace=[]');
      const label=await b.js(`(()=>{
        const el=document.getElementById(${JSON.stringify(id)});
        return [...el.options].find(o=>o.value===${JSON.stringify(value)})?.textContent;
      })()`);
      assert.ok(label);
      // The old helper clicked then sent Escape, which the app correctly
      // handles as Back: trusted characters subsequently went to #fly.
      // Focus the closed select without opening/canceling a native popup.
      // Characters below are native input; never assign .value or dispatch change.
      await b.js(`document.getElementById(${JSON.stringify(id)}).focus()`);
      assert.equal(await b.js('document.activeElement.id'),id);
      await sleep(1100);
      for(const char of label.split(' · ')[0])
        await b.cmd('Input.dispatchKeyEvent',{type:'char',text:char});
      const trace=await b.js('inputTrace');
      assert.equal(await b.js(`document.getElementById(${JSON.stringify(id)}).value`),value,JSON.stringify(trace));
      assert.ok(trace.some(e=>e.type==='change'&&e.trusted&&e.target===id&&e.targetValue===value),JSON.stringify(trace));
      assert.equal(await b.js(`document.getElementById('player').hidden`),false);
      nativeSelections.push({id,value,trustedChange:true});
    };
    const stateExpression=`({
      ...document.getElementById('cockpit').dataset,
      comparison:{...document.getElementById('comparison-hud').dataset},
      power:document.getElementById('ride-power').textContent,
      speed:document.getElementById('ride-speed').textContent,
      cadence:document.getElementById('ride-cadence').textContent,
      proof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
      online:document.getElementById('player').classList.contains('online'),
      status:document.getElementById('terrain-status').textContent,
      playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview'
    })`;
    const state=()=>b.js(stateExpression);
    // Read-only public-terrain diagnostics. Observe the actual proof attribute,
    // not invented validity; stop before importing any private geometry.
    await b.js(`(()=>{
      window.terrainProbe={history:[],counts:{currentOK:0,stale:0,failed:0}};
      const el=document.getElementById('terrain');
      window.terrainSnapshot=()=>{
        const p=JSON.parse(el.dataset.frame||'{}'),m=window.map;
        return {at:performance.now(),proof:p,renderSequence:el.dataset.renderSequence,
          status:document.getElementById('terrain-status').textContent,
          online:document.getElementById('player').classList.contains('online'),
          visible:getComputedStyle(el).visibility,focused:document.hasFocus(),hidden:document.hidden,
          map:m&&!m._removed?{moving:m.isMoving(),zooming:m.isZooming(),rotating:m.isRotating(),
            center:m.getCenter().toArray(),bounds:m.getBounds().toArray(),zoom:m.getZoom(),pitch:m.getPitch()}:null};
      };
      const observer=new MutationObserver(()=>{
        const s=terrainSnapshot();
        terrainProbe.counts[s.proof.ok&&s.proof.current?'currentOK':s.proof.ok?'stale':'failed']++;
        terrainProbe.history.push(s);if(terrainProbe.history.length>256)terrainProbe.history.shift();
      });
      observer.observe(el,{attributes:true,attributeFilter:['data-frame']});
      terrainProbe.stop=()=>observer.disconnect();
    })()`);
    let readinessSequence=0;
    const terrainReady=async(label)=>{
      const id=++readinessSequence;label??=`view-${id}`;
      const samples=[await state()],boundary=Date.now(),reply=Promise.withResolvers();
      proofWaiters.set(id,reply);
      let deadline;
      try {
        await b.js(`window.stopProofWait=(${observeTerrainReady.toString()})(
          ()=>${stateExpression},
          check=>{
            const observer=new MutationObserver(check);
            observer.observe(document.getElementById('terrain'),{attributes:true,attributeFilter:['data-frame']});
            observer.observe(document.getElementById('player'),{attributes:true,attributeFilter:['class']});
            observer.observe(document.getElementById('terrain-status'),{childList:true});
            return ()=>observer.disconnect();
          },
          result=>kotrTestTerrainReady(JSON.stringify({id:${id},...result,observedAt:performance.now()}))
        )`);
        const result=await Promise.race([reply.promise,new Promise((_,reject)=>{
          deadline=setTimeout(()=>reject(Error('Real provider terrain never obtained current proof')),17000);
        })]);
        assert.ok(!result.error,JSON.stringify(result.state));
        assert.ok(result.state.online&&result.state.proof.ok&&result.state.proof.current);
        assert.equal(result.state.proof.distanceM,Number(result.state.distance));
        if(label==='asolo-post-pan')t.diagnostic(JSON.stringify({label,waitMs:Date.now()-boundary,
          observedAt:result.observedAt,proof:result.state.proof}));
        return result.state;
      } catch(error) {
        const diagnostic={width,label,samples,
          final:await b.js('terrainSnapshot()'),
          trace:await b.js('({history:terrainProbe.history,counts:terrainProbe.counts})'),
          networkFailures:networkFailures.filter(e=>e.at>=boundary-2500)};
        t.diagnostic(`Terrain readiness failure: ${JSON.stringify(diagnostic)}`);
        await screenshot(`terrain-timeout-${label}`);
        throw error;
      } finally {
        clearTimeout(deadline);proofWaiters.delete(id);
        await b.js('window.stopProofWait?.()');
      }
    };
    const screenshot=async(name)=>{
      if(!process.env.RIDE_EXPLORER_EVIDENCE_DIR)return;
      await mkdir(process.env.RIDE_EXPLORER_EVIDENCE_DIR,{recursive:true});
      const {data}=await b.cmd('Page.captureScreenshot',{format:'png'});
      await writeFile(join(process.env.RIDE_EXPLORER_EVIDENCE_DIR,`integrated-${width}-${name}.png`),Buffer.from(data,'base64'));
    };
    await pointer('#fly');await terrainReady();
    await select('playback-rate','4');await select('playback-rate','16');
    await pointer('#profile-toggle');await pointer('#main-climb',true);
    await pointer('#pin-baseline',true);await pointer('#profile-close',true);
    await pointer('#return-rider');await terrainReady();
    assert.equal(Number((await state()).distance),10750);
    await pointer('#play');await until(async()=>Number((await state()).seconds)>5);
    assert.ok(Math.abs(Number((await state()).comparison.distanceDelta))<.02);
    await pointer('[data-effort="0.9"]');
    await until(async()=>Number((await state()).comparison.distanceDelta)>2);
    // Measure changing rendered centers/poses, not RAF alone. Retain all
    // samples in memory; report only public aggregate motion evidence.
    await b.js(`(()=>{
      window.motion={poses:[],hidden:0,mismatch:0,status:0};let previous;
      const observer=new MutationObserver(r=>motion.status+=r.length);
      observer.observe(document.getElementById('terrain-status'),{childList:true});
      const sample=()=>{
        const el=document.getElementById('terrain'),pose=el.dataset.pose;
        if(pose&&pose!==previous){
          const c=map.getCenter();motion.poses.push({at:performance.now(),center:[c.lng,c.lat],yaw:map.getBearing()});previous=pose;
        }
        if(getComputedStyle(el).visibility!=='visible')motion.hidden++;
        if(Number(el.dataset.distance)!==Number(document.getElementById('cockpit').dataset.distance))motion.mismatch++;
      };
      map.on('render',sample);motion.stop=()=>{map.off('render',sample);observer.disconnect()};
    })()`);
    await sleep(30000);
    assert.equal((await state()).playing,true);
    const motion=await b.js(`motion.stop();({...motion,stop:undefined})`);
    await pointer('#play');await terrainReady();
    const intervals=motion.poses.slice(1).map((p,i)=>p.at-motion.poses[i].at).sort((a,b)=>a-b);
    const measurement={poses:motion.poses.length,median:intervals[Math.floor(intervals.length*.5)],
      p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1),
      holds200:intervals.filter(n=>n>=200).length,hidden:motion.hidden,mismatch:motion.mismatch,status:motion.status};
    assert.ok(measurement.poses>900&&measurement.p95<=50);
    assert.equal(measurement.holds200,0);assert.equal(measurement.hidden,0);
    assert.equal(measurement.mismatch,0);assert.equal(measurement.status,0);
    assert.notDeepEqual(motion.poses[0].center,motion.poses.at(-1).center);
    const hard=await state();
    assert.ok(Number(hard.comparison.distanceDelta)>2&&Number(hard.comparison.arrivalDelta)<0&&Number(hard.comparison.workDelta)>0);
    await screenshot('grappa-ghost');
    const spatial=await b.js(`document.querySelector('.player-bottom').getBoundingClientRect().top-
      document.querySelector('.player-status').getBoundingClientRect().bottom`);
    assert.ok(spatial>=height/2);
    await pointer('#gear-easier');await pointer('#play');
    await until(async()=>(await state()).cadence!==hard.cadence);await pointer('#play');
    assert.equal((await state()).speed,hard.speed);
    const beforeRate=await state();await select('playback-rate','4');
    assert.equal((await state()).speed,beforeRate.speed);assert.equal((await state()).seconds,beforeRate.seconds);
    await select('playback-rate','16');
    await pointer('#coast');await pointer('#play');
    await until(async()=>(await state()).motion==='stalled');
    const stalled=await state();await sleep(300);
    assert.equal((await state()).distance,stalled.distance);assert.equal(stalled.power,'0 W');
    await pointer('[data-effort="0.75"]');
    await until(async()=>Number((await state()).distance)>Number(stalled.distance));await pointer('#play');
    // Real pointer profile seek, then a late climbing/switchback segment.
    await pointer('#profile-toggle');await pointer('#player-profile',true);
    await key('ArrowRight','ArrowRight',39);
    assert.equal((await state()).playing,false);
    await screenshot('grappa-profile');
    await pointer('#seek',true,.28);
    assert.ok(Number((await state()).distance)>16000&&Number((await state()).distance)<19000);
    await pointer('#profile-close',true);
    assert.equal((await terrainReady()).proof.mode,'follow','Profile seek already returns to Follow');
    assert.equal(await b.js('map.getPitch()'),45);
    await pointer('#play');await sleep(5000);await pointer('#play');await terrainReady();
    await screenshot('grappa-switchbacks');
    // Asolo must retain manual pan/scroll and paused Return, not reuse Grappa.
    await select('player-route','rwgps-57873112');
    await until(()=>b.js(`!document.getElementById('fly').disabled`));await terrainReady();
    await pointer('#profile-toggle');await pointer('#main-climb',true);await pointer('#profile-close',true);
    await pointer('#return-rider');await terrainReady();
    assert.notEqual(Number((await state()).distance),10750);
    await pointer('#play');await sleep(300);
    const y=height*.4;
    t.diagnostic(JSON.stringify(await b.js(`({
      asoloBeforePan:terrainSnapshot(),
      nativePanStartHit:(()=>{const el=document.elementFromPoint(${width*.4},${y});
        return {tag:el?.tagName,id:el?.id,canvas:el===map.getCanvas()};})(),
      nativePanEndHit:(()=>{const el=document.elementFromPoint(${width*.72},${y});
        return {tag:el?.tagName,id:el?.id,canvas:el===map.getCanvas()};})()
    })`)));
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:width*.4,y,button:'left',buttons:1,clickCount:1});
    for(let i=1;i<=8;i++){
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:width*(.4+i*.04),y,button:'left',buttons:1});
      await sleep(40);
    }
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:width*.72,y,button:'left',clickCount:1});
    await sleep(2000);const manual=await terrainReady('asolo-post-pan');
    assert.equal(manual.proof.mode,'manual');assert.equal(manual.playing,false);
    const zoom=await b.js('map.getZoom()');
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y,deltaX:0,deltaY:-100});
    await sleep(2000);await terrainReady();assert.notEqual(await b.js('map.getZoom()'),zoom);
    await pointer('#return-rider');const returned=await terrainReady();
    assert.equal(returned.proof.mode,'follow');assert.equal(returned.distance,manual.distance);assert.equal(returned.playing,false);
    await screenshot('asolo-return');
    t.diagnostic(JSON.stringify(await b.js(`({asoloAfterReturn:terrainSnapshot(),proofCounts:terrainProbe.counts})`)));
    await b.js('terrainProbe.stop()');
    // Relive uses invented timestamps/sensors on public geometry, not an actual
    // person's file. Capture a recognizable route shape rather than a straight line.
    const {pack}=await readRoutePack('.');
    const route=pack.catalog.routes.find(r=>r.id==='rwgps-57873019');
    const analysis=await loadRouteAnalysis({pack,routeId:route.id,revisionId:route.currentRevisionId,readAsset:p=>readFile(p)});
    const points=analysis.points.filter((_,i)=>i%20===0).slice(0,40);
    const gpx='<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1"><trk><name>Invented integration recording</name><trkseg>'+
      points.map((p,i)=>`<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.elevationM}</ele>`+
        `<time>${new Date(Date.UTC(2026,0,1)+(i+(i>=20?40:0))*1000).toISOString()}</time>`+
        `<extensions><t:TrackPointExtension><t:power>${100+i}</t:power><t:cad>${80+i}</t:cad><t:speed>8</t:speed></t:TrackPointExtension></extensions></trkpt>`).join('')+
      '</trkseg></trk></gpx>';
    assert.equal(parseGPX(Buffer.from(gpx)).kind,'recording','Synthetic fixture must obey the unchanged parser contract');
    const file=join(tmp,'invented-integration.gpx');await writeFile(file,gpx);
    await pointer('#tools-toggle');await pointer('#relive-entry',true);
    await until(()=>b.js(`document.getElementById('terrain').children.length===0`));
    const boundary=network.length,providerInputs=await b.js('providerInputCount'),mapCount=await b.js('maps.length');
    await b.js(`document.getElementById('relive-library').open=true`);
    await b.cmd('DOM.enable');const {root}=await b.cmd('DOM.getDocument');
    const {nodeId}=await b.cmd('DOM.querySelector',{nodeId:root.nodeId,selector:'#local-file'});
    await b.cmd('DOM.setFileInputFiles',{nodeId,files:[file]});
    await until(()=>b.js(`!document.getElementById('local-file').disabled && document.getElementById('cockpit').dataset.exact==='true'`));
    assert.equal((await state()).power,'100 W');
    await pointer('#relive-next',true);assert.equal((await state()).power,'101 W');
    await pointer('#tools-close');await screenshot('private-actual');
    await pointer('#play');await sleep(300);await pointer('#play');
    assert.equal((await state()).power,'— W','Fractional source time does not forward-fill sensors');
    await pointer('#tools-toggle');await pointer('#relive-next',true);
    assert.equal((await state()).power,'102 W');
    await b.js(`document.documentElement.style.fontSize='200%'`);
    await pointer('#relive-next',true);await screenshot('text-200');
    await pointer('#tools-close');assert.equal(await b.js('document.documentElement.scrollWidth>innerWidth'),false);
    await pointer('#play');await pointer('#play');
    await b.js(`document.documentElement.style.fontSize=''`);
    await pointer('#tools-toggle');await pointer('#relive-public',true);
    await until(()=>b.js(`document.getElementById('ride-mode').value==='experiment' && !document.getElementById('fly').disabled`));
    assert.equal(await b.js('providerInputCount'),providerInputs);
    assert.equal(await b.js('maps.length'),mapCount);
    assert.equal(await b.js(`document.getElementById('relive-source').textContent`),'');
    const after=network.slice(boundary),wire=JSON.stringify(after);
    for(const sentinel of ['Invented integration recording','invented-integration.gpx','2026-01-01T','powerW','user:'])
      assert.ok(!wire.includes(sentinel),sentinel);
    const queued=after.filter(r=>/^https?:/.test(r.url)&&!r.url.startsWith(base));
    const bounds=await b.js('disposedPublicBounds');
    const tile=([lon,lat],z)=>[(lon+180)/360*2**z,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z];
    for(const r of queued){
      const url=new URL(r.url),match=/^\/v4\/mapbox\.satellite\/(\d+)\/(\d+)\/(\d+)\.webp$/.exec(url.pathname);
      assert.equal(url.origin,'https://api.mapbox.com');assert.ok(match);assert.equal(r.method,'GET');assert.ok(!r.postData);
      const [z,x,y]=match.slice(1).map(Number),[west,south]=tile(bounds[0],z),[east,north]=tile(bounds[1],z);
      assert.ok(x>=Math.floor(west)-1&&x<=Math.floor(east)+1&&y>=Math.floor(north)-1&&y<=Math.floor(south)+1);
    }
    await pointer('#tools-close');await screenshot('public-return');await pointer('#back');
    assert.deepEqual(b.exceptions,[]);
    // Browser must actually fetch the dynamically selected parser/worker graph.
    for(const module of ['ride-simulation','ride-comparison','ride-insights','ride-relive','local-route-import','local-route-worker','local-route-parser'])
      assert.ok(requests.some(r=>new RegExp(`^js/${module}\\.[a-f0-9]{24}\\.mjs$`).test(r.path)),module);
    t.diagnostic(JSON.stringify({width,height,cpu:cpus()[0].model,browser:await b.cmd('Browser.getVersion'),
      release:JSON.parse(files.get('offline-release.json')).release,spatial,motion:measurement,
      hard:{speed:hard.speed,power:hard.power,cadence:hard.cadence,comparison:hard.comparison},
      asoloManual:manual.proof.mode,asoloReturn:returned.proof.mode,
      privateProviderInputs:0,queuedPublicTiles:queued.length,requests:requests.length,nativeSelections}));
  });
}
