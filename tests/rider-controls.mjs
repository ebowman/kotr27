import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';
import { estimateAscent } from '../js/ascent-estimator.mjs';
import { riderScenario } from '../js/rider-scenario.mjs';
import { comparePlans } from '../js/plan-comparison.mjs';
import { describe as explainChapters } from '../js/chapter-reveal.mjs';

const route = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const blank = { mass: '', enteredUnit: 'kg', ftp: '', effort: 'slower' };
test('a stop changes only elapsed time; chapter gaps follow the two selected paces', () => {
  for (const effort of ['slower', 'faster']) {
    const state = riderScenario(route, { ...blank, ftp: '245', effort });
    for (const pace of ['slower', 'faster']) {
      const ride = comparePlans(state, pace, 0), cafe = comparePlans(state, pace, 15);
      assert.deepEqual(cafe, {...ride, b: {...ride.b, elapsedSeconds: ride.b.elapsedSeconds + 900}});
      assert.equal(ride.b.elapsedSeconds, state.estimate.total[pace].movingSeconds);
      if (effort === pace) {
        assert.deepEqual(ride.a, ride.b);
        assert.equal(ride.gap, 0);
      } else {
        assert.deepEqual(ride.largest, ['long-lift']);
        assert.ok(ride.gap > 0);
        assert.notEqual(ride.a.pedalWorkKJ, ride.b.pedalWorkKJ);
      }
    }
  }
  assert.equal(comparePlans(riderScenario(route, {...blank, mass:'abc'}), 'slower', 0), null);
});
test('optional fields map to estimator overrides; invalid drafts expose no estimate', () => {
  for (const [mass, ftp, kind] of [['', '', 'example'], ['81', '', 'partial'],
    ['', '250', 'partial'], ['81', '250', 'personal']]) {
    const state = riderScenario(route, { ...blank, mass, ftp });
    assert.equal(state.kind, kind);
    assert.deepEqual(state.estimate, estimateAscent(route, { slowerFraction: .7, fasterFraction: .8,
      ...(mass && { riderKg: 81 }), ...(ftp && { ftpW: 250 }) }));
  }
  for (const [field, values] of [['mass', ['1', '251', '0x50', ' ']],
    ['ftp', ['abc', '250watts', '0', '651', 'Infinity', '-123']]]) {
    for (const value of values) {
      const state = riderScenario(route, { ...blank, mass: '81', ftp: '250', [field]: value });
      assert.equal(state.kind, 'invalid');
      assert.ok(state.errors[field]);
      assert.equal(state.estimate, undefined);
    }
    const pounds = riderScenario(route, { ...blank, mass: '180', enteredUnit: 'lb' });
    assert.equal(pounds.estimate.assumptions.riderKg, 180 * .45359237);
  }
});

test('equal or indistinguishable rounded durations do not single out a chapter', () => {
  for (const seconds of [600, 611]) {
    const text = explainChapters([{name:'One', seconds:600}, {name:'Two', seconds}, {name:'Three', seconds:529}]);
    assert.match(text, /^One and Two share.*nearest minute/);
  }
});

