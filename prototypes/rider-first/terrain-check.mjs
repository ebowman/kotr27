// Intentional live-provider observation, not an assertion that imagery will work
// on loopback. No substitutes, provider interception, credentials changes or retries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { browser, until } from '../../tests/browser.mjs';
import { previewServer } from './serve.mjs';

test('bounded live terrain observation in native Chrome', async t => {
  const server = await previewServer(0);
  t.after(()=>{server.closeAllConnections();server.close();});
  const responses = [];
  const b = await browser(t,m=>{
    if (m.method==='Network.responseReceived' && m.params.response.url.startsWith('https://'))
      responses.push({status:m.params.response.status,host:new URL(m.params.response.url).host});
  });
  await b.cmd('Page.enable');await b.cmd('Network.enable');
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
