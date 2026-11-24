// Node filesystem/CLI boundary. Producer semantics live in one browser-safe module.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRoutePack, validatePackPointer } from '../js/route-pack-contract.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const need = (condition,message) => { if (!condition) throw Error(`Route pack: ${message}`); };

/** Preserve the tooling API/Buffer contract; publication always checks ALL assets. */
export async function validatePack(pack, {read,previous} = {}) {
  const files = await validateRoutePack(pack,{read,previous});
  return new Map([...files].map(([path,bytes])=>[path,Buffer.from(bytes)]));
}

export async function safeRead(root, path) {
  need(typeof path === 'string' && /^assets\/[a-zA-Z0-9.-]+$/.test(path) && !path.includes('..'), 'unsafe route asset path');
  const full = join(resolve(root),path);
  for (let current=full; current !== parse(current).root; current=dirname(current)) {
    const info = await lstat(current);
    need(!info.isSymbolicLink(), 'symlink route assets/root not allowed');
    if (current === full) need(info.isFile() && info.size <= 20*1024*1024, 'regular bounded route asset required');
  }
  return readFile(full);
}

/** Read the one explicit pointer and only its verified transitive references. */
export async function readRoutePack(root) {
  const pointerBytes = await safeRead(root,'assets/route-pack.json');
  const pointer = JSON.parse(pointerBytes);
  validatePackPointer(pointer);
  const manifestBytes = await safeRead(root,pointer.path);
  need(hash(manifestBytes) === pointer.sha256, 'manifest bytes do not match pointer');
  const pack = JSON.parse(manifestBytes);
  const files = await validatePack(pack, {read:path=>safeRead(root,path)});
  files.set(pointer.path,manifestBytes);
  return {pack, files, pointerBytes};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length; need(size <= 64*1024*1024,'validation payload limit');
      chunks.push(chunk);
    }
    const {pack,files,previous} = JSON.parse(Buffer.concat(chunks));
    await validatePack(pack, {read:path=> {
      need(Object.hasOwn(files,path), 'missing asset');
      return Buffer.from(files[path]);
    }, previous});
    console.log('Public route pack validated');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
