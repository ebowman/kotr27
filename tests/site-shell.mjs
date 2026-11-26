import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, until } from './browser.mjs';

for (const width of [320,375,1280]) test(`packaged shell ${width}px: explicit choices, history, focus, recovery and retired links`, async t => {
  const tmp = await mkdtemp(join(tmpdir(),'kotr-shell-'));
  let tearingDown=false;
  t.after(() => {tearingDown=true;return rm(tmp,{recursive:true,force:true});});
  const out=join(tmp,'public'), root=fileURLToPath(new URL('../',import.meta.url));
  await build(root,out);
  const {pack}=await readRoutePack(root), route=pack.catalog.routes[0], revision=route.currentRevisionId;
  const files=await readdir(out,{recursive:true});
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.gpx':'application/xml','.json':'application/json'};
  const gate=Promise.withResolvers(); let profileRequests=0;
  t.after(()=>gate.resolve());
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'), file=url.pathname.slice('/kotr27/'.length)||'index.html';
    if(!url.pathname.startsWith('/kotr27/')||!files.includes(file)||!types[extname(file)])
      return res.writeHead(404).end();
    if(file.endsWith('.gpx')) {profileRequests++;await gate.promise;}
    try {
      const bytes=file.startsWith('js/config.')?'window.KOTR_CONFIG = {};':await readFile(join(out,file));
      res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store'}).end(bytes);
    } catch(error) {
      if(!tearingDown||error.code!=='ENOENT')throw error;
      res.writeHead(404).end();
    }
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`, requests=[];
  const {cmd,js,exceptions}=await browser(t,m=>{
    if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);
  });
  await cmd('Page.enable');await cmd('Network.enable');
  await cmd('Network.setBlockedURLs',{urls:['https://*']});
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
  await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const ready=()=>until(()=>js(`document.querySelector('#site-shell')?.dataset.ready==='true' &&
    document.querySelector('#site-content')?.getAttribute('aria-busy')==='false'`));
  const choose=()=>js(`document.getElementById('site-route').value='${route.id}';
    document.getElementById('site-route').dispatchEvent(new Event('change'))`);
  const key=async(key,code,n)=>{
    for(const type of ['keyDown','keyUp'])await cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,
      ...(key==='Enter'&&type==='keyDown'&&{text:'\r'})});
  };
  // The companion is secondary; the root's rider UI has its own acceptance.
  await cmd('Page.navigate',{url:base+'explore.html?area=plan'});
  await until(()=>js(`!!document.querySelector('.site-nav a:nth-child(2)')`));
  await js(`document.querySelector('.site-nav a:nth-child(2)').focus()`);
  gate.resolve();await ready();
  assert.equal(await js('document.activeElement.textContent'),'Explore','catalog completion retains focus');
  assert.equal(await js(`document.querySelectorAll('h1').length`),1);
  assert.equal(await js(`document.getElementById('site-route').value`),'');
  assert.match(await js(`document.getElementById('site-selection').textContent`),/No route opened/);
  await key('Enter','Enter',13);await ready();
  assert.equal(await js('document.activeElement.id'),'site-heading');
  await until(()=>js(`document.getElementById('site-route').options.length===8`));
  assert.deepEqual(await js(`[...document.getElementById('site-route').options].slice(1).map(o=>o.value)`),
    pack.catalog.routes.map(r=>r.id));
  await choose();await ready();
  await until(()=>js(`!document.getElementById('route-briefing').hidden`));
  const selected=await js('location.href');
  assert.match(selected,new RegExp(`rev=${revision}`));
  await until(()=>js(`document.getElementById('trip-planner')?.dataset.ready==='true'`));
  const before=profileRequests;
  for(const area of [3,4,1,2]) {
    await js(`document.querySelector('.site-nav a:nth-child(${area})').click()`);
    await ready();
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
    await js(`document.documentElement.style.fontSize='200%'`);
    assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`),'200% text enlargement wraps');
    await js(`document.documentElement.style.fontSize=''`);
    assert.match(await js('location.href'),new RegExp(`rev=${revision}`));
  }
  assert.equal(profileRequests,before,'area navigation retains verified geometry');
  const finalSelection=await js('location.href');
  await js('history.back()');await until(()=>js(`document.querySelector('.site-nav a[aria-current]').textContent==='Plan'`));
  await js('history.forward()');await until(()=>js(`location.href===${JSON.stringify(finalSelection)}`));
  await cmd('Page.reload');await ready();
  assert.match(await js('location.href'),new RegExp(`rev=${revision}`));
  for(const entry of ['index.html','explore.html']) {
    await cmd('Page.navigate',{url:base+entry+(entry==='index.html'?'?area=plan':'')});await ready();
    assert.equal(await js(`document.getElementById('site-route').value`),'');
    assert.match(await js(`document.getElementById('site-notice').textContent`),/Choose a route explicitly/);
    const html=await readFile(join(out,entry),'utf8');
    if(entry==='explore.html') {
      assert.match(html,/<a class="skip" href="#site-heading">/);
      assert.match(html,/<h1 id="site-heading" tabindex="-1">/);
    } else {
      assert.match(html,/id="landing"/);
      assert.match(html,/Fly this route/);
    }
    assert.doesNotMatch(html,/legacy-explorer|data-flyover-src|Semonzo|id="climb"/);
    for(const suffix of ['?route=semonzo-example&rev=semonzo-example-v1&view=flyover',
      '#seek-9000','#seek-bad','#seek-999999','#seek']) {
      await cmd('Page.navigate',{url:base+entry+suffix});await ready();
      assert.match(await js(`document.getElementById('site-notice').textContent`),/retired/);
      assert.match(await js(`document.getElementById('site-selection').textContent`),/No route opened/);
      assert.ok(await js(`document.getElementById('route-flyover').hidden && document.getElementById('route-pace').hidden`));
      await js(`document.querySelector('#site-recovery button').click()`);
      assert.equal(await js('document.activeElement.id'),'site-route');
      const old=await js('location.href'), history=await js('history.length');
      await js(`document.querySelector('.skip').focus()`);await key('Enter','Enter',13);
      assert.equal(await js('document.activeElement.id'),'site-heading');
      assert.equal(await js('location.href'),old);assert.equal(await js('history.length'),history);
      await choose();await ready();
      assert.match(await js(`document.getElementById('site-selection').textContent`),new RegExp(revision));
    }
  }
  await cmd('Page.navigate',{url:base+`explore.html?route=${route.id}&rev=deleted%2Frevision&ftp=300&token=secret`});
  await ready();
  for(const area of [3,4,1,2]) {
    await js(`document.querySelector('.site-nav a:nth-child(${area})').click()`);await ready();
    assert.match(await js(`document.getElementById('site-notice').textContent`),/revision unavailable or invalid/);
    assert.equal(await js(`new URL(location.href).searchParams.get('rev')`),'');
    assert.doesNotMatch(await js('location.href'),/deleted|%2F|ftp|token|secret/i);
  }
  await cmd('Page.reload');await ready();
  await js(`document.querySelector('#site-recovery button:last-child').click()`);
  assert.equal(await js('document.activeElement.id'),'site-revision');
  await js(`document.getElementById('site-revision').value='${revision}';
    document.getElementById('site-revision').dispatchEvent(new Event('change'))`);
  await ready();assert.equal(await js(`document.getElementById('site-notice').textContent`),'');
  assert.deepEqual(requests.filter(u=>new URL(u).origin!==new URL(base).origin),[]);
  assert.deepEqual(requests.filter(u=>/\/(?:route-terrain-view|terrain|config|flyover|semonzo|example-catalog|rider-controls)\./.test(u)),[]);
  assert.equal(await js(`document.querySelectorAll('canvas').length`),0);
  assert.deepEqual(await js('[localStorage.length,sessionStorage.length,document.cookie]'),[0,0,'']);
  assert.deepEqual(exceptions,[]);
  t.diagnostic('Both entries: seven choices, no default, retired link recovery, revision/privacy/history/focus: PASS');
});
