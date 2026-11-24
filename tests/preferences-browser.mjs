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

function assertRevoked(record, category = 'rider') {
  assert.equal(record[category].consent, 'revoked');
  assert.equal(record[category].value, null);
  assert.equal(record[category].savedAt, null);
}
async function installMessageGate(cmd) {
  await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`
    window.heldPreferenceMessages=[];
    const NativeBroadcastChannel=window.BroadcastChannel;
    window.BroadcastChannel=class extends NativeBroadcastChannel {
      set onmessage(listener) {
        super.onmessage=event=>{
          const deliver=()=>listener.call(this,event);
          if(this.name==='kotr27-preferences' && window.holdPreferenceMessages)
            window.heldPreferenceMessages.push(deliver);
          else deliver();
        };
      }
    };
  `});
}
async function holdFocusRead(js) {
  await js(`{
    window.holdPreferenceMessages=true;
    window.focusReadGate=Promise.withResolvers();
    const databases=IDBFactory.prototype.databases;
    IDBFactory.prototype.databases=function(){
      IDBFactory.prototype.databases=databases;
      window.focusReadEntered=true;
      return databases.call(this).then(async value=>{
        await window.focusReadGate.promise;
        return value;
      });
    };
    window.dispatchEvent(new Event('focus'));
  }`);
  await until(() => js('window.focusReadEntered === true'));
}
async function holdNextStorageOperation(js) {
  await js(`{
    window.holdPreferenceMessages=true;
    window.storageGate=Promise.withResolvers();
    const databases=IDBFactory.prototype.databases;
    IDBFactory.prototype.databases=function(){
      IDBFactory.prototype.databases=databases;
      window.storageEntered=true;
      return databases.call(this).then(async value=>{
        await window.storageGate.promise;
        return value;
      });
    };
  }`);
}

