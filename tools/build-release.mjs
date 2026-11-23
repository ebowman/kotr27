// Node 22+, no dependencies. Only these explicitly public inputs may ship.
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = data => createHash('sha256').update(data).digest('hex').slice(0, 24);
function replace(text, from, to) {
  if (!text.includes(from)) throw new Error(`Missing release reference: ${from}`);
  return text.replaceAll(from, () => to);
}

export async function build(source, destination) {
  // Refuse existing trees (no mixing releases) and keep artifacts out of source.
  const root = await realpath(source);
  const out = join(await realpath(dirname(resolve(destination))), basename(resolve(destination)));
  const rel = relative(root, out);
  if (!rel || !(rel === '..' || rel.startsWith('..' + sep))) throw Error('Output must be outside source');
  await mkdir(out);
  const names = new Map();
  // Dependency-first allowlist. Specifiers in modules resolve from that
  // module, while the classic flyover script fetches relative to its page.
  const graph = {
    'assets/semonzo.gpx': [], 'js/config.js': [], 'assets/terrain.js': [],
    'assets/flyover.js': ['./assets/semonzo.gpx'],
    'js/semonzo-profile.mjs': ['../assets/semonzo.gpx'],
    'js/ascent-estimator.mjs': [], 'js/rider-scenario.mjs': ['./ascent-estimator.mjs'],
    'js/climb-sensitivity.mjs': ['./ascent-estimator.mjs'],
    'js/climb-sensitivity-view.mjs': ['./climb-sensitivity.mjs'],
    'js/chapter-reveal.mjs': [], 'js/plan-comparison.mjs': [],
    'js/ride-clock.mjs': [],
    'js/rider-controls.mjs': ['./rider-scenario.mjs','./chapter-reveal.mjs','./plan-comparison.mjs','./semonzo-profile.mjs','./ride-clock.mjs','./climb-sensitivity-view.mjs'],
  };
  for (const [file, deps] of Object.entries(graph)) {
    let data = await readFile(join(root, file));
    for (const spec of deps) {
      const dir = file.endsWith('.mjs') ? dirname(file) : '.';
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
    'index.html':['js/config.js','assets/terrain.js','assets/flyover.js'],
    'explore.html':['js/rider-controls.mjs'],
  })) {
    let html = await readFile(join(root, entry), 'utf8');
    for (const file of scripts) html = replace(html, './' + file, './' + names.get(file));
    html = replace(html, '<!-- release entry check -->',
      `<meta name="kotr-release" content="RELEASE_ID">\n  <script>${check}</script>`);
    await writeFile(join(out, entry), replace(html, 'content="RELEASE_ID"', `content="${digest(html)}"`));
  }
  await writeFile(join(out, '.nojekyll'), '');
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node tools/build-release.mjs NEW_OUTPUT_DIRECTORY');
  await build(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
}
