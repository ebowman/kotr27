import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';

for (const width of [320,375,1280]) test(`packaged shell ${width}px: no-map, history, focus, recovery and legacy links`, async t => {
  const tmp = await mkdtemp(join(tmpdir(),'kotr-shell-'));
  t.after(() => rm(tmp,{recursive:true,force:true}));
  const out = join(tmp,'public');
  await build(fileURLToPath(new URL('../',import.meta.url)),out);
  const files = await readdir(out,{recursive:true});
  const types = {'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.gpx':'application/xml'};
  let profileGate = Promise.withResolvers(), profileRequests = 0;
  t.after(() => profileGate.resolve());
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    const file = url.pathname.slice('/kotr27/'.length) || 'index.html';
    if (!url.pathname.startsWith('/kotr27/') || !files.includes(file) || !types[extname(file)])
      return res.writeHead(404).end();
    if (file.endsWith('.gpx')) {
      profileRequests++;
      await profileGate.promise;
    }
    // Never serve provisioned configuration in tests.
    const bytes = file.startsWith('js/config.') ? 'window.KOTR_CONFIG = {};' : await readFile(join(out,file));
    res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store'}).end(bytes);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/kotr27/`;
  const requests = [];
  const {cmd,js,exceptions} = await browser(t,m => {
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs',{urls:['https://*']});
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
  await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const ready = () => until(() => js(`document.querySelector('#site-shell')?.dataset.ready === 'true' &&
    document.querySelector('#site-content')?.getAttribute('aria-busy') === 'false' &&
    document.querySelector('#site-selection')?.textContent.includes('semonzo-example-v1')`));
  const key = async (key,code,n) => {
    for (const type of ['keyDown','keyUp']) await cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,
      ...(key === 'Enter' && type === 'keyDown' && {text:'\r'})});
  };
  await cmd('Page.navigate',{url:base});
  await until(() => js(`!!document.querySelector('.site-nav a:nth-child(2)')`));
  assert.ok(await js(`climb.hidden && !document.querySelector('#map canvas')`));
  assert.match(await js('document.body.innerText'),/awaiting verification\/publication approval/i);
  assert.equal(await js(`document.querySelectorAll('h1').length`),1);
  assert.ok(!requests.some(u => /mapbox|terrain|flyover|config/.test(u)));
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  await js(`document.querySelector('.site-nav a:nth-child(2)').focus()`);
  assert.match(await js(`document.getElementById('site-notice').textContent`),/Loading selected profile/);
  profileGate.resolve();
  await ready();
  assert.equal(await js(`document.activeElement.textContent`),'Explore','profile completion preserves keyboard focus');
  await key('Enter','Enter',13);
  await until(() => js(`!!document.querySelector('#site-chapters a')`));
  assert.equal(await js('document.activeElement.id'),'site-heading');
  assert.ok(await js(`document.getElementById('legacy-explorer').hidden`),'briefing before ride clock');
  await js(`document.querySelector('#site-chapters li:nth-child(3) a').focus()`);
  await key('Enter','Enter',13);
  assert.equal(await js('document.activeElement.id'),'site-heading');
  const chapterURL = await js('location.href');
  assert.match(chapterURL,/chapter=high-step/);
  assert.match(chapterURL,/rev=semonzo-example-v1/);
  assert.match(await js(`document.querySelector('#site-content').textContent`),/11.0 km selected/);
  // Destination headings render before async GPX completion applies navigation
  // focus. Hold that response to prove heading text alone is not readiness.
  profileGate = Promise.withResolvers();
  const beforePrepare = profileRequests;
  await js(`document.querySelector('.site-nav a:nth-child(3)').click()`);
  await until(() => js(`document.querySelector('#site-heading')?.textContent === 'Prepare for the ride'`));
  await until(() => profileRequests > beforePrepare);
  const preferences = files.find(file => file.startsWith('js/preferences-view.'));
  const reviewed = await cmd('Runtime.evaluate', {expression:
    `import('./${preferences}').then(async m=>{await m.riderState.ready;return m.riderState.snapshot();})`,
    awaitPromise:true, returnByValue:true});
  assert.ok(!reviewed.exceptionDetails);
  assert.deepEqual(reviewed.result.value.consent, {rider:false, preferences:false});
  assert.equal(reviewed.result.value.validation.kind, 'example');
  assert.equal(await js('document.activeElement.tagName'),'BODY');
  assert.notEqual(await js(`document.querySelector('#site-shell').dataset.ready`),'true');
  assert.equal(await js(`document.querySelector('#site-content').getAttribute('aria-busy')`),'true');
  profileGate.resolve();
  await ready();
  assert.match(await js('location.href'),/chapter=high-step/);
  assert.equal(await js('document.activeElement.id'),'site-heading');
  assert.match(await js('document.body.innerText'),/not yet available/);
  await js(`document.querySelector('.site-nav a:nth-child(4)').click()`);
  await until(() => js(`document.querySelector('.site-nav a:nth-child(4)')?.getAttribute('aria-current') === 'page'`));
  await ready();
  assert.match(await js('location.href'),/chapter=high-step/);
  assert.match(await js('document.body.innerText'),/no “today” or “tomorrow”/);
  await js('history.back()');
  await until(() => js(`document.querySelector('#site-heading')?.textContent === 'Prepare for the ride'`));
  await ready();
  await js('history.back()');
  await until(() => js(`location.href === ${JSON.stringify(chapterURL)} && !!document.querySelector('#site-chapters a[aria-current]')`));
  await js('history.forward()');
  await until(() => js(`document.querySelector('#site-heading')?.textContent === 'Prepare for the ride'`));
  await ready();
  await cmd('Page.reload');
  await ready();
  assert.match(await js('location.href'),/chapter=high-step/);
  for (const area of [1,2,3,4]) {
    await js(`document.querySelector('.site-nav a:nth-child(${area})').click()`);
    await until(() => js(`document.querySelector('.site-nav a:nth-child(${area})')?.getAttribute('aria-current') === 'page'`));
    await ready();
    assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
    await js(`document.documentElement.style.fontSize='200%'`);
    assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`),'200% text enlargement retains wrapping');
    await js(`document.documentElement.style.fontSize=''`);
  }
  assert.ok(!requests.some(u => /mapbox|terrain|flyover|config/.test(u)));
  await cmd('Page.navigate',{url:base+'explore.html?route=semonzo-example&rev=missing&view=clock'});
  await until(() => js(`document.querySelector('#site-notice')?.textContent.includes('revision unavailable')`));
  assert.ok(await js(`document.getElementById('legacy-explorer').hidden`));
  await js(`document.querySelector('#site-recovery button:last-child').click()`);
  assert.equal(await js('document.activeElement.id'),'site-revision');
  await js(`document.getElementById('site-revision').value='semonzo-example-v1'; document.getElementById('site-revision').dispatchEvent(new Event('change'))`);
  await until(() => js(`!!document.querySelector('#site-chapters a')`));
  assert.match(await js('location.href'),/rev=semonzo-example-v1/);
  await cmd('Page.navigate',{url:base+'explore.html?route=semonzo-example&rev=deleted%2Frevision&view=briefing&ftp=300&weight=80&token=secret'});
  await until(() => js(`document.querySelector('#site-notice')?.textContent.includes('revision unavailable or invalid')`));
  const blockedRequests = requests.length;
  for (const area of [3,4,1,2]) {
    assert.ok(await js(`[...document.querySelectorAll('.site-nav a')].every(a => !/deleted|%2F|ftp|weight|token|secret/i.test(a.href))`));
    await js(`document.querySelector('.site-nav a:nth-child(${area})').focus()`);
    await key('Enter','Enter',13);
    await until(() => js(`document.querySelector('.site-nav a:nth-child(${area})')?.getAttribute('aria-current') === 'page' &&
      document.querySelector('#site-shell')?.dataset.ready === 'true' &&
      document.querySelector('#site-notice')?.textContent.includes('revision unavailable or invalid')`));
    assert.equal(await js('document.activeElement.id'),'site-heading');
    assert.equal(await js(`new URL(location.href).searchParams.get('rev')`),'');
    assert.ok(await js(`document.getElementById('legacy-explorer')?.hidden !== false && !document.querySelector('#site-chapters a')`));
    assert.doesNotMatch(await js('location.href'),/deleted|%2F|ftp|weight|token|secret/i);
  }
  for (const [direction,area] of [['back',1],['forward',2]]) {
    await js(`history.${direction}()`);
    await until(() => js(`document.querySelector('.site-nav a:nth-child(${area})')?.getAttribute('aria-current') === 'page' &&
      document.querySelector('#site-notice')?.textContent.includes('revision unavailable or invalid')`));
    assert.ok(await js(`!document.querySelector('#site-chapters a') &&
      new URL(location.href).searchParams.get('rev') === ''`));
  }
  await cmd('Page.reload');
  await until(() => js(`document.querySelector('#site-notice')?.textContent.includes('revision unavailable or invalid')`));
  assert.ok(requests.slice(blockedRequests).every(u => !/deleted|private|secret/i.test(new URL(u).pathname)));
  await js(`document.querySelector('#site-recovery button:last-child').click()`);
  assert.equal(await js('document.activeElement.id'),'site-revision');
  await js(`document.getElementById('site-revision').value='semonzo-example-v1'; document.getElementById('site-revision').dispatchEvent(new Event('change'))`);
  await until(() => js(`!!document.querySelector('#site-chapters a')`));
  assert.match(await js('location.href'),/rev=semonzo-example-v1/);
  assert.equal(await js(`document.getElementById('site-notice').textContent`),'');
  await cmd('Page.navigate',{url:base+'explore.html?route=removed&rev=old'});
  await until(() => js(`document.querySelector('#site-notice')?.textContent.includes('route not found')`));
  assert.ok(await js(`document.getElementById('legacy-explorer').hidden`));
  await cmd('Page.navigate',{url:base+'explore.html#sensitivity'});
  await until(() => js(`document.querySelector('#sensitivity-content')?.hidden === false`));
  assert.ok(await js(`sensitivity.open && !document.getElementById('legacy-explorer').hidden && document.getElementById('sensitivity-effort').value === '80'`));
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth && document.getAnimations().length === 0`));
  await cmd('Page.navigate',{url:base+'index.html#seek-9000'});
  await until(() => js(`document.querySelector('#deck')?.hidden === false`));
  assert.equal(await js('seek.value'),'9000');
  assert.match(await js('document.body.innerText'),/example/);
  await until(() => js(`document.querySelector('#message')?.textContent.includes('unavailable')`));
  assert.ok(await js(`!climb.hidden && !!document.querySelector('#site-profile') && play.disabled`));
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  const legacySelection = await js(`({url:location.href, distance:seek.value,
    selection:document.getElementById('site-selection').textContent,
    area:document.querySelector('.site-nav a[aria-current]').textContent,
    history:history.length})`);
  await js(`document.querySelector('.skip').focus()`);
  await key('Enter','Enter',13);
  assert.equal(await js('document.activeElement.id'),'site-heading');
  assert.deepEqual(await js(`({url:location.href, distance:seek.value,
    selection:document.getElementById('site-selection').textContent,
    area:document.querySelector('.site-nav a[aria-current]').textContent,
    history:history.length})`),legacySelection);
  assert.ok(await js(`!climb.hidden && document.querySelector('.skip').getAttribute('href') === '#site-heading'`));
  // Source fallback remains a native focusable anchor destination without JS.
  for (const entry of ['index.html','explore.html']) {
    const html = await readFile(join(out,entry),'utf8');
    assert.match(html,/<a class="skip" href="#site-heading">/);
    assert.match(html,/<h1 id="site-heading" tabindex="-1">/);
  }
  const historyLength = await js('history.length');
  await js(`seek.focus(); seek.value=11000; seek.dispatchEvent(new Event('input'))`);
  assert.equal(await js('document.activeElement.id'),'seek');
  assert.equal(await js('history.length'),historyLength,'continuous seek replaces history');
  assert.match(await js('location.href'),/at=11000/);
  assert.doesNotMatch(await js('location.href'),/ftp|weight|token|filename/);
  await cmd('Page.navigate',{url:base+'index.html#seek-bad'});
  await until(() => js(`document.querySelector('#site-notice')?.textContent.includes('legacy section link is invalid')`));
  assert.ok(await js(`climb.hidden`));
  assert.deepEqual(exceptions,[]);
  t.diagnostic('Packaged navigation, pinned links, back/forward/reload, no-map first visit, reduced motion, keyboard focus, legacy seek/sensitivity: PASS');
});
