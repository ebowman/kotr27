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
  for (const file of ['assets/semonzo.gpx', 'js/config.js', 'assets/terrain.js', 'assets/flyover.js']) {
    let data = await readFile(join(root, file));
    if (file === 'assets/flyover.js') {
      data = replace(data.toString(), './assets/semonzo.gpx', './' + names.get('assets/semonzo.gpx'));
    }
    const ext = extname(file);
    const name = `${file.slice(0, -ext.length)}.${digest(data)}${ext}`;
    names.set(file, name);
    await mkdir(join(out, dirname(name)), {recursive:true});
    await writeFile(join(out, name), data);
  }
  let html = await readFile(join(root, 'index.html'), 'utf8');
  for (const [file, name] of names) {
    if (file !== 'assets/semonzo.gpx') html = replace(html, './' + file, './' + name);
  }
  const check = await readFile(new URL('./entry-check.js', import.meta.url), 'utf8');
  html = replace(html, '<!-- release entry check -->',
    `<meta name="kotr-release" content="RELEASE_ID">\n  <script>${check}</script>`);
  await writeFile(join(out, 'index.html'), replace(html, 'content="RELEASE_ID"', `content="${digest(html)}"`));
  await writeFile(join(out, '.nojekyll'), '');
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node tools/build-release.mjs NEW_OUTPUT_DIRECTORY');
  await build(fileURLToPath(new URL('../', import.meta.url)), process.argv[2]);
}
