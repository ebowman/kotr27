import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';

test('ordinary warm Pages URL switches releases; unchanged and failed probes stay put', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'kotr-release-'));
  t.after(() => rm(tmp, {recursive:true, force:true}));
  const src = join(tmp, 'source');
  await mkdir(join(src, 'js'), {recursive:true});
  await cp(new URL('../assets/', import.meta.url), join(src, 'assets'), {recursive:true});
  await cp(new URL('../index.html', import.meta.url), join(src, 'index.html'));
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
  await build(src, b);
  await build(src, repeat);
  const files = dir => readdir(dir, {recursive:true});
  assert.deepEqual((await files(b)).sort(), (await files(repeat)).sort());
  for (const name of await files(b)) {
    if (['assets','js'].includes(name)) continue;
    assert.deepEqual(await readFile(join(b, name)), await readFile(join(repeat, name)));
  }
  const names = await files(a);
  assert.equal(names.length, 8); // two directories, four assets, entry, .nojekyll
  assert.ok(!names.some(n=>/relief|\.svg$|\.webp$/.test(n)));
  assert.doesNotMatch(await readFile(join(a,'index.html'),'utf8'), /grappa-relief|ascent\.svg|relief-beacon/);
  assert.ok(!names.includes('assets/private.txt'));
  const bNames = new Set(await files(b));
  assert.deepEqual(names.filter(n => !bNames.has(n)).sort(), names.filter(n =>
    /assets\/(?:flyover|semonzo)\./.test(n)).sort());
  let live = a, fail = false, probes = 0, plainNavigations = 0, replacements = 0;
  const legacyRequests=[];
  const allowed = new Set([...names, ...bNames].filter(n => extname(n)));
  const types = {'.html':'text/html','.js':'text/javascript','.gpx':'application/xml',
    '.svg':'image/svg+xml','.webp':'image/webp'};
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
  const {cmd, js, exceptions} = await browser(t);
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs', {urls:['https://*']});
  const base = `http://127.0.0.1:${server.address().port}`;
  const visit = async (offline = false) => {
    await cmd('Page.navigate', {url:base+'/away'});
    await until(() => js(`!!document.querySelector('a[href="/kotr27/"]')`));
    if (offline) await cmd('Network.emulateNetworkConditions', {
      offline:true, latency:0, downloadThroughput:0, uploadThroughput:0
    });
    await js(`document.querySelector('a').click()`);
    await until(() => js(`document.querySelector('#deck')?.hidden === false`));
  };
  const summit = async () => {
    await js(`seek.value = seek.max; seek.dispatchEvent(new Event('input'))`);
    return js('stats.textContent');
  };
  await visit(); await until(() => probes === 1);
  assert.match(await summit(), /1746 m elevation/);
  live = b;
  await visit();
  await until(() => js(`document.title.startsWith('B:') && document.querySelector('#deck')?.hidden === false`));
  assert.equal(await js('location.href'), base+'/kotr27/');
  assert.match(await summit(), /1846 m elevation/);
  assert.equal(plainNavigations, 1, 'return started from cached ordinary HTML');
  assert.equal(replacements, 1);
  const before = probes;
  await visit(); await until(() => probes > before);
  assert.match(await summit(), /1846 m elevation/);
  fail = true;
  const last = probes;
  await visit(); await until(() => probes > last);
  assert.match(await summit(), /1846 m elevation/);
  await visit(true);
  assert.match(await summit(), /1846 m elevation/);
  assert.equal(replacements, 1);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(legacyRequests,[]);
});
