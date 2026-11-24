// Node 22+, no dependencies. Only these explicitly public inputs may ship.
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCatalog, verifyAsset } from '../js/route-catalog.mjs';
import { readRoutePack } from './route-pack.mjs';

const digest = data => createHash('sha256').update(data).digest('hex').slice(0, 24);
function replace(text, from, to) {
  if (!text.includes(from)) throw new Error(`Missing release reference: ${from}`);
  return text.replaceAll(from, () => to);
}

export async function build(source, destination) {
  // Refuse existing trees (no mixing releases) and keep artifacts out of source.
  const root = await realpath(source);
  // Validate source catalog and pinned bytes before writing any public output.
  // No discovery or recursive route intake: example + explicit verified pack.
  const catalogFile = join(root, 'js/example-catalog.mjs');
  const {exampleCatalog} = await import(pathToFileURL(catalogFile).href + '?' + digest(await readFile(catalogFile)));
  createCatalog(exampleCatalog.data);
  for (const route of exampleCatalog.data.routes) for (const revision of route.revisions) {
    for (const ref of [revision.geometry, revision.profile, revision.climbs, revision.pois, ...(revision.downloads ?? [])]) {
      if (!ref?.path) continue;
      if (ref.path !== 'assets/semonzo.gpx') throw Error(`Asset not on public release allowlist: ${ref.path}`);
      await verifyAsset(ref, await readFile(join(root, ref.path)));
    }
  }
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
  // Dependency-first allowlist. Specifiers in modules resolve from that
  // module (including dynamic imports in the classic flyover script).
  // Catalog asset paths alone are deployment-root-relative.
  const graph = {
    'assets/semonzo.gpx': [], 'assets/site.css': [], 'js/config.js': [], 'assets/terrain.js': [],
    'js/route-catalog.mjs': [],
    'js/example-catalog.mjs': ['./route-catalog.mjs','assets/semonzo.gpx'],
    'js/route-analysis.mjs': [],
    'js/route-pack-contract.mjs': ['./route-catalog.mjs'],
    'js/route-analysis-loader.mjs': ['./route-catalog.mjs','./route-analysis.mjs','./route-pack-contract.mjs'],
    'js/semonzo-profile.mjs': ['./example-catalog.mjs','./route-analysis.mjs'],
    'js/route-state.mjs': [],
    'js/itinerary.mjs': [],
    'js/trip-planner.mjs': ['./route-catalog.mjs','./route-pack-contract.mjs','./route-analysis-loader.mjs','./itinerary.mjs'],
    'js/ascent-estimator.mjs': [], 'js/rider-scenario.mjs': ['./ascent-estimator.mjs'],
    'js/preference-storage.mjs': ['./rider-scenario.mjs','./itinerary.mjs'],
    'js/rider-preferences.mjs': ['./rider-scenario.mjs','./preference-storage.mjs','./itinerary.mjs'],
    'js/preferences-view.mjs': ['./preference-storage.mjs','./rider-preferences.mjs'],
    'js/route-time.mjs': ['./route-analysis.mjs','./ascent-estimator.mjs'],
    'js/route-pace.mjs': ['./route-time.mjs','./ascent-estimator.mjs'],
    'js/trip-planner-view.mjs': ['./itinerary.mjs','./trip-planner.mjs','./route-pace.mjs'],
    'js/climb-sensitivity.mjs': ['./ascent-estimator.mjs'],
    'js/climb-sensitivity-view.mjs': ['./climb-sensitivity.mjs'],
    'js/ride-clock.mjs': [],
    'js/route-playback.mjs': [],
    'js/route-playback-adapters.mjs': ['./route-analysis.mjs','./route-time.mjs','./example-catalog.mjs'],
    'js/route-session.mjs': ['./route-playback.mjs'],
    'js/route-pace-view.mjs': ['./route-pace.mjs','./route-session.mjs','./ride-clock.mjs','./climb-sensitivity-view.mjs'],
    'js/route-briefing.mjs': ['./route-analysis.mjs'],
    'js/route-briefing-view.mjs': ['./route-briefing.mjs','./route-analysis.mjs','./route-session.mjs'],
    'js/route-comparison.mjs': [],
    'js/route-comparison-view.mjs': ['./route-comparison.mjs','./route-briefing.mjs','./route-analysis.mjs','./route-session.mjs'],
    'js/site-shell.mjs': ['./example-catalog.mjs','./semonzo-profile.mjs','./route-state.mjs','./preferences-view.mjs','./route-catalog.mjs','./trip-planner.mjs','./trip-planner-view.mjs','./route-playback-adapters.mjs','./route-session.mjs','./route-briefing-view.mjs','./route-pace.mjs','./route-pace-view.mjs','./route-comparison-view.mjs','./route-comparison.mjs'],
    'assets/flyover.js': ['../js/semonzo-profile.mjs','../js/route-session.mjs','../js/route-playback-adapters.mjs'],
    'js/chapter-reveal.mjs': [], 'js/plan-comparison.mjs': [],
    'js/rider-controls.mjs': ['./preferences-view.mjs','./chapter-reveal.mjs','./plan-comparison.mjs','./site-shell.mjs','./ride-clock.mjs','./climb-sensitivity-view.mjs'],
  };
  for (const [file, deps] of Object.entries(graph)) {
    let data = await readFile(join(root, file));
    for (const spec of deps) {
      const dir = spec.startsWith('assets/') ? '.' : dirname(file);
      const name = names.get(join(dir, spec));
      if (!name) throw Error(`Unresolved release dependency: ${file} → ${spec}`);
      data = replace(data.toString(), spec, spec.replace(basename(spec), basename(name)));
    }
    const ext = extname(file);
    const name = `${file.slice(0, -ext.length)}.${digest(data)}${ext}`;
    names.set(file, name);
    await mkdir(join(out, dirname(name)), {recursive:true});
    await writeFile(join(out, name), data);
  }
  const check = await readFile(new URL('./entry-check.js', import.meta.url), 'utf8');
  for (const [entry, scripts] of Object.entries({
    'index.html':['js/config.js','assets/terrain.js','assets/flyover.js','js/site-shell.mjs','assets/site.css'],
    'explore.html':['js/rider-controls.mjs','assets/site.css'],
  })) {
    let html = await readFile(join(root, entry), 'utf8');
    html = replace(html, '</head>',
      `  <link rel="alternate" type="application/json" title="Approved route catalog" href="./${packEntry}">\n</head>`);
    for (const file of scripts) html = replace(html, './' + file, './' + names.get(file));
    html = replace(html, '<!-- release entry check -->',
      `<meta name="kotr-release" content="RELEASE_ID">\n  <script>${check}</script>`);
    await writeFile(join(out, entry), replace(html, 'content="RELEASE_ID"', `content="${digest(html)}"`));
  }
  await writeFile(join(out, '.nojekyll'), '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node tools/build-release.mjs NEW_OUTPUT_DIRECTORY');
  await build(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
}
