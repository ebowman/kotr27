import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { browser, until } from './browser.mjs';
import { estimateAscent } from '../js/ascent-estimator.mjs';
import { riderScenario } from '../js/rider-scenario.mjs';

const route = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const blank = { mass: '', enteredUnit: 'kg', ftp: '', effort: 'slower' };
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

test('phone controls support private, keyboard-only scenario changes', async t => {
  const files = new Map([['explore.html','text/html'], ['js/rider-controls.mjs','text/javascript'],
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
  await cmd('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
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
  await tab(); await tab();
  assert.equal(await focus(), 'example');
  await enter(); await tab();
  assert.equal(await focus(), 'know-ftp');
  await enter(); assert.equal(await focus(), 'ftp');
  await type('250');
  assert.match(await text(), /Partly assumed.*175 W \(70% of FTP\).*250 W \(entered\).*75 kg \(Robin’s assumption\).*12 kg/);
  // Native controls remain operable without pointer or synthetic change events.
  for (let i = 0; i < 3; i++) await key('Tab', 'Tab', 9, 8); // Shift+Tab
  assert.equal(await focus(), 'effort');
  await key('End', 'End', 35);
  assert.match(await text(), /200 W \(80% of FTP\)/);
  await tab(); assert.equal(await focus(), 'mass');
  await type('81.257');
  const personal = await text();
  assert.match(personal, /your weight and FTP.*81.26 kg \(entered\)/);
  await tab(); assert.equal(await focus(), 'unit');
  await key('End', 'End', 35);
  assert.ok(Math.abs(Number(await js(`mass.value`)) * .45359237 - 81.257) < 1e-8);
  assert.equal(await text(), personal);
  await key('Home', 'Home', 36);
  assert.equal(await js(`mass.value`), '81.257');
  await tab(); assert.equal(await focus(), 'ftp');
  await js('ftp.select()'); await type('oops');
  assert.match(await text(), /^No estimate.*30 to 650/);
  assert.equal(await js(`ftp.getAttribute('aria-invalid')`), 'true');
  await js('ftp.select()'); await key('Backspace', 'Backspace', 8);
  assert.match(await text(), /Partly assumed.*220 W \(Robin’s assumption\).*81.26 kg \(entered\)/);
  await tab(); await tab(); assert.equal(await focus(), 'clear');
  await enter();
  assert.equal(await text(), example);
  assert.deepEqual(await js('[mass.value, ftp.value, unit.value, effort.value]'), ['', '', 'kg', 'slower']);
  assert.equal(await js('location.href'), url);
  assert.deepEqual(await js('[localStorage.length, sessionStorage.length, document.cookie]'), [0, 0, '']);
  assert.deepEqual(requests.slice(before), []);
  assert.deepEqual(exceptions, []);
});