async function fixture(t) {
  const tmp = await mkdtemp(join(tmpdir(), 'kotr-preferences-'));
  t.after(() => rm(tmp, {recursive:true, force:true}));
  const out = join(tmp, 'public');
  await build(fileURLToPath(new URL('../', import.meta.url)), out);
  const files = await readdir(out, {recursive:true});
  const types = {'.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css', '.gpx':'application/xml'};
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({url:req.url, method:req.method});
    const url = new URL(req.url, 'http://localhost'), file = url.pathname.slice('/kotr27/'.length) || 'index.html';
    if (!url.pathname.startsWith('/kotr27/') || !files.includes(file) || !types[extname(file)])
      return res.writeHead(404).end();
    res.writeHead(200, {'Content-Type':types[extname(file)], 'Cache-Control':'no-store'})
      .end(await readFile(join(out, file)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const network = [];
  const b = await browser(t, m => {
    if (m.method === 'Network.requestWillBeSent') network.push(m.params.request);
  });
  const {cmd, js} = b;
  await cmd('Page.enable');
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs', {urls:['https://*']});
  const evaluate = async expression => {
    const result = await cmd('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const base = `http://127.0.0.1:${server.address().port}/kotr27/`;
  const module = files.find(f => f.startsWith('js/preferences-view.'));
  const ready = () => until(() => js(`document.querySelector('#controls')?.disabled === false`));
  const settle = () => evaluate(`import('./${module}').then(async m => { await m.riderState.settled(); return m.riderState.snapshot(); })`);
  const input = (id, value, event = 'input') =>
    js(`{const el=document.getElementById('${id}'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('${event}'));}`);
  const consent = async category => {
    await js(`document.getElementById('remember-${category}').click()`);
    // onchange crosses an await before scheduling its transaction.
    await evaluate('Promise.resolve()');
    return settle();
  };
  const stored = () => evaluate(`new Promise((resolve,reject) => {
    const r=indexedDB.open('kotr27-preferences',2);
    r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{ const db=r.result, tx=db.transaction('settings');
      const q=tx.objectStore('settings').get('current'); q.onsuccess=()=>resolve(q.result);
      tx.oncomplete=()=>db.close(); };
  })`);
  return {...b, evaluate, base, ready, settle, input, consent, stored, network, requests, files};
}

test('packaged opt-in preferences: no default persistence/network, reload, shared consumers, revoke, forget and two tabs', async t => {
  const f = await fixture(t), {cmd, js, evaluate, base, ready, settle, input, consent, stored} = f;
  await cmd('Emulation.setDeviceMetricsOverride', {width:320, height:800, deviceScaleFactor:1, mobile:true});
  await cmd('Page.navigate', {url:base + 'explore.html'});
  await ready();
  await js(`document.getElementById('site-preferences').open=true; personal.open=true; sensitivity.open=true`);
  assert.ok(await js('document.documentElement.scrollWidth <= innerWidth'));
  assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
  await input('unit', 'lb', 'change'); await input('mass', '180.123456700'); await input('ftp', '287');
  await until(() => js(`document.getElementById('sensitivity-baseline').textContent.includes('287 W FTP')`));
  assert.match(await js('result.textContent'), /using your weight and FTP/);
  assert.match(await js(`document.getElementById('shared-assumptions').textContent`), /287 W FTP \(entered\)/);
  assert.match(await js(`document.getElementById('preference-profile').textContent`), /Personal scenario.*supplied.*supplied/);
  assert.deepEqual(await evaluate('indexedDB.databases()'), []);
  assert.deepEqual(await js('[localStorage.length,sessionStorage.length,document.cookie]'), [0,0,'']);
  await cmd('Page.reload'); await ready();
  assert.deepEqual(await js('[mass.value,ftp.value]'), ['',''], 'declining consent loses drafts on reload');
  await input('unit', 'lb', 'change'); await input('mass', '180.123456700'); await input('ftp', '287');
  const baseline = await js('result.textContent');
  await consent('rider');
  assert.equal((await stored()).rider.value.mass, '180.123456700');
  assert.equal((await stored()).preferences, null);
  await input('unit', 'kg', 'change');
  assert.equal(await js('result.textContent'), baseline);
  await cmd('Page.reload'); await ready();
  assert.deepEqual(await js('[mass.value,unit.value,ftp.value]'), ['180.123456700','lb','287']);
  assert.match(await js('result.textContent'), /using your weight and FTP/);
  await input('unit', 'kg', 'change'); await input('effort', 'faster', 'change');
  await consent('preferences');
  let record = await stored();
  assert.deepEqual(Object.keys(record.rider.value).sort(), ['enteredUnit','ftp','mass']);
  assert.deepEqual(Object.keys(record.preferences.value).sort(), ['effort','route','unit']);
  assert.equal(record.preferences.value.unit, 'kg');
  assert.doesNotMatch(record.preferences.value.route, /287|180|mass|ftp/);
  const key = async () => {
    for (const type of ['keyDown','keyUp']) await cmd('Input.dispatchKeyEvent', {
      type, key:' ', code:'Space', windowsVirtualKeyCode:32, ...(type === 'keyDown' && {text:' '}),
    });
  };
  await js(`document.getElementById('site-preferences').open=true; document.getElementById('remember-preferences').focus()`);
  await key(); await settle();
  assertRevoked(await stored(), 'preferences'); // Keyboard can revoke route/UI alone.
  assert.ok((await stored()).rider);
  await key(); await settle();
  assert.ok((await stored()).preferences);
  await cmd('Page.reload'); await ready();
  assert.deepEqual(await js('[unit.value,effort.value,ftp.value]'), ['kg','faster','287']);
  const before = f.network.length;
  await input('ftp', 'oops'); await settle();
  assert.equal((await stored()).rider.value, null);
  assert.ok(await js(`ride.hidden && ftp.getAttribute('aria-invalid') === 'true'`));
  assert.match(await js(`document.getElementById('sensitivity-error').textContent`), /Correct or clear/);
  await input('ftp', '287'); await settle();
  await consent('rider');
  assertRevoked(await stored());
  assert.ok((await stored()).preferences);
  assert.equal(await js('ftp.value'), '287');
  assert.deepEqual(f.network.slice(before), [], 'personal edits, opt-in and revoke make no network request');
  await cmd('Page.reload'); await ready();
  assert.deepEqual(await js('[mass.value,ftp.value,unit.value,effort.value]'), ['','','kg','faster']);
  assert.match(await js('result.textContent'), /fictional example/);
  // Invalid and stale revisions are remembered verbatim, but never substituted.
  await cmd('Page.navigate', {url:base + 'explore.html?area=explore&view=clock&route=semonzo-example&rev='});
  await until(() => js(`document.getElementById('site-notice')?.textContent.includes('revision unavailable')`));
  await settle();
  // Toggle separately to explicitly choose this invalid selection.
  await consent('preferences'); await consent('preferences');
  assert.match((await stored()).preferences.value.route, /rev=(?:&|$)/);
  await cmd('Page.reload');
  await until(() => js(`document.getElementById('site-notice')?.textContent.includes('revision unavailable')`));
  await settle();
  assert.ok(await js(`document.getElementById('legacy-explorer').hidden`));
  assert.match(await js(`document.getElementById('preference-route').getAttribute('href')`), /rev=(?:&|$)/);
  await cmd('Page.navigate', {url:base + 'explore.html'});
  await ready();
  await input('ftp', '319'); await consent('rider');
  await js(`localStorage.setItem('unrelated-app','keep'); sessionStorage.setItem('unrelated-session','keep')`);
  // Same-origin popup is a real second document/tab, not a synthetic event.
  await cmd('Runtime.evaluate', {expression:`window.peer=window.open(${JSON.stringify(base + 'explore.html')});`, userGesture:true});
  await until(() => js(`peer?.document.querySelector('#controls')?.disabled === false`));
  await until(() => js(`!document.getElementById('remember-rider').checked && ftp.value === ''`));
  assert.equal(await js(`peer.document.getElementById('ftp').value`), '319');
  await js(`peer.document.getElementById('preference-forget').click()`);
  await until(() => js(`peer.document.getElementById('preference-status').textContent.includes('All app-owned')`));
  await until(() => js(`document.getElementById('preference-status').textContent.includes('another tab')`));
  await input('ftp', '320'); await settle();
  record = await stored();
  assertRevoked(record); assertRevoked(record, 'preferences');
  await js('peer.close()');
  await js(`document.getElementById('preference-forget').click()`); await settle();
  assert.deepEqual(await js('[mass.value,ftp.value,unit.value,effort.value]'), ['','','kg','slower']);
  assert.equal(await js(`localStorage.getItem('unrelated-app')`), 'keep');
  assert.equal(await js(`sessionStorage.getItem('unrelated-session')`), 'keep');
  await cmd('Page.reload'); await ready();
  assert.match(await js('result.textContent'), /fictional example/);
  assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
  assert.ok(f.requests.every(r => r.method === 'GET'));
  assert.ok(f.network.every(r => r.url.startsWith(base) && !r.postData));
  // Content hashes and ephemeral server ports can coincidentally contain FTP
  // digits. Inspect request query/body, not those non-personal identifiers.
  for (const request of f.network) {
    const url = new URL(request.url);
    assert.ok(f.files.includes(url.pathname.slice('/kotr27/'.length)), 'requests use only allowlisted static assets');
    assert.ok([...url.searchParams.keys()].every(key =>
      ['area','view','day','variant','route','rev','chapter','at','_kotr'].includes(key)));
    assert.ok(![...url.searchParams.keys()].some(key => /mass|ftp|weight|rider/i.test(key)));
    assert.ok(![...url.searchParams.values()].some(value => ['180.123456700','287','319'].includes(value)));
  }
  assert.deepEqual(f.exceptions, []);
});

for (const category of ['all','rider','preferences'])
  test(`packaged two-tab ${category} removal survives a delayed renewal broadcast behind a focus read`, async t => {
    const f = await fixture(t), {cmd, js, base, ready, settle, input, consent, stored} = f;
    await installMessageGate(cmd);
    await cmd('Page.navigate', {url:base + 'explore.html'});
    await ready();
    await input('ftp', '300');
    await consent('rider'); await consent('preferences');
    const before = await stored();
    await holdFocusRead(js);
    // The parent controller's read is pending, but no IDB transaction is held:
    // the real peer can restore and commit a same-grant renewal.
    await cmd('Runtime.evaluate', {
      expression:`window.peer=window.open(${JSON.stringify(base + 'explore.html')});`, userGesture:true,
    });
    await until(() => js(`peer?.document.querySelector('#controls')?.disabled === false`));
    await until(() => js('heldPreferenceMessages.length > 0'));
    assert.equal(await js(`peer.document.getElementById('ftp').value`), '300');
    const renewed = await stored();
    assert.equal(renewed.rider.consentVersion, before.rider.consentVersion);
    assert.ok(renewed.rider.savedAt > before.rider.savedAt);
    const button = category === 'all' ? 'preference-forget' : `remember-${category}`;
    await js(`document.getElementById('${button}').click()`);
    assert.match(await js(`document.getElementById('preference-status').textContent`), /Clearing|Removing/);
    // Deliver the actual peer broadcast only AFTER the explicit removal click,
    // while the read still holds the serial queue. No sleeps or fake messages.
    const delivered = await js(`(()=>{
      const pending=heldPreferenceMessages.splice(0);
      pending.forEach(deliver=>deliver());
      return pending.length;
    })()`);
    assert.ok(delivered > 0);
    assert.match(await js(`document.getElementById('preference-status').textContent`), /Clearing|Removing/);
    await js('focusReadGate.resolve()');
    await settle();
    const removed = await stored();
    for (const key of ['rider','preferences']) {
      if (category === 'all' || category === key) assertRevoked(removed, key);
      else assert.deepEqual(removed[key], renewed[key]);
    }
    assert.match(await js(`document.getElementById('preference-status').textContent`), /removed/);
    assert.deepEqual(await js(`['rider','preferences'].map(key=>document.getElementById('remember-'+key).checked)`),
      [false,false]);
    await until(() => js(`peer.document.getElementById('preference-status').textContent.includes('another tab')`));
    assert.equal(await js(`peer.document.getElementById('ftp').value`), '');
    await js('peer.close()');
    await cmd('Page.reload'); await ready();
    const reloaded = await settle();
    assert.equal(reloaded.consent.rider, category === 'preferences');
    assert.equal(reloaded.consent.preferences, category === 'rider');
    assert.equal(await js('ftp.value'), category === 'preferences' ? '300' : '');
    if (category !== 'preferences') assert.match(await js('result.textContent'), /fictional example/);
    assert.deepEqual(f.exceptions, []);
  });

for (const removed of ['rider','preferences'])
  test(`packaged cross-category redesign prevents resurrection of ${removed} after peer Forget`, async t => {
    const f = await fixture(t), {cmd, js, base, ready, settle, input, consent, stored} = f;
    const other = removed === 'rider' ? 'preferences' : 'rider';
    await installMessageGate(cmd);
    await cmd('Page.navigate', {url:base + 'explore.html'});
    await ready();
    await input('ftp', '300');
    await consent('rider'); await consent('preferences');
    await holdFocusRead(js);
    await cmd('Runtime.evaluate', {
      expression:`window.peer=window.open(${JSON.stringify(base + 'explore.html')});`, userGesture:true,
    });
    await until(() => js(`peer?.document.querySelector('#controls')?.disabled === false`));
    await until(() => js('heldPreferenceMessages.length > 0'));
    assert.equal(await js(`peer.document.getElementById('ftp').value`), '300');
    await js(`peer.document.getElementById('preference-forget').click()`);
    await until(() => js(`peer.document.getElementById('preference-status').textContent.includes('All app-owned')`));
    const forgotten = await stored();
    assertRevoked(forgotten); assertRevoked(forgotten, 'preferences');
    // Neither the old focus read nor any real peer broadcasts have completed
    // in A. A still has stale rider/UI authority when it revokes only X.
    await js(`document.getElementById('remember-${other}').click()`);
    await js('focusReadGate.resolve()');
    await settle();
    assert.equal((await stored())[removed].consentVersion, forgotten[removed].consentVersion);
    // Exact reviewer reproduction, plus an edit to the protected category.
    await input('effort', 'faster', 'change'); await settle();
    assertRevoked(await stored(), removed);
    if (removed === 'rider') await input('ftp', '301');
    else await input('unit', 'lb', 'change');
    await settle();
    assertRevoked(await stored(), removed);
    assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
    const delivered = await js(`(()=>{
      const pending=heldPreferenceMessages.splice(0);
      pending.forEach(deliver=>deliver()); return pending.length;
    })()`);
    assert.ok(delivered > 0, 'real delayed peer messages were delivered, not synthesized');
    await js('peer.close()');
    await cmd('Page.reload'); await ready();
    assert.equal(await js('ftp.value'), '');
    assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
    await input('ftp', '303'); await input('unit', 'lb', 'change');
    assertRevoked(await stored(), removed, 'ordinary new entries cannot regrant consent');
    await consent(removed); // A fresh user choice against the reviewed category marker.
    assert.equal((await stored())[removed].consent, 'granted');
    assert.notEqual((await stored())[removed].consentVersion, forgotten[removed].consentVersion);
    assertRevoked(await stored(), other);
    await cmd('Page.reload'); await ready();
    const fresh = await settle();
    assert.equal(fresh.consent[removed], true);
    assert.equal(fresh.consent[other], false);
    assert.equal(await js('ftp.value'), removed === 'rider' ? '303' : '');
    assert.ok(f.network.every(request => request.url.startsWith(base) && !request.postData));
    assert.deepEqual(f.exceptions, []);
  });

for (const category of ['rider','preferences']) for (const fault of ['none','discovery','cleanup'])
  test(`packaged consent recovery for ${category} after superseded discovery: ${fault}`, async t => {
    const f = await fixture(t), {cmd, js, evaluate, base, ready, settle, input, consent, stored} = f;
    await cmd('Page.navigate', {url:base + 'explore.html'});
    await ready();
    await input('ftp', '311'); await input('effort', 'faster', 'change');
    await consent('rider'); await consent('preferences');
    const previous = await stored();
    const {identifier} = await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`
      window.discoveryGate=Promise.withResolvers();
      const databases=IDBFactory.prototype.databases;
      IDBFactory.prototype.databases=function(){
        IDBFactory.prototype.databases=databases;
        window.discoveryEntered=true;
        return databases.call(this).then(async value=>{
          await discoveryGate.promise;
          if(${fault === 'discovery'}) throw new DOMException('Discovery denied','SecurityError');
          return value;
        });
      };
      window.denyCleanup=${fault === 'cleanup'};
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,...args){
        const request=put.call(this,value,...args);
        if(denyCleanup && this.name==='settings' && args[0]==='current' &&
          value.rider?.consent==='revoked' && value.preferences?.consent==='revoked')
          this.transaction.abort();
        return request;
      };
    `});
    await cmd('Page.reload');
    await until(() => js(`window.discoveryEntered && !!document.getElementById('preference-forget')`));
    const module = f.files.find(file => file.startsWith('js/preferences-view.'));
    await evaluate(`import('./${module}').then(m=>{
      window.controller=m.riderState;
      window.recoveryStatuses=[];
      controller.subscribe(state=>recoveryStatuses.push(state.status));
    })`);
    await js(`document.getElementById('preference-forget').click();
      void (window.prematureConsent=controller.remember('${category}',true))`);
    assert.deepEqual((await js('controller.snapshot()')).consent, {rider:false, preferences:false});
    await js('discoveryGate.resolve()');
    await evaluate('Promise.all([controller.ready,controller.settled(),prematureConsent])');
    await cmd('Page.removeScriptToEvaluateOnNewDocument', {identifier});
    await ready();
    assert.equal((await settle()).input.ftp, '', 'superseded discovery cannot restore the old FTP');
    assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
    await evaluate('controller.check()');
    if (fault === 'discovery')
      assert.ok(await js(`recoveryStatuses.some(status=>/Device storage unavailable.*SecurityError/.test(status))`));
    if (fault === 'cleanup') {
      await evaluate(`controller.remember('${category}',true)`);
      assert.match((await settle()).status, /transaction failed.*Stored data may remain/);
      assert.equal((await settle()).usable, false);
      assert.deepEqual(await stored(), previous, 'aborted cleanup leaves the original grants, not a false deletion');
      await js(`window.denyCleanup=false; document.getElementById('preference-forget').click()`);
      await settle(); // A second deliberate Forget, never an automatic retry.
    }
    const removed = await stored();
    assertRevoked(removed, 'rider'); assertRevoked(removed, 'preferences');
    await input('ftp', '312'); await input('effort', 'faster', 'change');
    assert.deepEqual(await stored(), removed, 'ordinary input does not regrant consent');
    await consent(category);
    assert.equal((await settle()).consent[category], true, 'fresh checkbox consent recovers without reload');
    const other = category === 'rider' ? 'preferences' : 'rider';
    assertRevoked(await stored(), other);
    assert.notEqual((await stored())[category].consentVersion, removed[category].consentVersion);
    await cmd('Page.reload'); await ready();
    const restored = await settle();
    assert.equal(restored.consent[category], true);
    assert.equal(restored.consent[other], false);
    assert.equal(restored.input.ftp, category === 'rider' ? '312' : '');
    assert.ok(f.network.every(request => request.url.startsWith(base) && !request.postData));
    assert.deepEqual(f.exceptions, []);
  });

for (const category of ['rider','preferences']) for (const denied of [false,true])
  test(`packaged first ${category} grant then direct revocation: cleanup ${denied ? 'aborts honestly' : 'wins'}`, async t => {
    const f = await fixture(t), {cmd, js, evaluate, base, ready, settle, input, stored} = f;
    await cmd('Page.navigate', {url:base + 'explore.html'});
    await ready();
    await input('ftp', '311');
    await input('unit', 'lb', 'change'); await input('effort', 'faster', 'change');
    assert.deepEqual(await evaluate('indexedDB.databases()'), [], 'untouched consent/drafts create no database');
    const module = f.files.find(file => file.startsWith('js/preferences-view.'));
    await evaluate(`import('./${module}').then(m=>{
      window.controller=m.riderState;
      window.preferenceStatuses=[];
      controller.subscribe(state=>preferenceStatuses.push(state.status));
    })`);
    await js(`{
      window.firstGrantWrites=[];
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,...args){
        const request=put.call(this,value,...args);
        if(this.name==='settings' && args[0]==='current'){
          const consent=value[${JSON.stringify(category)}].consent;
          firstGrantWrites.push(consent);
          if(${denied} && consent==='revoked') this.transaction.abort();
        }
        return request;
      };
    }`);
    await holdNextStorageOperation(js);
    // Exercise the controller contract directly, not the checkbox's current
    // checked/disabled state. The first grant is held before its IDB transaction.
    await js(`void (window.grantResult=controller.remember('${category}',true))`);
    await until(() => js('window.storageEntered === true'));
    await js(`void (window.revokeResult=controller.remember('${category}',false));
      window.removalStatusStart=preferenceStatuses.length-1`);
    assert.match(await js(`document.getElementById('preference-status').textContent`), /Removing remembered/);
    assert.deepEqual((await js('controller.snapshot()')).consent, {rider:false, preferences:false});
    await js('storageGate.resolve()');
    await evaluate('Promise.all([grantResult,revokeResult])');
    const state = await settle(), record = await stored();
    assert.deepEqual(await js('firstGrantWrites'), ['granted','revoked'],
      'the explicit removal transaction follows the potentially committing first grant');
    assert.deepEqual(state.consent, {rider:false, preferences:false});
    assert.equal(record[category === 'rider' ? 'preferences' : 'rider'], null, 'category isolation is unchanged');
    assert.ok(await js(`!preferenceStatuses.slice(removalStatusStart).some(
      status=>/Nothing is saved|Chosen settings saved/.test(status))`));
    if (denied) {
      assert.equal(record[category].consent, 'granted', 'aborted cleanup really leaves the first grant stored');
      if (category === 'rider') assert.equal(record.rider.value.ftp, '311');
      else assert.equal(record.preferences.value.effort, 'faster');
      assert.match(state.status, /transaction failed.*Stored data may remain/);
      await js('controller.externalChange()');
      assert.match(await js(`document.getElementById('preference-status').textContent`), /transaction failed.*Stored data may remain/);
    } else {
      assertRevoked(record, category);
      assert.match(state.status, /consent revoked.*removed/);
      await input('ftp', '312'); await input('effort', 'slower', 'change');
      assert.deepEqual(await stored(), record, 'ordinary actions after removal cannot regrant consent');
    }
    await cmd('Page.reload'); await ready();
    assert.equal((await settle()).consent[category], denied);
    assert.equal(await js('ftp.value'), denied && category === 'rider' ? '311' : '');
    assert.deepEqual(f.exceptions, []);
  });

for (const category of ['rider','preferences']) for (const kind of ['save','grant'])
  test(`packaged queued ${category} ${kind} cannot pass peer revocation`, async t => {
    const f = await fixture(t), {cmd, js, base, ready, settle, input, consent, stored} = f;
    await installMessageGate(cmd);
    await cmd('Page.navigate', {url:base + 'explore.html'});
    await ready();
    await input('ftp', '300'); await consent('rider'); await consent('preferences');
    if (kind === 'grant') await consent(category);
    await holdNextStorageOperation(js);
    if (kind === 'save') {
      if (category === 'rider') await input('ftp', '301');
      else await input('effort', 'faster', 'change');
    } else {
      // An explicit grant already queued with an old observed version is not
      // "fresh consent" to override a subsequent revocation.
      await js(`document.getElementById('remember-${category}').click()`);
    }
    await until(() => js('window.storageEntered === true'));
    await cmd('Runtime.evaluate', {
      expression:`window.peer=window.open(${JSON.stringify(base + 'explore.html')});`, userGesture:true,
    });
    await until(() => js(`peer?.document.querySelector('#controls')?.disabled === false`));
    await until(() => js('heldPreferenceMessages.length > 0'));
    await js(`peer.document.getElementById('${kind === 'grant' ? 'preference-forget' : 'remember-' + category}').click()`);
    await until(() => js(`peer.document.getElementById('preference-status').textContent.includes('${kind === 'grant' ? 'All app-owned' : 'consent revoked'}')`));
    const removed = await stored();
    assertRevoked(removed, category);
    await js('storageGate.resolve()');
    await settle();
    assertRevoked(await stored(), category);
    assert.match(await js(`document.getElementById('preference-status').textContent`), /Consent changed or expired/);
    assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
    assert.equal((await stored())[category].consentVersion, removed[category].consentVersion);
    await js('heldPreferenceMessages.splice(0).forEach(deliver=>deliver());peer.close()');
    await cmd('Page.reload'); await ready();
    assert.equal((await settle()).consent[category], false);
    assert.deepEqual(f.exceptions, []);
  });

test('packaged delayed restore renewal cannot recreate either category after peer Forget', async t => {
  const f = await fixture(t), {cmd, js, base, ready, settle, input, consent, stored} = f;
  await installMessageGate(cmd);
  await cmd('Page.navigate', {url:base + 'explore.html'});
  await ready();
  await input('ftp', '300'); await consent('rider'); await consent('preferences');
  await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`
    window.holdPreferenceMessages=true;
    window.renewalGate=Promise.withResolvers();
    const databases=IDBFactory.prototype.databases;
    let openings=0;
    IDBFactory.prototype.databases=function(){
      if(++openings !== 2) return databases.call(this);
      IDBFactory.prototype.databases=databases;
      window.renewalEntered=true;
      return databases.call(this).then(async value=>{await renewalGate.promise;return value});
    };
  `});
  await cmd('Page.reload');
  await until(() => js('window.renewalEntered === true'));
  await cmd('Runtime.evaluate', {
    expression:`window.peer=window.open(${JSON.stringify(base + 'explore.html')});`, userGesture:true,
  });
  await until(() => js(`peer?.document.querySelector('#controls')?.disabled === false`));
  await until(() => js('heldPreferenceMessages.length > 0'));
  await js(`peer.document.getElementById('preference-forget').click()`);
  await until(() => js(`peer.document.getElementById('preference-status').textContent.includes('All app-owned')`));
  const removed = await stored();
  assertRevoked(removed); assertRevoked(removed, 'preferences');
  await js('renewalGate.resolve()');
  await ready(); await settle();
  assert.deepEqual(await stored(), removed, 'late initial renewal cannot rewrite deleted payloads or markers');
  assert.deepEqual((await settle()).consent, {rider:false, preferences:false});
  assert.equal(await js('ftp.value'), '');
  await js('heldPreferenceMessages.splice(0).forEach(deliver=>deliver());peer.close()');
  assert.deepEqual(f.exceptions, []);
});

