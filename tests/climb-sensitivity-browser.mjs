import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { browser, until } from './browser.mjs';
import { evaluateClimbSensitivityPoint } from '../js/climb-sensitivity.mjs';
import { estimateAscent } from '../js/ascent-estimator.mjs';

const root = new URL('../', import.meta.url);
const profile = JSON.parse(await readFile(new URL('assets/semonzo-chapters.v1.json', root)));

// Source harness: release allowlist work belongs to kotr27-39y.4. Instrument
// served modules only, so cache/coalescing and fault isolation are observable
// without adding test hooks or a second physics implementation to the app.
async function fixture(t) {
  const files = ['explore.html', 'assets/semonzo.gpx',
    ...(await readdir(new URL('js/', root))).filter(f => f.endsWith('.mjs')).map(f => `js/${f}`)];
  const faults = { profile:false, panel:false };
  const server = createServer(async (req,res) => {
    const file = req.url.slice('/kotr27/'.length);
    if (!req.url.startsWith('/kotr27/') || !files.includes(file) ||
        (faults.profile && file.endsWith('.gpx')) || (faults.panel && file === 'js/climb-sensitivity-view.mjs')) {
      res.writeHead(404).end(); return;
    }
    let text = await readFile(new URL(file, root), 'utf8');
    if (file === 'js/climb-sensitivity.mjs') text = text.replace(
      'export function buildClimbSensitivity(profile, options) {',
      `export function buildClimbSensitivity(profile, options) {
        window.__builds = (window.__builds || 0) + 1;
        if (window.__failBuild) throw Error('Injected panel failure');`);
    if (file === 'js/ascent-estimator.mjs') text = text.replace(
      'export function estimateAscent(profile, options = {}) {',
      `export function estimateAscent(profile, options = {}) {
        window.__physics = (window.__physics || 0) + 1;`);
    res.writeHead(200, { 'Content-Type':{'.mjs':'text/javascript','.gpx':'application/xml','.html':'text/html'}[extname(file)],
      'Cache-Control':'no-store' }).end(text);
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { faults, url:`http://127.0.0.1:${server.address().port}/kotr27/explore.html` };
}

for (const width of [375,1200]) test(`${width}px sensitivity modes, exact points and independent controls`, async t => {
  const { url, faults } = await fixture(t);
  const requests = [];
  const { cmd, js, exceptions } = await browser(t, m => {
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs', { urls:['https://*'] });
  await cmd('Emulation.setDeviceMetricsOverride', { width,height:850,deviceScaleFactor:1,mobile:width === 375 });
  await cmd('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] });
  await cmd('Page.navigate', { url });
  await until(() => js(`document.querySelector('#sensitivity-content')?.hidden === false`));
  await js(`window.s = name => document.getElementById('sensitivity-' + name); sensitivity.open = true; personal.open = true`);
  const ready = () => until(() => js(`!s('content').hidden && s('error').textContent === ''`));
  const settle = async () => {
    await js(`window.settled = false; requestAnimationFrame(() => requestAnimationFrame(() => window.settled = true))`);
    await until(() => js('window.settled'));
  };
  const set = (id,value,event = 'change') => js(`{
    const e = document.getElementById(${JSON.stringify(id)});
    e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event('${event}'));
  }`);
  const key = async (key,code,n) => {
    for (const type of ['keyDown','keyUp'])
      await cmd('Input.dispatchKeyEvent', {type,key,code,windowsVirtualKeyCode:n});
  };
  // Native macOS selects use type-ahead rather than portable arrow behaviour.
  const choose = async letter => {
    for (const type of ['keyDown','keyUp'])
      await cmd('Input.dispatchKeyEvent', {type,key:letter,text:type === 'keyDown' ? letter : '',
        windowsVirtualKeyCode:letter.toUpperCase().charCodeAt(0)});
  };
  const point = () => js(`({
    ftpW:parseFloat(s('ftp').selectedOptions[0].text),
    riderKg:Number(s('selection').textContent.match(/\\(([^ ]+) kg rider/)[1]),
    movingMinutes:Number(s('minutes').value), targetW:Number(s('watts').value)
  })`);
  const exact = async (fraction = .8) => {
    const p = await point();
    const expected = evaluateClimbSensitivityPoint(profile, {
      riderKg:p.riderKg,ftpW:p.ftpW,bikeKitKg:12,effortFraction:fraction,
    });
    assert.equal(p.targetW,expected.targetW);
    assert.ok(Math.abs(p.movingMinutes * 60 - expected.movingSeconds) < 1e-8);
    assert.equal(await js(`s('minutes').textContent`),String(expected.movingSeconds/60));
    const { scenarios, unit } = await js(`({
      unit:document.getElementById('unit').value,
      scenarios:[...s('comparisons').children].map(card => ({
        name:card.dataset.scenario, text:card.textContent,
        fields:Object.fromEntries([...card.querySelectorAll('data')].map(d =>
          [d.dataset.field, {value:Number(d.value), text:d.textContent}]))
      }))
    })`);
    assert.deepEqual(scenarios.map(s => s.name), ['baseline','weight','ftp','combined']);
    const b = scenarios[0].fields;
    const pairs = [[b.riderKg.value,b.ftpW.value], [p.riderKg,b.ftpW.value],
      [b.riderKg.value,p.ftpW], [p.riderKg,p.ftpW]];
    const sign = v => v === 0 ? '0.00' :
      `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(2) === '0.00' ? '<0.01' : Math.abs(v).toFixed(2)}`;
    for (const [i, scenario] of scenarios.entries()) {
      const f = scenario.fields;
      assert.deepEqual([f.riderKg.value,f.ftpW.value],pairs[i]);
      const direct = estimateAscent(profile, {
        riderKg:f.riderKg.value,ftpW:f.ftpW.value,bikeKitKg:12,
        slowerFraction:.6,fasterFraction:fraction,
      });
      const seconds = direct.total.faster.movingSeconds;
      assert.equal(f.movingMinutes.value,seconds/60);
      assert.equal(f.movingMinutes.text,(seconds/60).toFixed(2));
      assert.equal(f.targetW.value,direct.assumptions.fasterTargetW);
      assert.equal(f.targetW.text,String(f.targetW.value));
      assert.equal(f.ftpW.text,String(f.ftpW.value));
      assert.equal(f.riderKg.text,String(unit === 'lb' ? f.riderKg.value/.45359237 : f.riderKg.value));
      assert.ok(scenario.text.includes(` ${unit} + 12 kg kit`));
      assert.equal(f.riderWattsPerKg.value,f.ftpW.value/f.riderKg.value);
      assert.equal(f.riderWattsPerKg.text,f.riderWattsPerKg.value.toFixed(3));
      const baselineSeconds = estimateAscent(profile, {
        riderKg:b.riderKg.value,ftpW:b.ftpW.value,bikeKitKg:12,
        slowerFraction:.6,fasterFraction:fraction,
      }).total.faster.movingSeconds;
      const delta = seconds - baselineSeconds;
      assert.equal(f.deltaMinutes.value,delta/60);
      assert.equal(f.deltaPercent.value,delta/baselineSeconds*100);
      assert.equal(f.deltaMinutes.text,sign(f.deltaMinutes.value));
      assert.equal(f.deltaPercent.text,sign(f.deltaPercent.value));
      assert.ok(scenario.text.endsWith(delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'unchanged'));
    }
    return p;
  };
  const counts = () => js('[window.__builds,window.__physics]');
  const clock = () => js(`['minute','pos-a','pos-b','label-a','label-b'].map(id => {
    const e = document.getElementById(id); return [e.value,e.max,e.textContent];
  })`);
  const tap = async (selector,touch = false) => {
    const pos = await js(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      node.scrollIntoView({block:'center'});
      const r = node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    if (touch) {
      await cmd('Emulation.setTouchEmulationEnabled', {enabled:true});
      await cmd('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{...pos,radiusX:2,radiusY:2}]});
      await cmd('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    } else {
      await cmd('Emulation.setTouchEmulationEnabled', {enabled:false});
      for (const type of ['mousePressed','mouseReleased'])
        await cmd('Input.dispatchMouseEvent', {type,...pos,button:'left',clickCount:1});
    }
  };
  const noStale = async () => assert.ok(await js(`s('content').hidden && !s('chart').children.length &&
    !s('selection').textContent && !s('minutes').textContent && !s('minutes').hasAttribute('value') &&
    !s('watts').textContent && !s('baseline').textContent && !s('ftp').options.length &&
    !s('comparisons').children.length`));
  const baseline = await exact();
  assert.deepEqual([baseline.ftpW,baseline.riderKg,baseline.targetW],[220,75,176]);
  assert.match(await js(`s('baseline').textContent`), /fictional baseline.*assumed.*80%/);
  assert.match(await js(`s('limits').textContent`), /120–320 W.*55–95 kg.*moving minutes/);
  assert.equal(await js('window.__builds'),1);
  assert.equal(requests.filter(u => u.endsWith('.gpx')).length,1,'reuse the one runtime profile fetch');
  const initialCounts = await counts();
  const baselineInputs = await js(`[mass.value,ftp.value,s('baseline').textContent]`);
  const scale = await js(`s('scale').textContent`);
  await js(`s('chart').focus()`);
  await key('ArrowRight','ArrowRight',39);
  const right = await exact();
  assert.ok(right.ftpW > baseline.ftpW && right.riderKg === baseline.riderKg);
  await key('ArrowUp','ArrowUp',38);
  assert.ok((await exact()).riderKg > baseline.riderKg);
  assert.ok(await js(`document.activeElement === s('chart') && s('chart').matches(':focus-visible') &&
    s('chart').querySelector('circle[stroke="#8a3c22"]')`));
  assert.equal(await js(`s('chart').querySelectorAll('[tabindex]').length`),0);
  await key('Home','Home',36);
  assert.deepEqual(await exact(),baseline);
  await key('ArrowUp','ArrowUp',38);
  await exact(); // weight only
  await key('Home','Home',36);
  await key('ArrowLeft','ArrowLeft',37);
  await key('ArrowDown','ArrowDown',40);
  const selected = await exact();
  await set('sensitivity-view','weight');
  assert.deepEqual(await exact(),selected);
  const points = await js(`s('chart').querySelectorAll('g[data-i]').length`);
  assert.ok(points <= 441 && points >= 81);
  await js(`s('mode').focus()`);
  await choose('2');
  assert.equal(await js(`s('mode').value`),'heatmap','chart mode works from the keyboard');
  assert.deepEqual(await exact(),selected);
  assert.equal(await js(`s('scale').textContent`),scale);
  assert.equal(await js(`s('chart').querySelectorAll('g[data-i]').length`),points);
  assert.ok(await js(`s('view').disabled`));
  await tap('#sensitivity-chart g[data-i="2"][data-j="3"]');
  assert.deepEqual(await js(`[s('mass').value,s('ftp').value]`),['2','3']);
  await exact();
  await tap('#sensitivity-chart g[data-i="6"][data-j="5"]',true);
  await until(() => js(`s('mass').value === '6' && s('ftp').value === '5'`));
  const touched = await exact();
  await set('sensitivity-mode','surface');
  assert.deepEqual(await exact(),touched);
  await set('sensitivity-view','ftp');
  await tap('#sensitivity-chart g[data-i="0"][data-j="8"]');
  assert.deepEqual(await js(`[s('mass').value,s('ftp').value]`),['0','8']);
  await exact();
  await key('Tab','Tab',9);
  assert.equal(await js('document.activeElement.id'),'sensitivity-ftp');
  await choose('1');
  assert.equal(await js(`s('ftp').value`),'0');
  await exact();
  assert.deepEqual(await counts(),initialCounts,'selection, projection and mode never rebuild physics');
  assert.deepEqual(await js(`[mass.value,ftp.value,s('baseline').textContent]`),baselineInputs);
  await js(`s('home').focus()`);
  await key(' ','Space',32);
  assert.deepEqual(await exact(),baseline);

  // Unit-only changes preserve the unrounded original kg/lb entry, selection,
  // full physical dataset and both sensitivity AND rider-scenario physics.
  await set('mass','81.257123456','input'); await ready();
  assert.match(await js(`s('baseline').textContent`), /Partly assumed/);
  await set('ftp','243.125','input'); await ready();
  await set('sensitivity-mass','0');
  await set('sensitivity-ftp','8');
  const personal = await exact(), beforeUnits = await counts();
  assert.match(await js(`s('baseline').textContent`), /Your weight and FTP/);
  await set('unit','lb'); await ready();
  assert.deepEqual(await exact(),personal);
  assert.deepEqual(await counts(),beforeUnits);
  assert.match(await js(`s('mass-label').textContent`), /\(lb\)/);
  await set('unit','kg'); await ready();
  assert.equal(await js('mass.value'),'81.257123456');
  assert.deepEqual(await counts(),beforeUnits);
  await set('unit','lb'); await ready();
  await set('mass','180.1234567','input'); await ready();
  const pounds = await exact(), poundsCounts = await counts();
  assert.equal(pounds.riderKg,180.1234567 * .45359237);
  await set('unit','kg'); await ready();
  assert.deepEqual(await exact(),pounds);
  await set('unit','lb'); await ready();
  assert.equal(await js('mass.value'),'180.1234567');
  assert.deepEqual(await counts(),poundsCounts);

  const beforeEffortClock = await clock();
  for (const percent of [70,90]) {
    await set('sensitivity-effort',percent,'input'); await ready();
    await exact(percent/100);
    await set('sensitivity-mass','0');
    await set('sensitivity-ftp','8');
    await exact(percent/100);
    assert.equal(await js(`s('effort-label').textContent`),`${percent}%`);
    assert.deepEqual(await clock(),beforeEffortClock);
  }
  await set('sensitivity-mode','heatmap');
  await exact(.9);
  const beforePlans = await point(), beforePlansBuilds = (await counts())[0];
  for (const [id,value] of [['effort','faster'],['pace-b','slower'],['stop-b','15']]) {
    await set(id,value); await ready();
    assert.deepEqual(await point(),beforePlans);
    assert.equal((await counts())[0],beforePlansBuilds);
  }
  assert.match(await js(`document.getElementById('pos-b').textContent`),/Stopped/);

  // A burst gets just one sensitivity build and cannot publish an old draft.
  const beforeBurst = (await counts())[0];
  await js(`for (const v of ['240','245','251.125']) {
    ftp.value = v; ftp.dispatchEvent(new Event('input'));
  }`);
  await ready();
  assert.equal((await counts())[0],beforeBurst+1);
  assert.equal((await exact(.9)).ftpW,251.125);
  for (const [massValue,ftpValue] of [[20,30],[250,650]]) {
    await set('unit','kg'); await ready();
    await set('mass',massValue,'input');
    await set('ftp',ftpValue,'input'); await ready();
    const axes = await js(`['mass','ftp'].map(n => [...s(n).options].map(o => parseFloat(o.text)))`);
    assert.ok(axes.every(a => a.length <= 21 && a.length >= 9 && a.at(-1) > a[0]));
    assert.deepEqual(axes.map(a => [a[0],a.at(-1)]),massValue === 20 ? [[20,40],[30,130]] : [[230,250],[550,650]]);
    assert.equal((await exact(.9)).riderKg,massValue);
    assert.equal((await exact(.9)).ftpW,ftpValue);
    await set('sensitivity-mass',massValue === 20 ? '8' : '0');
    await set('sensitivity-ftp',massValue === 20 ? '8' : '0');
    await exact(.9);
  }
  await set('mass','20.000001','input');
  await set('ftp','220','input'); await ready();
  await set('sensitivity-mass','0');
  await exact(.9);
  assert.equal(await js(`s('comparisons').querySelector('[data-scenario="weight"] [data-field="deltaMinutes"]').textContent`),'-<0.01');
  assert.ok(await js(`s('comparisons').querySelector('[data-scenario="weight"]').textContent.endsWith('faster')`));
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  for (const [id,value] of [['mass','19.9'],['ftp','651'],['mass','oops']]) {
    await js('clear.click()'); await ready();
    await set(id,value,'input'); await noStale();
    assert.match(await js(`s('error').textContent`), /Correct or clear/);
    await settle(); await noStale();
  }
  await js('clear.click()'); await ready();
  assert.deepEqual(await exact(),baseline);
  assert.equal(await js(`s('effort').value`),'80');
  assert.equal(await js('unit.value'),'kg');
  await js(`ftp.value='255'; ftp.dispatchEvent(new Event('input'));
    ftp.value='bad'; ftp.dispatchEvent(new Event('input'));`);
  await settle(); await noStale();
  await js('clear.click()'); await ready();

  // Model failure is local, removes readouts, and permits a subsequent recovery.
  await js('window.__failBuild = true');
  await set('sensitivity-effort',71,'input');
  await until(() => js(`s('error').textContent.includes('unavailable')`));
  await noStale();
  assert.ok(await js('!ride.hidden && !controls.disabled'));
  await set('stop-b','5');
  assert.match(await js(`document.getElementById('pos-b').textContent`),/Stopped/);
  await js('window.__failBuild = false; clear.click()'); await ready();
  assert.deepEqual(await exact(),baseline);
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth && document.getAnimations().length === 0`));
  assert.ok(await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
  const { nodes } = await cmd('Accessibility.getFullAXTree');
  assert.ok(nodes.some(n => n.role.value === 'combobox' && n.name.value === 'Selected FTP (W)'));
  assert.ok(nodes.some(n => n.role.value === 'combobox' && /Selected rider weight/.test(n.name.value)));
  assert.ok(nodes.some(n => n.role.value === 'group' && n.name.value === 'Select a climb sensitivity point'));
  assert.ok(nodes.some(n => n.role.value === 'button' && n.name.value === 'Select baseline'));
  assert.ok(nodes.some(n => n.role.value === 'heading' && n.name.value === 'Selected weight · baseline FTP'));
  assert.match(await js(`sensitivity.textContent`), /system mass.*rolling resistance and aerodynamic drag/s);
  assert.match(await js(`sensitivity.textContent`), /not peak capacity.*prescription/s);
  assert.ok(!requests.some(u => u.startsWith('https:')));
  assert.deepEqual(await js('[localStorage.length,sessionStorage.length,document.cookie]'),[0,0,'']);
  t.diagnostic(`${width}px: exact points, coalesced physics, both modes, keyboard/click/touch, no overflow or animation`);

  faults.profile = true;
  await cmd('Page.navigate', {url});
  await until(() => js(`document.getElementById('sensitivity-error')?.textContent.includes('profile is unavailable')`));
  assert.ok(await js(`document.getElementById('sensitivity-content').hidden &&
    !document.getElementById('sensitivity-chart').children.length && !document.getElementById('sensitivity-minutes').textContent &&
    !document.getElementById('sensitivity-comparisons').children.length`));
  faults.profile = false; faults.panel = true;
  await cmd('Page.navigate', {url});
  await until(() => js(`document.querySelector('#controls')?.disabled === false`));
  assert.ok(await js(`!ride.hidden && document.getElementById('sensitivity-content').hidden`));
  assert.match(await js(`document.getElementById('sensitivity-error').textContent`), /panel is unavailable/);
  await set('stop-b','15');
  assert.match(await js(`document.getElementById('pos-b').textContent`),/Stopped/);
  assert.deepEqual(exceptions,[]);
});
