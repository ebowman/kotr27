import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, startupPageTarget, until } from './browser.mjs';
import { estimateAscent } from '../js/ascent-estimator.mjs';

// Local regression reference only; the browser receives runtime GPX, never JSON.
const profile = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));

test('release rejects restricted catalogs and non-allowlisted assets before writing output', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'kotr-catalog-gate-'));
  t.after(() => rm(tmp, {recursive:true, force:true}));
  const src = join(tmp, 'source');
  await mkdir(join(src, 'js'), {recursive:true});
  await mkdir(join(src, 'assets'));
  for (const file of ['js/route-catalog.mjs','js/example-catalog.mjs','assets/semonzo.gpx'])
    await cp(new URL('../'+file, import.meta.url), join(src,file));
  const file = join(src, 'js/example-catalog.mjs'), original = await readFile(file, 'utf8');
  await writeFile(file, original.replace("redistribution:'approved'", "redistribution:'unknown'"));
  await assert.rejects(build(src, join(tmp, 'denied')), /public catalog requires/);
  await writeFile(file, original.replace("path:'assets/semonzo.gpx'", "path:'assets/unapproved.gpx'"));
  await assert.rejects(build(src, join(tmp, 'unapproved')), /not on public release allowlist/);
  assert.deepEqual(await readdir(tmp), ['source']);
});

test('browser startup selects only the unique command-line blank page', async () => {
  const page = {targetId:'startup',type:'page',url:'about:blank'};
  const ignored = [
    {targetId:'worker',type:'service_worker',url:'about:blank'},
    {targetId:'other-page',type:'page',url:'https://example.invalid/'},
  ];
  let calls = 0;
  assert.equal(await startupPageTarget(async method => {
    assert.equal(method,'Target.getTargets');
    return {targetInfos:++calls === 1 ? ignored : [...ignored,page]};
  }),'startup');
  assert.equal(calls,2);
  await assert.rejects(startupPageTarget(async () => ({
    targetInfos:[page,{...page,targetId:'duplicate'}],
  })),/Ambiguous startup/);
  await assert.rejects(startupPageTarget(async () => ({
    targetInfos:[{...page,targetId:''}],
  })),/no target ID/);
  const failure = Error('discovery failed');
  await assert.rejects(startupPageTarget(async () => { throw failure; }),error=>error===failure);
});

