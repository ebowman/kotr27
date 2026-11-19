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

export async function browser(t, onEvent = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kotr27-test-'));
  const chrome = spawn(process.env.CHROME || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'),
  ['--headless','--disable-background-networking','--disable-extensions','--disable-sync',
    `--user-data-dir=${dir}`, '--remote-debugging-pipe', 'about:blank'], {stdio:['ignore','ignore','pipe','pipe','pipe']});
  chrome.stderr.on('data', data => { if (process.env.DEBUG_CHROME) process.stderr.write(data); });
  const closed = once(chrome, 'close');
  t.after(async () => { chrome.kill(); await closed; await rm(dir, {recursive:true, force:true}); });
  let id = 0, sessionId, incoming = '';
  const pending = new Map(), exceptions = [];
  function dispatch(m) {
    onEvent(m, cmd);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (!pending.has(m.id)) return;
    const {resolve,reject} = pending.get(m.id); pending.delete(m.id);
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
    return new Promise((resolve,reject) => {
      pending.set(++id,{resolve,reject}); chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
    });
  }
  async function js(expression) {
    const r = await cmd('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!r.exceptionDetails,expression); return r.result.value;
  }
  const {targetId} = await cmd('Target.createTarget',{url:'about:blank'});
  ({sessionId} = await cmd('Target.attachToTarget',{targetId,flatten:true}));
  await cmd('Runtime.enable');
  return {cmd, js, exceptions};
}
