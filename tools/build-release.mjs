// Node 22+, no dependencies. Only these explicitly public inputs may ship.
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoutePack } from './route-pack.mjs';
import { canonical, validateOfflineManifest, offlineRouteInventory } from '../js/offline-contract.mjs';

const digest = data => createHash('sha256').update(data).digest('hex').slice(0, 24);
function replace(text, from, to) {
  if (!text.includes(from)) throw new Error(`Missing release reference: ${from}`);
  return text.replaceAll(from, () => to);
}

export async function build(source, destination) {
  // Refuse existing trees (no mixing releases) and keep artifacts out of source.
  const root = await realpath(source);
  // Validate source catalog and pinned bytes before writing any public output.
  // No discovery or recursive route intake: only the explicit verified pack.
  const routePack = await readRoutePack(root);
  const target = join(await realpath(dirname(resolve(destination))), basename(resolve(destination)));
  const rel = relative(root, target);
  if (!rel || !(rel === '..' || rel.startsWith('..' + sep))) throw Error('Output must be outside source');
  async function requireAbsent() {
    try { await lstat(target); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw Error('Output already exists; never mix releases');
  }
  await requireAbsent();
  // Build privately next to the destination and expose only a complete tree.
  const out = await mkdtemp(join(dirname(target), '.kotr-release-'));
  try {
    await writeRelease(root, out, routePack);
    await requireAbsent();
    await rename(out, target);
  } catch (error) {
    await rm(out, {recursive:true, force:true});
    throw error;
  }
}

async function writeRelease(root, out, routePack) {
  // Immutable content-addressed route assets already contain their full hashes.
  // The pointer is itself hashed; HTML binds the entire transitive graph.
  for (const [path, bytes] of routePack.files) {
    await mkdir(join(out, dirname(path)), {recursive:true});
    await writeFile(join(out, path), bytes);
  }
  const packEntry = `assets/route-pack.${digest(routePack.pointerBytes)}.json`;
  await writeFile(join(out, packEntry), routePack.pointerBytes);
  const names = new Map();
  // Keep the tested preview as the single rider/player source, but publish only
  // its runtime and style under public asset names, never the prototype tree.
  const publicNames = {
    'prototypes/rider-first/app.mjs':'js/rider-home.mjs',
    'prototypes/rider-first/style.css':'assets/rider-home.css',
  };
  // Dependency-first allowlist. Specifiers in modules resolve from that
  // module (including lazy official terrain imports).
  // Catalog asset paths alone are deployment-root-relative.
  const graph = {
    'assets/site.css': [], 'js/config.js': [], 'assets/terrain.js': [],
    'js/route-catalog.mjs': [],
    'js/route-analysis.mjs': [],
    'js/ride-insights.mjs': ['./route-analysis.mjs'],
    'js/route-pack-contract.mjs': ['./route-catalog.mjs'],
    'js/route-analysis-loader.mjs': ['./route-catalog.mjs','./route-analysis.mjs','./route-pack-contract.mjs'],
    'js/route-state.mjs': [],
    'js/itinerary.mjs': [],
    'js/trip-planner.mjs': ['./route-catalog.mjs','./route-pack-contract.mjs','./route-analysis-loader.mjs','./itinerary.mjs'],
    'js/ascent-estimator.mjs': [], 'js/rider-scenario.mjs': ['./ascent-estimator.mjs'],
    'js/preference-storage.mjs': ['./rider-scenario.mjs','./itinerary.mjs'],
    'js/rider-preferences.mjs': ['./rider-scenario.mjs','./preference-storage.mjs','./itinerary.mjs'],
    'js/preferences-view.mjs': ['./preference-storage.mjs','./rider-preferences.mjs'],
    'js/offline-contract.mjs': ['./route-pack-contract.mjs'],
    'js/offline-storage.mjs': [],
    'js/offline-client.mjs': ['./offline-contract.mjs','./offline-storage.mjs'],
    'js/offline-view.mjs': ['./offline-client.mjs','./offline-contract.mjs'],
    'js/route-time.mjs': ['./route-analysis.mjs','./ascent-estimator.mjs'],
    'js/route-pace.mjs': ['./route-time.mjs','./ascent-estimator.mjs'],
    'js/trip-planner-view.mjs': ['./itinerary.mjs','./trip-planner.mjs','./route-pace.mjs','./route-catalog.mjs'],
    'js/climb-sensitivity.mjs': ['./ascent-estimator.mjs'],
    'js/climb-sensitivity-view.mjs': ['./climb-sensitivity.mjs'],
    'js/ride-clock.mjs': [],
    'js/ride-simulation.mjs': ['./ascent-estimator.mjs','./route-time.mjs','./ride-clock.mjs','./rider-scenario.mjs','./route-analysis.mjs'],
    'js/ride-comparison.mjs': ['./ride-simulation.mjs'],
    'js/route-playback.mjs': [],
    'js/route-playback-adapters.mjs': ['./route-analysis.mjs','./route-time.mjs'],
    'js/route-session.mjs': ['./route-playback.mjs'],
    'js/route-pace-view.mjs': ['./route-pace.mjs','./route-session.mjs','./ride-clock.mjs','./climb-sensitivity-view.mjs'],
    'js/route-briefing.mjs': ['./route-analysis.mjs'],
    'js/route-briefing-view.mjs': ['./route-briefing.mjs','./route-analysis.mjs','./route-session.mjs'],
    'js/route-flyover.mjs': ['./route-analysis.mjs'],
    'js/route-terrain-view.mjs': ['./route-flyover.mjs','../assets/terrain.js','./config.js'],
    'js/route-flyover-view.mjs': ['./route-flyover.mjs','./route-session.mjs','./route-terrain-view.mjs'],
    'js/event-guide.mjs': ['./route-briefing.mjs'],
    'js/event-guide-view.mjs': ['./event-guide.mjs','./route-session.mjs'],
    'js/route-weather.mjs': ['./event-guide.mjs'],
    'js/route-weather-view.mjs': ['./route-weather.mjs'],
    'js/route-comparison.mjs': [],
    'js/route-comparison-view.mjs': ['./route-comparison.mjs','./route-briefing.mjs','./route-analysis.mjs','./route-session.mjs'],
    'js/local-route-parser.mjs': [],
    'js/local-route-worker.mjs': ['./local-route-parser.mjs','./route-analysis.mjs'],
    'js/local-route-import.mjs': ['./local-route-parser.mjs','./local-route-worker.mjs'],
    'js/local-route-storage.mjs': [],
    'js/local-routes-view.mjs': ['./local-route-import.mjs','./local-route-storage.mjs','./route-briefing.mjs','./route-analysis.mjs'],
    'js/recorded-replay.mjs': ['./route-analysis.mjs','./route-time.mjs','./ride-clock.mjs'],
    'js/recorded-replay-view.mjs': ['./recorded-replay.mjs','./route-session.mjs','./route-pace.mjs','./route-briefing.mjs','./route-analysis.mjs'],
    'js/site-shell.mjs': ['./route-state.mjs','./preferences-view.mjs','./route-catalog.mjs','./trip-planner.mjs','./trip-planner-view.mjs','./route-playback-adapters.mjs','./route-session.mjs','./route-briefing-view.mjs','./route-flyover-view.mjs','./route-pace.mjs','./route-pace-view.mjs','./route-comparison-view.mjs','./route-comparison.mjs','./local-routes-view.mjs','./local-route-storage.mjs','./recorded-replay.mjs','./recorded-replay-view.mjs','./event-guide.mjs','./event-guide-view.mjs','./route-weather-view.mjs','./offline-view.mjs'],
    'prototypes/rider-first/style.css': [],
    'prototypes/rider-first/app.mjs': ['../../js/route-analysis-loader.mjs','../../js/route-analysis.mjs',
      '../../js/route-catalog.mjs','../../js/route-pack-contract.mjs','../../js/route-terrain-view.mjs','../../js/ride-simulation.mjs',
      '../../js/ride-insights.mjs','../../js/route-flyover.mjs','../../js/ride-comparison.mjs'],
    'js/home-entry.mjs': ['../assets/site.css','./site-shell.mjs','../prototypes/rider-first/app.mjs','./offline-view.mjs'],
  };
  for (const [file, deps] of Object.entries(graph)) {
    let data = await readFile(join(root, file));
    for (const spec of deps) {
      const dir = spec.startsWith('assets/') ? '.' : dirname(file);
      const name = names.get(join(dir, spec));
      if (!name) throw Error(`Unresolved release dependency: ${file} → ${spec}`);
      const rewritten = relative(dirname(publicNames[file] || file),name).split(sep).join('/');
      data = replace(data.toString(), spec, rewritten.startsWith('.') ? rewritten : './'+rewritten);
    }
    const ext = extname(file);
    const publicFile = publicNames[file] || file;
    const name = `${publicFile.slice(0, -ext.length)}.${digest(data)}${ext}`;
    names.set(file, name);
    await mkdir(join(out, dirname(name)), {recursive:true});
    await writeFile(join(out, name), data);
  }
  const check = await readFile(new URL('./entry-check.js', import.meta.url), 'utf8');
  for (const [entry, scripts] of Object.entries({
    'index.html':['js/home-entry.mjs','prototypes/rider-first/style.css'],
    'explore.html':['js/site-shell.mjs','assets/site.css'],
  })) {
    let html = await readFile(join(root, entry), 'utf8');
    if (html.includes('href="./assets/route-pack.json"'))
      html = replace(html,'href="./assets/route-pack.json"',`href="./${packEntry}"`);
    else html = replace(html, '</head>',
      `  <link rel="alternate" type="application/json" title="Approved route catalog" href="./${packEntry}">\n</head>`);
    // Both entry freshness markers bind the whole secondary/home graph, even
    // when an edited module is reached only after explicit navigation.
    html = replace(html,'</head>',`  <meta name="kotr-graph" content="${digest(JSON.stringify([...names.values(),packEntry]))}">\n</head>`);
    for (const file of scripts) html = replace(html, './' + file, './' + names.get(file));
    html = replace(html, '<!-- release entry check -->',
      `<meta name="kotr-release" content="RELEASE_ID">\n  <script>${check}</script>`);
    await writeFile(join(out, entry), replace(html, 'content="RELEASE_ID"', `content="${digest(html)}"`));
  }
  // This manifest binds final HTML, every rewritten module dependency and the
  // approved route graph. No recursive source discovery or personal stores.
  const routePaths = new Set([...routePack.files.keys()].filter(p=>!p.includes('route-manifest-')));
  const common = ['index.html','explore.html',...names.values(),packEntry,
    ...[...routePack.files.keys()].filter(p=>!routePaths.has(p))];
  const resources=[];
  for(const path of [...common,...routePaths]) {
    const bytes=await readFile(join(out,path));
    resources.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const body={schema:1,common,resources,catalog:JSON.parse(routePack.pointerBytes).path,
    days:routePack.pack.catalog.days.map(d=>({id:d.id,name:d.name})),
    routes:offlineRouteInventory(routePack.pack.catalog)};
  const offline={...body,release:createHash('sha256').update(canonical(body)).digest('hex')};
  await validateOfflineManifest(offline,path=>readFile(join(out,path)).then(bytes=>new Response(bytes)));
  await writeFile(join(out,'offline-release.json'),canonical(offline)+'\n');
  const worker=await readFile(new URL('./offline-worker.js',import.meta.url),'utf8');
  await writeFile(join(out,'offline-worker.js'),
    replace(replace(worker,"'../js/offline-contract.mjs'",`'./${names.get('js/offline-contract.mjs')}'`),
      "'../js/offline-storage.mjs'",`'./${names.get('js/offline-storage.mjs')}'`));
  await writeFile(join(out, '.nojekyll'), '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node tools/build-release.mjs NEW_OUTPUT_DIRECTORY');
  await build(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
}
