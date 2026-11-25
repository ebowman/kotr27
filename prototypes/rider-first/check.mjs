// Real installed Chrome + CDP. Not MCP, and not a provider-imagery qualification.
// Only the deliberate failure test intercepts the external provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { get } from 'node:http';
import { browser, until } from '../../tests/browser.mjs';
import { previewServer } from './serve.mjs';

test('isolated rider-first preview: native Chrome desktop and phone', async t => {
  const server = await previewServer(0);
  t.after(() => {server.closeAllConnections();server.close();});
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/.private/','/AGENTS.md','/index.html','/js/site-shell.mjs',
    '/prototypes/rider-first/serve.mjs','/prototypes/rider-first/check.mjs','/docs/rider-first-design.md',
    '/worktrees/','/assets/semonzo.gpx','/prototypes/rider-first/%2e%2e/%2e%2e/.private/']) {
    assert.equal((await fetch(base+path)).status,404,path);
  }
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  const foreignHost = await new Promise((resolve,reject) => {
    get(base+'/',{headers:{Host:'example.com'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);
  });
  assert.equal(foreignHost,403);
  const outside = [], errors = [];
  const b = await browser(t,(m,cmd)=>{
    if (m.method === 'Fetch.requestPaused') {
      outside.push(m.params.request.url);
      void cmd('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(e=>errors.push(String(e)));
    }
  });
  await b.cmd('Page.enable');
  await b.cmd('Fetch.enable',{patterns:[{urlPattern:'https://*'}]});
  const evidence = process.env.RIDER_FIRST_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence,{recursive:true});
  const shot = async name => {
    if (!evidence) return;
    const {data} = await b.cmd('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve(evidence,name+'.png'),Buffer.from(data,'base64'));
  };
  const click = id => b.js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const set = (id,value) => b.js(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change'))`);
  const ready = () => until(()=>b.js(`!document.getElementById('fly').disabled`));
  const layout = () => b.js(`({
    width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
    fly:document.getElementById('fly').getBoundingClientRect().toJSON(),
    title:document.getElementById('route-title').textContent,
    distance:document.getElementById('distance').textContent,
    ascent:document.getElementById('ascent').textContent
  })`);
  const focusVisible = async id => {
    await b.js(`document.getElementById('${id}').focus()`);
    await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert.ok(await b.js(`document.activeElement!==document.body && document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle !== 'none'`));
  };
  const playbackState = () => b.js(`({
    distanceKm:parseFloat(document.getElementById('progress').textContent),
    seek:Number(document.getElementById('seek').value),
    marker:[document.getElementById('outline-rider').getAttribute('cx'),document.getElementById('outline-rider').getAttribute('cy')],
    action:document.getElementById('play').getAttribute('aria-label'),
    visibility:document.visibilityState
  })`);
  const playUntilProgress = async () => {
    const beforePlayback = await playbackState();
    await click('play');
    const started = performance.now(), deadline = started+5000;
    let current, advanced = false;
    do {
      current = await playbackState();
      assert.equal(current.action,'Pause route preview',JSON.stringify(current));
      assert.equal(current.visibility,'visible','Hidden-page pause is not playback progress');
      assert.deepEqual(b.exceptions,[]);
      // RAF delivery is not synchronized to the Node timer. The first frame
      // only initializes the clock; the distance label also rounds to 0.1 km.
      // Require actual movement in all three linked surfaces, not just a label.
      advanced = Number.isFinite(current.distanceKm) &&
        current.distanceKm > beforePlayback.distanceKm && current.seek > beforePlayback.seek &&
        current.marker.some((coordinate,i)=>coordinate !== beforePlayback.marker[i]);
      if (advanced) break;
      await sleep(50);
    } while (performance.now() < deadline);
    assert.ok(advanced && performance.now() <= deadline,
      `Playback did not advance within 5 seconds: ${JSON.stringify({beforePlayback,current})}`);
    return {elapsedMs:Math.round(performance.now()-started),distanceKm:current.distanceKm};
  };
  for (const [label,width,height] of [['desktop',1440,900],['phone',375,812]]) {
    const beforeEntry = outside.length;
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.navigate',{url:base+'/prototypes/rider-first/'});
    await ready();
    const result = await layout();
    assert.equal(result.scrollWidth,width);
    assert.ok(result.fly.bottom < height,`${label} CTA must be in opening viewport: ${JSON.stringify(result)}`);
    assert.equal(result.title,'Monte Grappa');assert.equal(result.distance,'63.2');assert.equal(result.ascent,'1,835');
    assert.equal(outside.length,beforeEntry,'No new provider request before Fly');
    const words = await b.js(`(()=>{
      const walker=document.createTreeWalker(document.getElementById('landing'),NodeFilter.SHOW_TEXT);
      const chunks=[];let n;
      while(n=walker.nextNode()){
        if(n.parentElement.closest('select,script,style,[hidden]'))continue;
        const range=document.createRange();range.selectNode(n);
        const r=range.getBoundingClientRect();
        if(r.width && r.height && r.top>=0 && r.bottom<=innerHeight)chunks.push(n.textContent.trim());
      }
      for(const select of document.querySelectorAll('#landing select'))chunks.push(select.selectedOptions[0]?.textContent||'');
      return chunks.join(' ').trim().split(/\\s+/).length;
    })()`);
    console.log(label+' opening visible tokens: '+words);
    assert.ok(words<=60,`${label} opening copy budget`);
    assert.equal(await b.js('localStorage.length+sessionStorage.length'),0);
    await shot(label+'-landing');
    await b.js(`document.querySelector('#variants [aria-pressed="false"]').click()`);
    await until(()=>b.js(`document.getElementById('route-title').textContent==='Asolo' && !document.getElementById('fly').disabled`));
    assert.equal(await b.js(`document.getElementById('distance').textContent`),'57.6');
    assert.equal(await b.js(`document.activeElement.textContent`),'Standard');
    await b.js(`document.querySelector('#variants [aria-pressed="false"]').click()`);
    await until(()=>b.js(`document.getElementById('route-title').textContent==='Monte Grappa' && !document.getElementById('fly').disabled`));
    await focusVisible('landing-route');
    // Both desktop and phone start paused, regardless of motion preference.
    await click('fly');
    await until(()=>b.js(`document.getElementById('terrain-status').textContent.includes('unavailable')`));
    assert.equal(await b.js(`document.getElementById('player').getBoundingClientRect().height`),height);
    assert.equal(await b.js(`document.activeElement.id`),'back');
    await shot(label+'-player-unavailable');
    await focusVisible('back');
    console.log(label+' observed playback:',await playUntilProgress());
    await click('play');
    const paused = await b.js(`document.getElementById('progress').textContent`);
    await sleep(120);
    assert.equal(await b.js(`document.getElementById('progress').textContent`),paused);
    await click('profile-toggle');
    await b.js(`document.getElementById('seek').value=500;document.getElementById('seek').dispatchEvent(new Event('input'))`);
    assert.match(await b.js(`document.getElementById('position').value`),/^31\.6 km$/);
    await shot(label+'-profile');
    const overlap = await b.js(`(()=>{
      const a=document.getElementById('profile-panel').getBoundingClientRect();
      const b=document.querySelector('.player-header').getBoundingClientRect();
      const c=document.getElementById('terrain-status').getBoundingClientRect();
      return a.top < Math.max(b.bottom,c.bottom);
    })()`);
    assert.equal(overlap,false);
    await set('player-route','rwgps-57873112');await ready();
    assert.equal(await b.js(`document.getElementById('route-title').textContent`),'Asolo');
    assert.equal(await b.js(`document.getElementById('distance').textContent`),'57.6');
    await click('back');
    assert.equal(await b.js(`document.activeElement.id`),'fly');
    await set('landing-route','3');await ready();
    assert.equal(await b.js(`document.getElementById('variants').textContent`),'Standard only');
    assert.equal(await b.js(`document.getElementById('distance').textContent`),'19.7');
    if (label==='phone') await shot('phone-standard-only');
    await b.js(`document.querySelector('[data-dialog="week"]').click()`);
    assert.equal(await b.js(`document.getElementById('info-dialog').open`),true);
    await click('dialog-close');
    assert.equal(await b.js('localStorage.length+sessionStorage.length'),0);
  }
  await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await b.cmd('Page.navigate',{url:base+'/prototypes/rider-first/?terrain=off&layout=long-name'});
  await until(()=>b.js(`document.getElementById('route-title')?.textContent.includes('layout sample')`));
  await ready();
  await b.js('scrollTo(0,0)');
  assert.equal((await layout()).scrollWidth,375);
  assert.ok((await layout()).fly.bottom<812);
  await shot('phone-long-name');
  const requests = outside.length;
  await click('fly');
  await sleep(300);
  assert.equal(await b.js(`document.getElementById('progress').textContent`),'0.0 km');
  assert.equal(await b.js(`document.getElementById('play').getAttribute('aria-label')`),'Play route preview');
  assert.equal(outside.length,requests);
  await shot('phone-reduced-motion-2d');
  for (const [id,name,distance] of [
    ['rwgps-57873112','Asolo','57.6'],['rwgps-57873183','Vicentine Hills','67.0'],
    ['rwgps-57874024','Vicentine Hills','86.7'],['rwgps-57874050','Brentha Valley','53.5'],
    ['rwgps-57874076','Brentha Valley','85.3'],['rwgps-57874121','Warm-up','19.7'],
    ['rwgps-57873019','Monte Grappa','63.2'],
  ]) {
    await set('player-route',id);await ready();
    assert.equal(await b.js(`document.getElementById('distance').textContent`),distance);
    assert.ok(await b.js(`document.getElementById('route-title').textContent.startsWith(${JSON.stringify(name)})`));
  }
  assert.equal(outside.length,requests,'2D route changes never load provider');
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(errors,[]);
  console.log('PASS: 1440×900 / 375×812, real public stats, isolation, consent boundary, play/pause, seek, route changes, Standard-only, long names, reduced motion, focus, no storage writes.');
});
