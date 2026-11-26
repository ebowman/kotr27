// Loopback-only, finite allowlist. Never serve a repository directory.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const prototype = 'prototypes/rider-first/';
const modules = ['route-analysis-loader.mjs','route-analysis.mjs','route-catalog.mjs',
  'route-pack-contract.mjs','route-terrain-view.mjs','route-flyover.mjs','config.js',
  'ride-simulation.mjs','ride-insights.mjs','ride-comparison.mjs','ascent-estimator.mjs','route-time.mjs','ride-clock.mjs','rider-scenario.mjs',
  'ride-relive.mjs','local-routes-view.mjs','local-route-import.mjs','local-route-storage.mjs',
  'local-route-parser.mjs','local-route-worker.mjs','recorded-replay.mjs','route-playback.mjs','route-briefing.mjs'];
export async function previewServer(port = 4177) {
  const physical = await realpath(root);
  const pointer = JSON.parse(await readFile(resolve(root, 'assets/route-pack.json')));
  if (!/^assets\/route-manifest-[a-f0-9]{64}\.json$/.test(pointer.path)) throw Error('Unexpected public pack');
  const pack = JSON.parse(await readFile(resolve(root, pointer.path)));
  const allowed = new Set([
    ...['index.html','app.mjs','style.css'].map(p => prototype+p),
    ...modules.map(p => 'js/'+p), 'assets/terrain.js', 'assets/route-pack.json', pointer.path,
  ]);
  for (const route of pack.catalog.routes) {
    if (route.rights?.redistribution !== 'approved') throw Error('Route not cleared');
    for (const revision of route.revisions) {
      if (revision.rights?.redistribution !== 'approved') throw Error('Revision not cleared');
      for (const asset of [revision.geometry, revision.profile, ...revision.downloads]) {
        if (!/^assets\/route-(?:profile-)?[a-f0-9]{64}\.(?:json|gpx)$/.test(asset.path)) throw Error('Unexpected public asset');
        allowed.add(asset.path);
      }
    }
  }
  const types = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript',
    '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  const server = createServer(async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
      // Reject foreign Host headers; do not make a local file oracle for rebinding.
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) {res.writeHead(403).end();return;}
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pathname === '/') {res.writeHead(302,{Location:'/'+prototype}).end();return;}
      const path = pathname === '/'+prototype ? prototype+'index.html' : pathname.slice(1);
      if (!allowed.has(path)) {res.writeHead(404).end('Not in the public preview');return;}
      const file = await realpath(resolve(root,path));
      if (file !== resolve(physical,path)) {res.writeHead(403).end();return;}
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type':types[extname(path)], 'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self'; script-src 'self' https://api.mapbox.com; style-src 'self' 'unsafe-inline' https://api.mapbox.com; img-src 'self' data: blob: https://*.mapbox.com; connect-src 'self' https://*.mapbox.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {res.writeHead(500).end('Preview asset unavailable');}
  });
  await new Promise((ok,no) => {server.once('error',no);server.listen(port,'127.0.0.1',ok);});
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] || 4177);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Use an unprivileged port');
  const server = await previewServer(port);
  console.log(`Rider-first preview: http://127.0.0.1:${port}/prototypes/rider-first/ (Ctrl-C to stop)`);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.close();server.closeAllConnections();
  });
}