for (const mode of ['blocked','open-blocked','corrupt','legacy','future','expired','write-error','delete-error','delete-abort','messaging-blocked'])
  test(`packaged ${mode} storage: explicit status and usable anonymous fallback`, async t => {
    const f = await fixture(t), {cmd, js, evaluate, base, ready, settle, input, consent, stored} = f;
    if (mode === 'blocked') await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`
      Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Denied','SecurityError')}});`});
    if (mode === 'open-blocked') await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`
      IDBFactory.prototype.open=function(){throw new DOMException('Denied','SecurityError')};`});
    if (mode === 'messaging-blocked') await cmd('Page.addScriptToEvaluateOnNewDocument', {source:`
      window.BroadcastChannel=class {constructor(){throw new DOMException('Denied','SecurityError')}};`});
    await cmd('Page.navigate', {url:base + 'explore.html'});
    await ready();
    if (mode === 'blocked') assert.equal(await js(`(()=>{try{void indexedDB;return false}catch(e){return e.name==='SecurityError'}})()`), true);
    if (mode === 'open-blocked') {
      assert.deepEqual(await evaluate('indexedDB.databases()'), []);
      await consent('rider');
    }
    if (['corrupt','legacy','future','expired'].includes(mode)) {
      await evaluate(`new Promise((resolve,reject) => {
        const r=indexedDB.open('kotr27-preferences',${mode === 'legacy' ? 1 : 2});
        r.onupgradeneeded=()=>r.result.createObjectStore('settings');
        r.onerror=()=>reject(r.error);
        r.onsuccess=()=>{const db=r.result,tx=db.transaction('settings','readwrite');
          tx.objectStore('settings').put({
            version:${mode === 'future' ? 99 : mode === 'legacy' ? 1 : 2}, preferences:null,
            rider:{consentVersion:'fixture-rider',consent:'granted',savedAt:Date.now()-${mode === 'expired' ? 91 * 86400000 : 1000},
              value:{mass:${JSON.stringify(mode === 'corrupt' ? 'invalid' : '81')},enteredUnit:'kg',ftp:'250'}}
          },'current'); tx.oncomplete=()=>{db.close();resolve()}; tx.onerror=()=>reject(tx.error);};
      })`);
      await cmd('Page.reload'); await ready();
    }
    if (['write-error','delete-error','delete-abort'].includes(mode)) {
      await input('ftp', '299');
      if (mode !== 'write-error') await consent('rider');
      if (mode === 'delete-abort') await js(`{
        const put=IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);this.transaction.abort();return request};
      }`);
      else await js(`IDBObjectStore.prototype.clear=function(){throw new DOMException('Denied','QuotaExceededError')}`);
      if (mode === 'write-error') await consent('rider');
      else { await js(`document.getElementById('preference-forget').click()`); await settle(); }
    }
    const state = await settle();
    assert.match(state.status, {
      blocked:/storage unavailable/, corrupt:/Corrupt rider/, legacy:/Unsupported settings version/, future:/Unsupported settings version/,
      'open-blocked':/storage could not open.*Stored data may remain/,
      expired:/expired/, 'write-error':/transaction unavailable.*Stored data may remain/,
      'delete-error':/transaction unavailable.*Stored data may remain/,
      'delete-abort':/transaction failed.*Stored data may remain/,
      'messaging-blocked':/Memory only/,
    }[mode]);
    assert.deepEqual(state.consent, {rider:false, preferences:false});
    if (mode !== 'write-error') assert.match(await js('result.textContent'), /fictional example/);
    await input('ftp', '240');
    assert.match(await js('result.textContent'), /Partly assumed.*240 W \(entered\)/);
    assert.equal(await js(`document.getElementById('ftp-error').textContent`), '');
    if (['delete-error','delete-abort'].includes(mode)) assert.equal((await stored()).rider.value.ftp, '299', 'failed delete never falsely claims erasure');
    if (mode === 'expired') assertRevoked(await stored());
    if (mode === 'messaging-blocked') {
      assert.equal(await js(`document.getElementById('preference-cross-tab').hidden`), false);
      assert.deepEqual(await evaluate('indexedDB.databases()'), []);
      await js(`document.getElementById('preference-forget').click()`); await settle();
      assert.ok((await evaluate('indexedDB.databases()')).some(db => db.name === 'kotr27-preferences'),
        'explicit Forget before first save leaves category revocation markers to defeat delayed grants');
      assertRevoked(await stored());
      await input('ftp', '240');
      await consent('rider');
      assert.equal((await stored()).rider.value.ftp, '240');
      // Simulate another tab's removal without a notification; focus reads the
      // tombstone, and stale writers are separately exercised by unit tests.
      await evaluate(`new Promise(resolve => {
        const r=indexedDB.open('kotr27-preferences',2);
        r.onsuccess=()=>{const db=r.result,tx=db.transaction('settings','readwrite');
          tx.objectStore('settings').put({version:2,
            rider:{consentVersion:'external-rider-delete',consent:'revoked',savedAt:null,value:null},
            preferences:{consentVersion:'external-ui-delete',consent:'revoked',savedAt:null,value:null}},'current');
          tx.oncomplete=()=>{db.close();resolve()};};
      })`);
      await js(`window.dispatchEvent(new Event('focus'))`); await settle();
      assert.equal(await js('ftp.value'), '');
      assert.match(await js(`document.getElementById('preference-status').textContent`), /another tab/);
    }
    if (mode === 'legacy') {
      assert.equal(await evaluate(`new Promise(resolve=>{
        const r=indexedDB.open('kotr27-preferences',1);
        r.onerror=()=>resolve(r.error.name);
        r.onsuccess=()=>{r.result.close();resolve('unexpected legacy writer access')};
      })`), 'VersionError', 'schema-1 writers cannot reopen after the database-version fence');
    }
    if (['corrupt','legacy','future'].includes(mode)) {
      await js(`document.getElementById('preference-forget').click()`); await settle();
      assertRevoked(await stored());
      await cmd('Page.reload'); await ready();
      assert.match(await js('result.textContent'), /fictional example/);
    }
    assert.deepEqual(f.exceptions, []);
  });
