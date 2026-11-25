import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function until(fn) {
  for (let i=0;i<100;i++) { const v = await fn(); if (v) return v; await sleep(50); }
  assert.fail(`Timed out: ${fn}`);
}

export async function startupPageTarget(cmd) {
  // The isolated profile is launched with about:blank already. Do not create
  // a redundant tab, or attach to an arbitrary worker/extension/page.
  return until(async function startupAboutBlankPage() {
    const {targetInfos} = await cmd('Target.getTargets');
    const pages = targetInfos.filter(t => t.type === 'page' && t.url === 'about:blank');
    assert.ok(pages.length <= 1, 'Ambiguous startup about:blank page targets');
    if (!pages.length) return false;
    assert.ok(typeof pages[0].targetId === 'string' && pages[0].targetId.length > 0,
      'Startup about:blank page has no target ID');
    return pages[0].targetId;
  });
}

export async function browser(t, onEvent = () => {}, {headless = true} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kotr27-test-'));
  const chrome = spawn(process.env.CHROME || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'),
  [...(headless ? ['--headless'] : []),'--disable-background-networking','--disable-extensions','--disable-sync',
    `--user-data-dir=${dir}`, '--remote-debugging-pipe', 'about:blank'], {stdio:['ignore','ignore','pipe','pipe','pipe']});
  chrome.stderr.on('data', data => { if (process.env.DEBUG_CHROME) process.stderr.write(data); });
  // 'close' also waits for every inherited pipe, which need not coincide
  // with the test browser's exit. Never let a stuck GPU/renderer keep a
  // fixture's after hook (and hence the next test) waiting indefinitely.
  const exited = once(chrome, 'exit');
  t.after(async () => {
    chrome.kill();
    const force=setTimeout(()=>chrome.kill('SIGKILL'),3000);
    try { await exited; }
    finally {
      clearTimeout(force);
      for (const pipe of chrome.stdio) pipe?.destroy();
      await rm(dir, {recursive:true, force:true});
    }
  });
  let id = 0, sessionId, incoming = '';
  const pending = new Map(), exceptions = [];
  let disconnected;
  function disconnect() {
    disconnected=Error('Chrome DevTools pipe closed');
    for (const {reject,timer} of pending.values()) { clearTimeout(timer); reject(disconnected); }
    pending.clear();
  }
  chrome.once('exit',disconnect);
  chrome.stdio[4].once('end',disconnect);
  function dispatch(m) {
    onEvent(m, cmd);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (!pending.has(m.id)) return;
    const {resolve,reject,timer} = pending.get(m.id); pending.delete(m.id); clearTimeout(timer);
    if (m.error) reject(Error(m.error.message)); else resolve(m.result);
  }
  chrome.stdio[4].setEncoding('utf8').on('data', chunk => {
    incoming += chunk;
    let end;
    while ((end = incoming.indexOf('\0')) >= 0) {
      dispatch(JSON.parse(incoming.slice(0,end))); incoming = incoming.slice(end + 1);
    }
  });
  function cmd(method, params={}) {
    if (disconnected) return Promise.reject(disconnected);
    return new Promise((resolve,reject) => {
      const key=++id;
      const timer=setTimeout(()=>{
        pending.delete(key); reject(Error(`Chrome did not answer ${method} in 15 s`));
      },15000);
      pending.set(key,{resolve,reject,timer}); chrome.stdio[3].write(JSON.stringify({id:key,method,params,sessionId})+'\0');
    });
  }
  async function js(expression) {
    const r = await cmd('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!r.exceptionDetails,expression); return r.result.value;
  }
  const targetId = await startupPageTarget(cmd);
  ({sessionId} = await cmd('Target.attachToTarget',{targetId,flatten:true}));
  await cmd('Runtime.enable');
  return {cmd, js, exceptions};
}