test('ordinary warm Pages URL switches releases; unchanged and failed probes stay put', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'kotr-release-'));
  t.after(() => rm(tmp, {recursive:true, force:true}));
  const src = join(tmp, 'source');
  await mkdir(join(src, 'js'), {recursive:true});
  await cp(new URL('../assets/', import.meta.url), join(src, 'assets'), {recursive:true});
  await cp(new URL('../index.html', import.meta.url), join(src, 'index.html'));
  await cp(new URL('../explore.html', import.meta.url), join(src, 'explore.html'));
  for (const file of await readdir(new URL('../js/', import.meta.url))) {
    if (file.endsWith('.mjs')) await cp(new URL('../js/'+file,import.meta.url),join(src,'js',file));
  }
  await writeFile(join(src, 'js/config.js'), 'window.KOTR_CONFIG = {};');
  await writeFile(join(src, 'assets/private.txt'), 'not public');
  for (const legacy of ['grappa-relief.webp','ascent.svg']) {
    await writeFile(join(src,'assets',legacy),'stale source asset, must not ship');
  }
  const a = join(tmp, 'a'), b = join(tmp, 'b'), repeat = join(tmp, 'repeat');
  await build(src, a);
  const edit = async (file, before, after) => {
    const path = join(src, file), original = await readFile(path, 'utf8');
    assert.ok(original.includes(before));
    await writeFile(path, original.replace(before, after));
  };
  await edit('index.html', '<title>', '<title>B: ');
  await edit('assets/semonzo.gpx', '>1746.0</ele>', '>1846.0</ele>');
  // An unmanifested byte change is never a valid release.
  await assert.rejects(build(src, join(tmp, 'unverified')), /bytes do not match/);
  const updatedHash = createHash('sha256').update(await readFile(join(src,'assets/semonzo.gpx'))).digest('hex');
  await edit('js/example-catalog.mjs',
    'bd4f3a18bf36bed53229a3efe04e6e5a47aab1b37e2fe597ea961d66de07ffa4', updatedHash);
  await edit('js/example-catalog.mjs', "revisionId:'semonzo-example-v1'", "revisionId:'semonzo-example-v2'");
  await build(src, b);
  await build(src, repeat);
  const files = dir => readdir(dir, {recursive:true});
  assert.deepEqual((await files(b)).sort(), (await files(repeat)).sort());
  for (const name of await files(b)) {
    if (['assets','js'].includes(name)) continue;
    assert.deepEqual(await readFile(join(b, name)), await readFile(join(repeat, name)));
  }
  const names = await files(a);
  const routePack = await readRoutePack(await realpath(src));
  const packPointerName = 'assets/route-pack.' +
    createHash('sha256').update(routePack.pointerBytes).digest('hex').slice(0,24) + '.json';
  const routeFiles = [...routePack.files.keys(),packPointerName];
  const expected = ['assets','js','.nojekyll','index.html','explore.html','assets/flyover.js',
    'assets/terrain.js','assets/semonzo.gpx','assets/site.css','js/config.js',...['ascent-estimator','chapter-reveal',
      'climb-sensitivity','climb-sensitivity-view','plan-comparison','ride-clock',
      'rider-controls','rider-scenario','rider-preferences','preference-storage','preferences-view',
      'semonzo-profile','route-analysis','route-analysis-loader','route-pack-contract','route-catalog','example-catalog','route-state','site-shell',
      'itinerary','trip-planner','trip-planner-view','route-time','route-playback','route-playback-adapters',
      'route-session','route-briefing','route-briefing-view','route-comparison','route-comparison-view',
      'route-pace','route-pace-view'].map(n=>`js/${n}.mjs`)];
  expected.push(...routeFiles.map(n=>n.replace(/\.[0-9a-f]{24}\./,'.')));
  assert.deepEqual(names.map(n=>n.replace(/\.[0-9a-f]{24}\./,'.')).sort(),expected.sort());
  for (const n of names.filter(n=>n.includes('/'))) {
    const fullHash = createHash('sha256').update(await readFile(join(a,n))).digest('hex');
    assert.ok(n.includes(`.${fullHash.slice(0,24)}.`) ||
      routePack.files.has(n) && n.includes(fullHash), n);
  }
  assert.ok(!names.some(n=>/relief|\.svg$|\.webp$/.test(n)));
  assert.doesNotMatch(await readFile(join(a,'index.html'),'utf8'), /grappa-relief|ascent\.svg|relief-beacon/);
  assert.ok(!names.includes('assets/private.txt'));
  assert.deepEqual(names.filter(n=>n.endsWith('.json')).sort(),routeFiles.filter(n=>n.endsWith('.json')).sort());
  // Check static AND dynamic local imports against the final hashed inventory.
  for (const name of names.filter(n=>/\.(mjs|js)$/.test(n))) {
    const text = await readFile(join(a,name),'utf8');
    for (const [,spec] of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      assert.match(spec, /\.[0-9a-f]{24}\.mjs$/);
      assert.ok(names.includes(join(dirname(name),spec)), `${name} → ${spec}`);
    }
  }
  const bNames = new Set(await files(b));
  assert.deepEqual(names.filter(n => !bNames.has(n)).sort(), names.filter(n =>
    /(?:flyover|semonzo|semonzo-profile|example-catalog|route-playback-adapters|rider-controls|site-shell)\./.test(n)).sort());
  // The shared route clock now reaches BOTH document shells, but still does
  // not change the independent camera script or geometry bytes.
  const c = join(tmp, 'clock-only');
  await edit('js/ride-clock.mjs', 'export function createRideClock', '/* release fixture */ export function createRideClock');
  await build(src, c);
  const cNames = new Set(await files(c));
  assert.deepEqual([...bNames].filter(n=>!cNames.has(n)).sort(), [...bNames].filter(n=>/\/(?:ride-clock|route-pace-view|site-shell|rider-controls)\./.test(n)).sort());
  assert.notDeepEqual(await readFile(join(b,'index.html')), await readFile(join(c,'index.html')));
  const marker = async dir => (await readFile(join(dir,'explore.html'),'utf8')).match(/<meta name="kotr-release" content="([a-f0-9]{24})">/)[1];
  const indexMarker = async dir => (await readFile(join(dir,'index.html'),'utf8')).match(/<meta name="kotr-release" content="([a-f0-9]{24})">/)[1];
  const indexMarkers = new Map([[a,await indexMarker(a)],[b,await indexMarker(b)]]);
  assert.notEqual(await marker(b),await marker(c));
  // Each sensitivity-only edit invalidates exactly its transitive importers.
  // Both entry markers change; unrelated assets (including camera) stay stable.
  let previous = c;
  for (const [module, changed] of [
    ['climb-sensitivity', ['climb-sensitivity','climb-sensitivity-view','route-pace-view','site-shell','rider-controls']],
    ['climb-sensitivity-view', ['climb-sensitivity-view','route-pace-view','site-shell','rider-controls']],
  ]) {
    const next = join(tmp,module);
    await edit(`js/${module}.mjs`, 'import {', '/* release fixture */ import {');
    await build(src,next);
    const beforeNames = await files(previous), afterNames = await files(next);
    const affected = n => changed.some(m=>n.startsWith(`js/${m}.`));
    assert.deepEqual(beforeNames.filter(n=>!afterNames.includes(n)).sort(),beforeNames.filter(affected).sort());
    assert.deepEqual(afterNames.filter(n=>!beforeNames.includes(n)).sort(),afterNames.filter(affected).sort());
    for (const name of beforeNames.filter(n=>extname(n) && !['explore.html','index.html'].includes(n) && !affected(n))) {
      assert.deepEqual(await readFile(join(previous,name)),await readFile(join(next,name)),name);
    }
    assert.notEqual(await marker(previous),await marker(next));
    assert.notEqual(await indexMarker(previous),await indexMarker(next));
    previous = next;
  }
  // A validator change must invalidate both legacy entry dependency trees.
  const validatorRelease = join(tmp,'validator-change');
  await edit('js/route-catalog.mjs', 'export function createCatalog', '/* release fixture */ export function createCatalog');
  await build(src,validatorRelease);
  const beforeValidator = await files(previous), afterValidator = await files(validatorRelease);
  const catalogDependents = /\/(?:route-catalog|route-pack-contract|route-analysis-loader|trip-planner|trip-planner-view|example-catalog|semonzo-profile|route-playback-adapters|rider-controls|flyover|site-shell)\./;
  assert.deepEqual(beforeValidator.filter(n=>!afterValidator.includes(n)).sort(),
    beforeValidator.filter(n=>catalogDependents.test(n)).sort());
  for (const entry of ['index.html','explore.html'])
    assert.notDeepEqual(await readFile(join(previous,entry)),await readFile(join(validatorRelease,entry)));
  // The new state helper is shared by both entries, and CSS is a first-class
  // hashed runtime asset. Each edit must reach both entry freshness markers.
  let shellPrevious = validatorRelease;
  for (const [file, before, after, affected] of [
    ['js/route-analysis.mjs', 'export function analyzeRoute', '/* release fixture */ export function analyzeRoute',
      /\/(?:route-analysis|route-analysis-loader|trip-planner|trip-planner-view|semonzo-profile|route-time|route-pace|route-pace-view|route-playback-adapters|route-briefing|route-briefing-view|route-comparison-view|site-shell|rider-controls|flyover)\./],
    ['js/route-playback.mjs', 'export function createRoutePlayback', '/* release fixture */ export function createRoutePlayback',
      /\/(?:route-playback|route-session|route-pace-view|route-briefing-view|route-comparison-view|site-shell|rider-controls|flyover)\./],
    ['js/route-pace.mjs', 'export function createRoutePace', '/* release fixture */ export function createRoutePace',
      /\/(?:route-pace|route-pace-view|trip-planner-view|site-shell|rider-controls)\./],
    ['js/route-pace-view.mjs', 'export function installRoutePace', '/* release fixture */ export function installRoutePace',
      /\/(?:route-pace-view|site-shell|rider-controls)\./],
    ['js/route-briefing.mjs', 'export function briefingAt', '/* release fixture */ export function briefingAt',
      /\/(?:route-briefing|route-briefing-view|route-comparison-view|site-shell|rider-controls)\./],
    ['js/route-comparison.mjs', 'export function comparisonRow', '/* release fixture */ export function comparisonRow',
      /\/(?:route-comparison|route-comparison-view|site-shell|rider-controls)\./],
    ['js/route-comparison-view.mjs', 'export function installRouteComparison', '/* release fixture */ export function installRouteComparison',
      /\/(?:route-comparison-view|site-shell|rider-controls)\./],
    ['js/route-state.mjs', 'export function readSelection', '/* release fixture */ export function readSelection',
      /\/(?:route-state|site-shell|rider-controls)\./],
    ['js/rider-scenario.mjs', 'export function validateRider', '/* release fixture */ export function validateRider',
      /\/(?:rider-scenario|preference-storage|rider-preferences|preferences-view|site-shell|rider-controls)\./],
    ['js/preference-storage.mjs', 'export function createPreferenceStorage', '/* release fixture */ export function createPreferenceStorage',
      /\/(?:preference-storage|rider-preferences|preferences-view|site-shell|rider-controls)\./],
    ['js/rider-preferences.mjs', 'export function createRiderPreferences', '/* release fixture */ export function createRiderPreferences',
      /\/(?:rider-preferences|preferences-view|site-shell|rider-controls)\./],
    ['js/preferences-view.mjs', 'export function installPreferences', '/* release fixture */ export function installPreferences',
      /\/(?:preferences-view|site-shell|rider-controls)\./],
    ['assets/site.css', ':root', '/* release fixture */ :root', /\/site\./],
  ]) {
    const next = join(tmp, file.replaceAll('/', '-') + '-change');
    await edit(file,before,after);
    await build(src,next);
    const beforeNames = await files(shellPrevious), afterNames = await files(next);
    assert.deepEqual(beforeNames.filter(n=>!afterNames.includes(n)).sort(),beforeNames.filter(n=>affected.test(n)).sort());
    for (const entry of ['index.html','explore.html'])
      assert.notDeepEqual(await readFile(join(shellPrevious,entry)),await readFile(join(next,entry)));
    shellPrevious = next;
  }
  let live = a, fail = false, probes = 0, plainNavigations = 0, replacements = 0;
  let replacementGate = null, gatedFreshnessRequests = 0;
  t.after(() => replacementGate?.resolve());
  const legacyRequests=[];
  const allowed = new Set([...names, ...bNames].filter(n => extname(n)));
  const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.gpx':'application/xml',
    '.svg':'image/svg+xml','.webp':'image/webp','.css':'text/css','.json':'application/json'};
  const server = createServer(async (req, res) => {
    if (req.url === '/away') return res.writeHead(200, {'Content-Type':'text/html'}).end('<a href="/kotr27/">Return</a>');
    const url = new URL(req.url, 'http://localhost');
    if (/grappa-relief|ascent\..*svg$/.test(url.pathname)) legacyRequests.push(url.pathname);
    const file = url.pathname.slice('/kotr27/'.length) || 'index.html';
    if (!url.pathname.startsWith('/kotr27/') || !allowed.has(file)) return res.writeHead(404).end();
    if (file === 'index.html') {
      if (req.headers['sec-fetch-mode'] !== 'navigate') {
        probes++;
        if (fail) return res.destroy();
        // This fixture owns the freshness response. Do not let its navigation
        // invalidate an ID that our asynchronous Fetch handler is continuing.
        // The separate lifecycle regression demonstrates both the obsolete-ID
        // failure and the completion-before-navigation positive control.
        if (replacementGate) {
          gatedFreshnessRequests++;
          await replacementGate.promise;
        }
      } else if (url.search) replacements++;
      else plainNavigations++;
    }
    try {
      const bytes = await readFile(join(live, file));
      res.writeHead(200, {'Content-Type':types[extname(file)], 'Cache-Control':'public, max-age=600'}).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [], interceptionErrors = [];
  const continuations = new Set();
  // Keep bounded lifecycle evidence for the intermittent invalid-ID failure.
  // No retries or ignored protocol errors: the final assertion stays strict.
  const lifecycle = [];
  const {cmd, js, exceptions} = await browser(t, (m, send) => {
    if (['Network.requestWillBeSent','Network.loadingFailed','Fetch.requestPaused'].includes(m.method)) {
      const {requestId, networkId, request, canceled, errorText} = m.params;
      lifecycle.push({method:m.method, requestId, networkId, url:request?.url, canceled, errorText});
      if (lifecycle.length > 100) lifecycle.shift();
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Fetch.requestPaused') {
      const {requestId,request} = m.params;
      const local = new URL(request.url).origin === base;
      const continuation = send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        {requestId,...(!local && {errorReason:'BlockedByClient'})})
        .catch(error=>{
          interceptionErrors.push(error.message);
          t.diagnostic(JSON.stringify({
            interceptionFailure:{requestId, url:request.url, networkId:m.params.networkId, error:error.message},
            lifecycle,
          }));
        }).finally(() => continuations.delete(continuation));
      continuations.add(continuation);
    }
  });
  await cmd('Network.enable');
  await cmd('Fetch.enable', {patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
  const plannerIdle = async (required = false) => {
    await until(() => js(`(() => {
      const shell=document.querySelector('#site-shell'), planner=document.querySelector('#trip-planner');
      return !shell ? ${!required} : shell.dataset.ready === 'true' && (!planner || planner.dataset.ready === 'true');
    })()`));
    await until(() => continuations.size === 0);
  };
  const visit = async (offline = false) => {
    await plannerIdle();
    if (live === b && replacements === 0 && !offline) replacementGate = Promise.withResolvers();
    await cmd('Page.navigate', {url:base+'/away'});
    await until(() => js(`!!document.querySelector('a[href="/kotr27/"]')`));
    if (offline) await cmd('Network.emulateNetworkConditions', {
      offline:true, latency:0, downloadThroughput:0, uploadThroughput:0
    });
    await js(`document.querySelector('a').click()`);
    if (replacementGate) {
      // The old HTML really executes and loads its planner while revalidation
      // is held. Only once its work has completed do we permit actual entry
      // freshness replacement, rather than racing DevTools continuations.
      await plannerIdle(true);
      await until(() => gatedFreshnessRequests === 1);
      assert.equal(await js(`document.querySelector('meta[name="kotr-release"]').content`),indexMarkers.get(a),
        'the cached old release really ran before its freshness replacement');
      assert.equal(await js(`document.querySelector('#trip-planner')?.dataset.ready`),'true',
        'complete old planner requests before allowing fixture-owned replacement');
      assert.equal(continuations.size,0,'no unresolved interception command crosses the gate');
      assert.equal(replacements,0,'freshness navigation has not happened yet');
      replacementGate.resolve();
      replacementGate = null;
    }
    // Let entry freshness finish replacing the shell before opting in. The old
    // default flyover delayed readiness; the lightweight shell is now earlier.
    await until(() => js(`document.querySelector('#site-shell')?.dataset.ready === 'true' &&
      document.querySelector('meta[name="kotr-release"]')?.content === '${indexMarkers.get(live)}'`));
    await plannerIdle(true);
    await js(`document.querySelector('#site-content a[href*="view=flyover"]').click()`);
    await until(() => js(`document.querySelector('#deck')?.hidden === false`));
  };
  const summit = async () => {
    await js(`seek.value = seek.max; seek.dispatchEvent(new Event('input'))`);
    return js('stats.textContent');
  };
  const explore = async () => {
    await plannerIdle(true);
    await js(`document.querySelector('[data-site-clock]').click()`);
    await until(()=>js(`document.querySelector('#controls')?.disabled===false`));
    await plannerIdle(true);
    return js(`document.querySelector('script[type=module]').src`);
  };
  await visit(); await until(() => probes === 1);
  assert.match(await summit(), /1746 m elevation/);
  assert.match(await explore(),new RegExp(names.find(n=>n.includes('/rider-controls.'))+'$'));
  await until(()=>js(`document.querySelector('#sensitivity-content')?.hidden === false`));
  await js(`window.s = name => document.getElementById('sensitivity-' + name);
    sensitivity.open = true; personal.open = true`);
  const ready = () => until(()=>js(`!s('content').hidden && s('error').textContent === ''`));
  const set = (id,value,event = 'change') => js(`{
    const e = document.getElementById(${JSON.stringify(id)});
    e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event('${event}'));
  }`);
  const key = async (key,code,n) => {
    for (const type of ['keyDown','keyUp'])
      await cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n});
  };
  const exact = async () => {
    const cards = await js(`[...s('comparisons').children].map(c=>({
      name:c.dataset.scenario, text:c.textContent,
      fields:Object.fromEntries([...c.querySelectorAll('data')].map(d=>[d.dataset.field,Number(d.value)]))
    }))`);
    assert.deepEqual(cards.map(c=>c.name),['baseline','weight','ftp','combined']);
    const [b,w,f,p] = cards.map(c=>c.fields);
    assert.deepEqual([w.riderKg,w.ftpW,f.riderKg,f.ftpW],[p.riderKg,b.ftpW,b.riderKg,p.ftpW]);
    const fraction = await js(`Number(s('effort').value)/100`);
    const seconds = cards.map(({fields:c})=>estimateAscent(profile,{
      riderKg:c.riderKg,ftpW:c.ftpW,bikeKitKg:12,slowerFraction:.6,fasterFraction:fraction,
    }).total.faster.movingSeconds);
    cards.forEach(({fields:c,text},i)=>{
      const delta = seconds[i]-seconds[0];
      assert.equal(c.movingMinutes,seconds[i]/60);
      assert.equal(c.targetW,c.ftpW*fraction);
      assert.equal(c.riderWattsPerKg,c.ftpW/c.riderKg);
      assert.equal(c.deltaMinutes,delta/60);
      assert.equal(c.deltaPercent,delta/seconds[0]*100);
      assert.ok(text.endsWith(delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'unchanged'));
    });
    assert.deepEqual(await js(`[Number(s('minutes').value),Number(s('watts').value)]`),
      [p.movingMinutes,p.targetW]);
    return p;
  };
  const explorerRequests = requests.length;
  for (const width of [375,1200]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width===375});
    await js('clear.click()'); await ready();
    await set('sensitivity-mode','surface');
    const baseline = await exact();
    assert.deepEqual([baseline.riderKg,baseline.ftpW,baseline.targetW],[75,220,176]);
    assert.ok(await js(`s('chart').querySelectorAll('polygon').length > 0 &&
      s('chart').textContent.includes('Z: Moving min')`));
    assert.ok(await js(`['ftp','mass'].every(n=>s(n).options.length >= 9 && s(n).options.length <= 10)`));
    await js(`s('chart').focus()`);
    await key('ArrowRight','ArrowRight',39);
    assert.ok((await exact()).ftpW > baseline.ftpW);
    await key('ArrowUp','ArrowUp',38);
    const selected = await exact();
    assert.ok(selected.riderKg > baseline.riderKg);
    await set('sensitivity-mode','heatmap');
    assert.deepEqual(await exact(),selected);
    assert.ok(await js(`s('view').disabled && s('chart').querySelectorAll('polygon[data-i]').length > 0`));
    await js(`s('chart').focus()`);
    await key('Home','Home',36);
    assert.deepEqual(await exact(),baseline);
    await key('Tab','Tab',9);
    assert.equal(await js('document.activeElement.id'),'sensitivity-ftp');
    await js(`s('home').focus()`);
    await key(' ','Space',32);
    assert.deepEqual(await exact(),baseline);
    await set('sensitivity-effort','90','input'); await ready(); await exact();
    assert.ok(await js('document.documentElement.scrollWidth <= innerWidth'));
    for (const [id,value] of [['mass','19.9'],['ftp','651'],['mass','oops']]) {
      await js('clear.click()'); await ready();
      await set(id,value,'input');
      assert.ok(await js(`s('content').hidden && !s('chart').children.length &&
        !s('comparisons').children.length && !s('minutes').hasAttribute('value') &&
        s('error').textContent.includes('Correct or clear')`));
    }
    await js('clear.click()'); await ready();
    assert.deepEqual(await exact(),baseline);
    t.diagnostic(`Packaged /kotr27/ ${width}px: surface, heatmap, four exact scenarios, keyboard, invalid/clear, no overflow`);
  }
  assert.deepEqual(requests.slice(explorerRequests),[],'panel interaction makes no network requests');
  assert.ok(requests.some(u=>/\/climb-sensitivity-view\.[a-f0-9]{24}\.mjs$/.test(u)));
  assert.ok(requests.some(u=>/\/climb-sensitivity\.[a-f0-9]{24}\.mjs$/.test(u)));
  assert.ok(requests.filter(u=>u.endsWith('.json')).every(u =>
    routeFiles.some(file => new URL(u).pathname.endsWith('/'+file))),
  'only the approved planner graph may request JSON; legacy example JSON remains excluded');
  assert.deepEqual(await js('[localStorage.length,sessionStorage.length,document.cookie]'),[0,0,'']);
  // Only after checking the legacy example's strict no-JSON behavior, explicitly
  // load organizer data. Exercise the packaged producer validator in a browser,
  // without Node imports/Buffer or treating hashes as semantic validation.
  const analysisLoader=names.find(n=>n.startsWith('js/route-analysis-loader.'));
  const catalogModule=names.find(n=>n.startsWith('js/route-catalog.'));
  const loaded=await cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const {loadRouteAnalysis}=await import('./${analysisLoader}');
    const {verifyAsset}=await import('./${catalogModule}');
    const pointer=await fetch('./${packPointerName}').then(r=>r.json());
    const bytes=await fetch('./'+pointer.path).then(r=>r.arrayBuffer());
    await verifyAsset(pointer,bytes);
    const pack=JSON.parse(new TextDecoder().decode(bytes)), results=[];
    for (const row of pack.routes) {
      const analysis=await loadRouteAnalysis({pack,routeId:row.routeId,revisionId:row.revisionId,
        readAsset:path=>fetch('./'+path).then(r=>r.arrayBuffer())});
      results.push({routeId:analysis.routeId,status:analysis.status,points:analysis.points.length});
    }
    // Rehash malformed profiles AND manifests: valid hashes must not make
    // coercible gap metadata acceptable to the packaged browser boundary.
    const rejected=[], encode=value=>new TextEncoder().encode(JSON.stringify(value));
    const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
      b=>b.toString(16).padStart(2,'0')).join('');
    for (const field of ['maxM','over200m']) for (const type of ['string','array']) {
      const changed=structuredClone(pack), row=changed.routes[0];
      const revision=changed.catalog.routes.find(r=>r.id===row.routeId).revisions[0];
      const raw=await fetch('./'+revision.profile.path).then(r=>r.json());
      raw.gaps[field]=type==='string' ? String(raw.gaps[field]) : [raw.gaps[field]];
      const profileBytes=encode(raw);
      revision.profile.sha256=await hash(profileBytes);
      revision.profile.path='assets/route-profile-'+revision.profile.sha256+'.json';
      const manifestBytes=encode(changed), sha256=await hash(manifestBytes);
      await verifyAsset({path:'assets/route-manifest-'+sha256+'.json',sha256},manifestBytes);
      await verifyAsset(revision.profile,profileBytes);
      try {
        await loadRouteAnalysis({pack:JSON.parse(new TextDecoder().decode(manifestBytes)),
          routeId:row.routeId,revisionId:row.revisionId,
          readAsset:path=>path===revision.profile.path ? profileBytes :
            fetch('./'+path).then(r=>r.arrayBuffer())});
        rejected.push({field,type,error:null});
      } catch (error) { rejected.push({field,type,error:error.message}); }
    }
    return {results,rejected};
  })()`});
  assert.ok(!loaded.exceptionDetails,JSON.stringify(loaded.exceptionDetails));
  assert.deepEqual(loaded.result.value.results,routePack.pack.routes.map(r=>({
    routeId:r.routeId,status:'supported',points:r.pointCount,
  })));
  assert.deepEqual(loaded.result.value.rejected,['maxM','over200m'].flatMap(field=>
    ['string','array'].map(type=>({field,type,error:'Route pack: invalid gap metadata'}))));
  live = b;
  await visit();
  await until(() => js(`document.querySelector('meta[name="kotr-release"]')?.content === '${indexMarkers.get(b)}' && document.querySelector('#deck')?.hidden === false`));
  assert.match(await js('location.href'), /\/kotr27\/index.html\?area=explore&view=flyover&route=semonzo-example&rev=semonzo-example-v2/);
  assert.match(await summit(), /1846 m elevation/);
  assert.equal(plainNavigations, 1, 'return started from cached ordinary HTML');
  assert.equal(replacements, 1);
  assert.equal(gatedFreshnessRequests,1);
  await explore();
  const bControls = [...bNames].find(n=>n.includes('/rider-controls.'));
  await until(()=>js(`location.pathname.endsWith('/kotr27/explore.html') && document.querySelector('script[type=module]')?.src.endsWith('${bControls}') && document.querySelector('#controls')?.disabled===false`));
  const before = probes;
  await visit(); await until(() => probes > before);
  assert.match(await summit(), /1846 m elevation/);
  fail = true;
  const last = probes;
  await visit(); await until(() => probes > last);
  assert.match(await summit(), /1846 m elevation/);
  await visit(true);
  assert.match(await summit(), /1846 m elevation/);
  assert.ok((await explore()).endsWith('/'+bControls), 'cached explorer and its transitive assets work offline');
  assert.equal(replacements, 1);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(interceptionErrors, []);
  assert.deepEqual(legacyRequests,[]);
});
