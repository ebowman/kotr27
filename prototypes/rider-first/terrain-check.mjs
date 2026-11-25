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
  await shot('desktop-live-provider');
  console.log('LIVE PROVIDER OBSERVATION (not a readiness assertion):',JSON.stringify(state));
  console.log('Provider response statuses:',JSON.stringify([...new Set(responses.map(r=>`${r.host}: ${r.status}`))]));
  if (state.status.startsWith('Satellite')) {
    await b.js(`document.getElementById('profile-toggle').click();document.getElementById('seek').value=500;document.getElementById('seek').dispatchEvent(new Event('input'))`);
    await sleep(2200);
    await b.js(`document.getElementById('profile-toggle').click();document.getElementById('play').click()`);
    await sleep(1500);
    await b.js(`document.getElementById('play').click()`);
    for (const [label,width,height] of [['desktop',1440,900],['phone',375,812]]) {
      await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await sleep(800);
      const current = await b.js(`({
        status:document.getElementById('terrain-status').textContent,
        proof:document.getElementById('terrain').dataset.frame,
        progress:document.getElementById('progress').textContent,
        width:document.documentElement.scrollWidth
      })`);
      await shot(label+'-live-summit');
      console.log(label+' after seek/play/pause:',JSON.stringify(current));
      assert.equal(current.width,width);
      const creditOverlap = await b.js(`(()=>{
        const a=document.querySelector('.player-credit').getBoundingClientRect();
        return [...document.querySelectorAll('.mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib')].some(el=>{
          const b=el.getBoundingClientRect();
          return b.width && b.height && a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
        });
      })()`);
      assert.equal(creditOverlap,false,'Attribution must not overlap player credit');
    }
  }
  assert.deepEqual(b.exceptions,[]);
});
