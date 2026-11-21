import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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

test('phone reveal and controls support private, keyboard-only scenario changes', async t => {
  const files = new Map([['explore.html','text/html'], ['js/rider-controls.mjs','text/javascript'],
    ['js/chapter-reveal.mjs','text/javascript'], ['js/plan-comparison.mjs','text/javascript'],
    ['index.html','text/html'], ['assets/flyover.js','text/javascript'], ['assets/semonzo.gpx','application/xml'],
    ['js/rider-scenario.mjs','text/javascript'], ['js/ascent-estimator.mjs','text/javascript'],
    ['assets/semonzo-chapters.v1.json','application/json']]);
  const server = createServer(async (req, res) => {
    const file = req.url.slice(1);
    if (!files.has(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': files.get(file) })
      .end(await readFile(new URL('../' + file, import.meta.url)));
  });
  server.listen(0,'127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const requests = [];
  const { cmd, js, exceptions } = await browser(t, m => {
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  const url = `http://127.0.0.1:${server.address().port}/explore.html`;
  await cmd('Network.enable');
  await cmd('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion', value:'reduce'}] });
  const resize = width => cmd('Emulation.setDeviceMetricsOverride', { width, height:640, deviceScaleFactor:1, mobile:true });
  await resize(320);
  await cmd('Page.navigate', { url });
  await until(() => js(`document.querySelector('#controls')?.disabled === false`));
  const before = requests.length;
  const text = () => js(`document.querySelector('#result').textContent`);
  const focus = () => js(`document.activeElement.id`);
  const key = async (key, code, n, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cmd('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: n,
        ...(key === 'Enter' && type === 'keyDown' && { text: '\r' }) });
  };
  const tab = () => key('Tab','Tab',9), enter = () => key('Enter','Enter',13);
  const type = text => cmd('Input.insertText', { text });
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
    t.diagnostic(`320px: ${a} → ${b}: ${(second[2]-first[3]).toFixed(1)}px between text rectangles`);
  }
  reportGap(await distance(), '10 km', '15 km');
  assert.ok(await js('revealed.hidden'));
  await tab(); await tab(); await tab(); await tab(); // flyover link, then chapters 1–3
  assert.match(await js('document.activeElement.textContent'), /High step/);
  await enter(); await time();
  assert.ok(await js('!revealed.hidden && document.getAnimations().length === 0'));
  assert.match(await js('insight.textContent'), /Your pick: High step.*Long lift.*9 km.*steeper 2.5 km of High step/);
  const list = (await chart()).list;
  assert.match(list[0], /Long lift.*8.6%.*80 min \(range 71–80 min\).*49%/);
  assert.match(list[2], /High step.*10.9%.*28 min \(range 24–28 min\).*17%/);
  await tab(); await tab(); await enter(); await distance();
  await tab(); await enter(); await time();
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  await tab();
  assert.equal(await focus(), 'example');
  await enter(); await tab();
  assert.equal(await focus(), 'know-ftp');
  await enter(); assert.equal(await focus(), 'ftp');
  await type('190');
  await js(`choices.firstChild.click()`);
  const at190 = riderScenario(route, {...blank, ftp:'190'}).estimate;
  reportGap(await time(at190), '100 min', '150 min');
  for (const width of [240, 800, 320]) {
    await resize(width);
    await js(`window.settled=false; requestAnimationFrame(()=>requestAnimationFrame(()=>window.settled=true))`);
    await until(()=>js('window.settled'));
    await time(at190); // same revealed chart, no redraw from user input
  }
  await js('ftp.select()'); await type('30'); await js('choices.firstChild.click()');
  await time(riderScenario(route, {...blank, ftp:'30'}).estimate);
  await js('ftp.select()');
  await type('250');
  assert.ok(await js(`revealed.hidden && insight.textContent === ''`));
  await js(`choices.firstChild.click()`);
  assert.match((await chart()).list[0], /71 min \(range 62–71 min\)/);
  assert.match(await text(), /Partly assumed.*175 W \(70% of FTP\).*250 W \(entered\).*75 kg \(Robin’s assumption\).*12 kg/);
  // Native controls remain operable without pointer or synthetic change events.
  for (let i = 0; i < 3; i++) await key('Tab', 'Tab', 9, 8); // Shift+Tab
  assert.equal(await focus(), 'effort');
  await key('End', 'End', 35);
  assert.match(await text(), /200 W \(80% of FTP\)/);
  await js(`choices.firstChild.click()`);
  assert.match((await chart()).list[0], /62 min \(range 62–71 min\)/);
  await tab(); assert.equal(await focus(), 'mass');
  await type('81.257');
  const personal = await text();
  assert.match(personal, /your weight and FTP.*81.26 kg \(entered\)/);
  assert.match(await js(`document.querySelector('#shared-assumptions').textContent`), /Your weight and FTP.*81.26 kg rider \(entered\).*250 W FTP \(entered\)/);
  await tab(); assert.equal(await focus(), 'unit');
  await key('End', 'End', 35);
  assert.ok(Math.abs(Number(await js(`mass.value`)) * .45359237 - 81.257) < 1e-8);
  assert.equal(await text(), personal);
  await key('Home', 'Home', 36);
  assert.equal(await js(`mass.value`), '81.257');
  await tab(); assert.equal(await focus(), 'ftp');
  await js('ftp.select()'); await type('oops');
  assert.match(await text(), /^No estimate.*30 to 650/);
  assert.ok(await js(`comparison.hidden && !document.querySelector('#plan-b').textContent`));
  assert.ok(await js(`document.querySelector('#chapter-game').hidden && !bands.children.length && !readout.children.length && !insight.textContent`));
  assert.equal(await js(`ftp.getAttribute('aria-invalid')`), 'true');
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
  await tab(); assert.equal(await focus(), 'pace-b');
  await key('Home', 'Home', 36);
  await tab(); assert.equal(await focus(), 'stop-b');
  await key('End', 'End', 35);
  assert.match(await js('takeaway.textContent'), /same pace.*15 minutes to Plan B/);
  const movement = Math.round(model.total.slower.movingSeconds / 60);
  assert.match(await js(`document.querySelector('#plan-b').textContent`), new RegExp(`${movement} min moving · ${movement+15} min elapsed`));
  await tab(); await enter();
  assert.ok(await js(`work.checkVisibility()`));
  await tab(); await tab();
  assert.equal(await js('document.activeElement.hash'), '#seek-9000');
  assert.equal(await js('location.href'), url);
  assert.deepEqual(await js('[localStorage.length, sessionStorage.length, document.cookie]'), [0, 0, '']);
  assert.deepEqual(requests.slice(before), []);
  await cmd('Network.emulateNetworkConditions', {offline:false, latency:0, downloadThroughput:-1, uploadThroughput:-1});
  await enter();
  await until(()=>js(`document.querySelector('#deck')?.hidden === false`));
  assert.equal(await js('location.pathname + location.search + location.hash'), '/index.html#seek-9000');
  assert.deepEqual(await js(`[seek.value,document.activeElement.id,play.disabled,stats.textContent.startsWith('9.0 km')]`),
    ['9000','seek',true,true]);
  files.delete('assets/semonzo-chapters.v1.json');
  await cmd('Page.navigate', {url});
  await until(async () => (await text()).includes('unavailable'));
  assert.ok(await js(`document.querySelector('#chapter-game').hidden && controls.disabled`));
  assert.deepEqual(exceptions, []);
});