for (const width of [320,1200]) test(`packaged ${width}px private keyboard walkthrough`, async t => {
  let out = process.env.RIDE_PACKAGE;
  if (!out) {
    const tmp = await mkdtemp(join(tmpdir(),'kotr-walk-'));
    t.after(()=>rm(tmp,{recursive:true,force:true}));
    out = join(tmp,'kotr27');
    await build(fileURLToPath(new URL('../',import.meta.url)),out);
  }
  const types = {'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.gpx':'application/xml','.css':'text/css'};
  const files = (await readdir(out,{recursive:true})).filter(f=>types[extname(f)]);
  let missing = false;
  const server = createServer(async (req, res) => {
    if (!req.url.startsWith('/kotr27/')) return res.writeHead(404).end();
    const file = new URL(req.url,'http://localhost').pathname.slice('/kotr27/'.length) || 'index.html';
    if (!files.includes(file) || (missing && file.endsWith('.gpx'))) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control':'no-store' })
      .end(await readFile(join(out,file)));
  });
  server.listen(0,'127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const requests = [];
  const { cmd, js, exceptions } = await browser(t, m => {
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  const base = `http://127.0.0.1:${server.address().port}/kotr27/`, url = base+'explore.html';
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs', {urls:['https://*']});
  await cmd('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion', value:'reduce'}] });
  const resize = w => cmd('Emulation.setDeviceMetricsOverride', { width:w, height:width===320?568:800, deviceScaleFactor:1, mobile:width===320 });
  await resize(width);
  await cmd('Page.navigate', {url:base+'?area=explore&view=flyover'});
  await until(()=>js(`document.querySelector('#deck')?.hidden === false`));
  const explorerStart = requests.length;
  assert.match(await js(`document.querySelector('[data-site-clock]').innerText`), /ride clock.*scrub.*compare two plans/i);
  await js(`document.querySelector('[data-site-clock]').click()`);
  await until(() => js(`document.querySelector('#controls')?.disabled === false`));
  assert.match(await js('document.body.innerText'), /How far up Monte Grappa in an hour/);
  const profileModule = files.find(f=>f.startsWith('js/semonzo-profile.'));
  const {result:derived} = await cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,
    expression:`import('./${profileModule}').then(m=>m.loadProfile())`});
  for (const key of ['schemaVersion','distanceM','chapters','segments']) assert.deepEqual(derived.value[key], route[key]);
  // Shared geometry parsing must not turn absent elevation into a flat/zero
  // fallback. The flyover and model now use this same parser/distance axis.
  const {result:invalidTrack} = await cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,
    expression:`import('./${profileModule}').then(m => {
      const xml = text => new DOMParser().parseFromString(text, 'application/xml');
      return ['','<ele></ele>','<ele>NaN</ele>'].map(elevation => {
        try {
          m.readExampleTrack(xml('<gpx><trk><trkseg><trkpt lat="45" lon="11">' +
            elevation + '</trkpt><trkpt lat="45.001" lon="11"><ele>100</ele></trkpt></trkseg></trk></gpx>'));
          return 'unexpected success';
        } catch (error) { return error.message; }
      });
    })`});
  assert.deepEqual(invalidTrack.value, Array(3).fill('Missing GPX measurement'));
  const before = requests.length;
  const text = () => js(`document.querySelector('#result').textContent`);
  const focus = () => js(`document.activeElement.id`);
  const key = async (key, code, n, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cmd('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: n,
        ...(key === 'Enter' && type === 'keyDown' && { text: '\r' }) });
  };
  const tab = () => key('Tab','Tab',9), enter = () => key('Enter','Enter',13);
  // Desktop Chrome on macOS uses native popup menus; type-ahead selects an
  // option without relying on platform-specific Home/End popup behaviour.
  const select = async (letter, last) => {
    if (width===320) return last ? key('End','End',35) : key('Home','Home',36);
    for (const type of ['keyDown','keyUp'])
      await cmd('Input.dispatchKeyEvent',{type,key:letter,text:type==='keyDown'?letter:'',
        windowsVirtualKeyCode:letter.toUpperCase().charCodeAt(0)});
  };
  const type = text => cmd('Input.insertText', { text });
  const screenshot = async name => {
    if (!process.env.RIDE_SHOTS) return;
    await js('window.scrollTo(0,0)');
    const {data} = await cmd('Page.captureScreenshot', {format:'png'});
    await writeFile(join(process.env.RIDE_SHOTS,`${width}-${name}.png`),Buffer.from(data,'base64'));
  };
  const position = id => js(`document.getElementById('pos-${id}').textContent`);
  const tap = async selector => {
    const point = await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}); b.scrollIntoView({block:'nearest'});
      const r=b.getBoundingClientRect(); return {x:r.x+r.width*.6,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed','mouseReleased'])
      await cmd('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
  };
  await screenshot('hour');
  await js(`document.getElementById('legacy-explorer').scrollIntoView({block:'start'})`);
  assert.ok(await js('minute.value==="60" && later.getBoundingClientRect().bottom<=innerHeight && !personal.open'));
  const markers = () => js(`['mark-a','mark-b'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON())`);
  const [a,b] = await markers();
  const [vw,vh] = await js('[innerWidth,innerHeight]');
  assert.ok([a,b].every(r=>r.width>0 && r.height>0 && r.top>=0 && r.left>=0 && r.right<=vw && r.bottom<=vh));
  t.diagnostic(`Hour: A ${await position('a')}, B ${await position('b')}`);
  assert.ok(!requests.slice(explorerStart).some(u=>/mapbox/i.test(u)));
  const hour = await position('a');
  await tap('#minute');
  assert.notEqual(await position('a'),hour);
  const setSelect = (id,value) => js(`{const s=document.getElementById('${id}'); s.value='${value}'; s.dispatchEvent(new Event('change'))}`);
  await js('minute.focus()');
  await key('Home','Home',36);
  assert.match(await position('a'), /^0.0 km/);
  await screenshot('start');
  await key('End','End',35);
  assert.match(await position('a'), /Summit/);
  assert.match(await position('b'), /Summit/);
  await screenshot('summit');
  await tap('#plan-options summary');
  await setSelect('pace-b','slower');
  await js(`minute.value=60; minute.dispatchEvent(new Event('input'))`);
  assert.equal(await position('a'),await position('b'));
  const [sameA,sameB] = await markers();
  assert.ok(Math.abs(sameA.x-sameB.x)<1 && sameA.bottom<=sameB.top, 'equal distance, separate labels');
  await screenshot('equal');
  await js(`document.getElementById('stop-b').focus()`); await select('1',true);
  const stopped = await position('b'), moving = await position('a');
  assert.match(stopped,/9.0 km · Stopped/);
  await js('later.focus()'); await enter();
  assert.equal(await position('b'),stopped);
  assert.notEqual(await position('a'),moving);
  await screenshot('cafe');
  await enter(); await enter(); // 15 minutes from the first stopped tick
  assert.doesNotMatch(await position('b'),/Stopped/);
  await tap('#chapter-tabs button:nth-child(3)');
  assert.match(await js(`document.getElementById('chapter-summary').textContent`),/High step · 10.9%.*28 min/);
  await screenshot('high-step');
  await js(`personal.open=true; clear.click(); document.getElementById('deep-dive').open=true`);
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  const example = await text();
  assert.match(example, /Robin’s fictional example.*75 kg.*12 kg/);
  assert.match(await js(`document.querySelector('#shared-assumptions').textContent`), /fictional reference.*75 kg rider \(assumed\).*220 W FTP \(assumed\)/);
  assert.match(await js('takeaway.textContent'), /Long lift.*min less there in Plan B/);
  const chart = () => js(`({
    title:document.querySelector('#axis-title').textContent,
    widths:[...bands.children].map(b=>b.getBoundingClientRect().width/bands.getBoundingClientRect().width),
    ticks:[...ticks.children].filter(b=>getComputedStyle(b.firstChild).visibility === 'visible').map(b=>{
      const range=document.createRange(); range.selectNodeContents(b.firstChild);
      const rect=range.getBoundingClientRect(), axis=ticks.getBoundingClientRect();
      return [b.textContent,(b.getBoundingClientRect().x-axis.x)/axis.width,rect.left-axis.left,rect.right-axis.left];
    }),
    axisWidth:ticks.getBoundingClientRect().width,
    list:[...readout.children].map(li=>li.textContent)
  })`);
  const checkAxis = async (axis, total, widths) => {
    const view = await chart();
    assert.ok(view.title.includes(axis));
    assert.equal(view.widths.length, widths.length);
    widths.forEach((w,i)=>assert.ok(Math.abs(w/total - view.widths[i]) < .001));
    assert.ok(view.ticks.length >= 2);
    let prevRight = -Infinity;
    for (const [label,x,left,right] of view.ticks) {
      assert.ok(label.endsWith(axis));
      assert.ok(Math.abs(parseFloat(label)/total - x) < .001, label);
      assert.ok(left >= -.1 && right <= view.axisWidth + .1 && right > left, label);
      assert.ok(left - prevRight >= 5, `${label}: ${left-prevRight}px after previous text`);
      prevRight = right;
    }
    return view.ticks;
  };
  const distance = () => checkAxis('km', 18.88719, [9,2,2.5,5.38719]);
  const model = riderScenario(route,blank).estimate;
  const time = (estimate = model) => checkAxis('min', estimate.total.slower.movingSeconds/60,
    estimate.chapters.map(c=>c.slower.movingSeconds/60));
  function reportGap(labels, a, b) {
    const first = labels.find(([name])=>name===a), second = labels.find(([name])=>name===b);
    assert.ok(first && second, `expected readable ${a} and ${b} at 320px`);
    t.diagnostic(`${width}px: ${a} → ${b}: ${(second[2]-first[3]).toFixed(1)}px between text rectangles`);
  }
  reportGap(await distance(), '10 km', '15 km');
  assert.ok(await js('revealed.hidden'));
  await js('choices.firstChild.focus()'); await tab(); await tab();
  assert.match(await js('document.activeElement.textContent'), /High step/);
  await enter(); await time();
  assert.ok(await js('!revealed.hidden && document.getAnimations().length === 0'));
  assert.match(await js('insight.textContent'), /Your pick: High step.*Long lift.*9 km.*steeper 2.5 km of High step/);
  const list = (await chart()).list;
  assert.match(list[0], /Long lift.*8.6%.*80 min \(range 71–80 min\).*49%/);
  assert.match(list[2], /High step.*10.9%.*28 min \(range 24–28 min\).*17%/);
  const {nodes} = await cmd('Accessibility.getFullAXTree');
  const ax = new Map(nodes.map(n=>[n.nodeId,n])), headings=[];
  function walk(n) {
    if (n.role.value === 'heading') headings.push(n.name.value);
    for (const id of n.childIds || []) walk(ax.get(id));
  }
  walk(nodes[0]);
  assert.deepEqual(headings,['Explore the route','Semonzo example briefing','Semonzo example ascent · Pace and ride clock',
    'Private local routes & recordings',
    'How far up Monte Grappa in an hour?','Chapter by chapter',
    'Two ways up the same climb','See a chapter in the flyover']);
  assert.ok(nodes.some(n=>n.role.value==='textbox' && n.name.value==='FTP in watts (optional)'));
  const ratios = await js(`(()=>{
    function lum(rgb) {
      const v=rgb.match(/\\d+/g).slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
      return .2126*v[0]+.7152*v[1]+.0722*v[2];
    }
    return [document.body,...bands.children].map(el=>{
      const s=getComputedStyle(el), a=lum(s.color), b=lum(s.backgroundColor);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    })
  })()`);
  assert.ok(ratios.every(r=>r>=4.5));
  t.diagnostic(`Body and chapter-number contrasts: ${ratios.map(n=>n.toFixed(2)).join(', ')}:1`);
  await tab(); await tab(); await enter(); await distance();
  await tab(); await enter(); await time();
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  await js(`personal.open=false; document.getElementById('know-ftp').focus()`);
  assert.equal(await focus(), 'know-ftp');
  await enter(); assert.equal(await focus(), 'ftp');
  await type('190');
  await js(`choices.firstChild.click()`);
  const at190 = riderScenario(route, {...blank, ftp:'190'}).estimate;
  reportGap(await time(at190), '100 min', '150 min');
  for (const w of [240, 800, width]) {
    await resize(w);
    await js(`window.settled=false; requestAnimationFrame(()=>requestAnimationFrame(()=>window.settled=true))`);
    await until(()=>js('window.settled'));
    await time(at190); // same revealed chart, no redraw from user input
  }
  await js('ftp.select()'); await type('30'); await js('choices.firstChild.click()');
  await time(riderScenario(route, {...blank, ftp:'30'}).estimate);
  await js('ftp.select()');
  await type('250');
  await js(`minute.focus(); minute.value=60; minute.dispatchEvent(new Event('input'))`);
  t.diagnostic(`250 W hour: A ${await position('a')}, B ${await position('b')}`);
  await screenshot('250W-hour');
  assert.ok(await js(`revealed.hidden && insight.textContent === ''`));
  await js(`choices.firstChild.click()`);
  assert.match((await chart()).list[0], /71 min \(range 62–71 min\)/);
  assert.match(await text(), /Partly assumed.*175 W \(70% of FTP\).*250 W \(entered\).*75 kg \(Robin’s assumption\).*12 kg/);
  assert.match(await js('takeaway.textContent'),/Long lift.*min less there in Plan B/);
  t.diagnostic(await js(`['plan-a','plan-b','takeaway'].map(id=>document.getElementById(id).textContent).join(' ')`));
  const ftpWork = await js('work.textContent');
  await js(`document.getElementById('stop-b').focus()`);
  await select('1',true);
  assert.match(await js(`document.getElementById('plan-b').textContent`), /127 min moving · 142 min elapsed/);
  assert.match(await position('b'),/9.0 km · Stopped/);
  await screenshot('250W-cafe');
  assert.equal(await js('work.textContent'), ftpWork);
  assert.match(await js(`work.parentElement.textContent`), /same height.*work against gravity is unchanged/);
  await js('effort.focus()');
  assert.equal(await focus(), 'effort');
  await select('f',true);
  assert.match(await text(), /200 W \(80% of FTP\)/);
  await js(`choices.firstChild.click()`);
  assert.match((await chart()).list[0], /62 min \(range 62–71 min\)/);
  await js('mass.focus()');
  await type('81.257');
  const personal = await text();
  assert.match(personal, /your weight and FTP.*81.26 kg \(entered\)/);
  assert.match(await js(`document.querySelector('#shared-assumptions').textContent`), /Your weight and FTP.*81.26 kg rider \(entered\).*250 W FTP \(entered\)/);
  await tab(); assert.equal(await focus(), 'unit');
  await select('l',true);
  assert.ok(Math.abs(Number(await js(`mass.value`)) * .45359237 - 81.257) < 1e-8);
  assert.equal(await text(), personal);
  if (width !== 320) await sleep(1100); // start a new native type-ahead prefix on the same select
  await select('k',false);
  assert.equal(await js(`mass.value`), '81.257');
  await tab(); assert.equal(await focus(), 'ftp');
  await js('ftp.select()'); await type('oops');
  assert.match(await text(), /^No estimate.*30 to 650/);
  assert.ok(await js(`comparison.hidden && !document.querySelector('#plan-b').textContent`));
  assert.ok(await js(`ride.hidden && !document.getElementById('clock-error').hidden`));
  assert.ok(await js(`document.querySelector('#chapter-game').hidden && !bands.children.length && !readout.children.length && !insight.textContent`));
  assert.equal(await js(`ftp.getAttribute('aria-invalid')`), 'true');
  const invalidMessage = await text();
  const invalidFieldMessage = await js(`document.getElementById('ftp-error').textContent`);
  // Invalid rider estimates must not break the independent route selection,
  // discard the draft, reveal stale times or abort heading-focus navigation.
  for (const [index,chapter] of [[2,'half-step'],[3,'high-step']]) {
    await js(`document.querySelector('#site-chapters li:nth-child(${index}) a').focus()`);
    await enter();
    assert.equal(await focus(),'site-heading');
    assert.equal(await js(`new URL(location.href).searchParams.get('chapter')`),chapter);
    assert.ok(await js(`!!document.querySelector('#site-profile') &&
      document.querySelector('#site-chapters a[aria-current]').href.includes('chapter=${chapter}')`));
    assert.equal(await js('ftp.value'),'oops');
    assert.equal(await js(`ftp.getAttribute('aria-invalid')`),'true');
    assert.equal(await text(),invalidMessage);
    assert.equal(await js(`document.getElementById('ftp-error').textContent`),invalidFieldMessage);
    assert.ok(await js(`!document.getElementById('clock-error').hidden &&
      document.getElementById('clock-error').checkVisibility() && ride.hidden &&
      document.getElementById('chapter-summary').textContent === ''`));
    assert.deepEqual(exceptions,[]);
  }
  await js('ftp.select()'); await key('Backspace', 'Backspace', 8);
  assert.match(await text(), /Partly assumed.*220 W \(Robin’s assumption\).*81.26 kg \(entered\)/);
  assert.match(await js(`document.querySelector('#shared-assumptions').textContent`), /Partly assumed.*81.26 kg rider \(entered\).*220 W FTP \(assumed\)/);
  await tab(); await tab(); assert.equal(await focus(), 'clear');
  await enter();
  assert.equal(await text(), example);
  assert.deepEqual(await js('[mass.value, ftp.value, unit.value, effort.value]'), ['', '', 'kg', 'slower']);
  await js(`choices.firstChild.click(); effort.selectedIndex = -1; effort.dispatchEvent(new Event('change'))`);
  assert.match(await text(), /scenario is unavailable/);
  assert.ok(await js(`document.querySelector('#chapter-game').hidden && !bands.children.length`));
  await js(`clear.click()`);
  await distance();
  await cmd('Network.emulateNetworkConditions', {offline:true, latency:0, downloadThroughput:0, uploadThroughput:0});
  await js(`document.getElementById('pace-b').focus()`);
  await select('t',false);
  await tab(); assert.equal(await focus(), 'stop-b');
  await select('1',true);
  assert.match(await js('takeaway.textContent'), /same pace.*15 minutes to Plan B/);
  const movement = Math.round(model.total.slower.movingSeconds / 60);
  assert.match(await js(`document.querySelector('#plan-b').textContent`), new RegExp(`${movement} min moving · ${movement+15} min elapsed`));
  await js('work.parentElement.querySelector("summary").focus()'); await enter();
  assert.ok(await js(`work.checkVisibility()`));
  await tab(); await tab();
  assert.equal(await js('document.activeElement.hash'), '#seek-9000');
  assert.equal(await js('location.href'), url+'?area=explore&view=clock&route=semonzo-example&rev=semonzo-example-v1&chapter=high-step&at=11000');
  assert.deepEqual(await js('[localStorage.length, sessionStorage.length, document.cookie]'), [0, 0, '']);
  const {result:stores} = await cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,
    expression:'Promise.all([indexedDB.databases(),caches.keys(),navigator.serviceWorker.getRegistrations()]).then(xs=>xs.map(x=>x.length))'});
  assert.deepEqual(stores.value,[0,0,0]);
  assert.deepEqual(requests.slice(before), []);
  await cmd('Network.emulateNetworkConditions', {offline:false, latency:0, downloadThroughput:-1, uploadThroughput:-1});
  await enter();
  await until(()=>js(`document.querySelector('#deck')?.hidden === false`));
  assert.equal(await js('location.pathname + location.search + location.hash'), '/kotr27/index.html#seek-9000');
  await until(()=>js('play.disabled'));
  assert.deepEqual(await js(`[seek.value,document.activeElement.id,play.disabled,stats.textContent.startsWith('9.0 km')]`),
    ['9000','site-heading',true,true]);
  missing = true;
  await cmd('Page.navigate', {url});
  await until(async () => (await text()).includes('unavailable'));
  assert.ok(await js(`document.querySelector('#chapter-game').hidden && controls.disabled`));
  assert.deepEqual(exceptions, []);
});
