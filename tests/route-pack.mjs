import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoutePack, validatePack } from '../tools/route-pack.mjs';
import { build } from '../tools/build-release.mjs';
import { createCatalog } from '../js/route-catalog.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const digest = data => createHash('sha256').update(data).digest('hex');
const source = await readRoutePack(root);
const read = path => {
  assert.ok(source.files.has(path));
  return source.files.get(path);
};

test('real pack has seven provisional variants and pinned sanitized geometries, no invented dates', async () => {
  assert.equal(source.pack.catalog.routes.length,7);
  assert.deepEqual(source.pack.routes.map(r=>r.pointCount),[6738,5016,5729,8365,3606,8107,1205]);
  assert.ok(source.pack.catalog.days.every(d=>!d.date && d.status==='provisional'));
  const catalog = createCatalog(source.pack.catalog);
  for (const row of source.pack.routes) {
    assert.ok(row.revisionId,'all seven approved originals are now supplied');
    const {revision} = catalog.resolve(row.routeId,row.revisionId);
    assert.equal(revision.downloads.length,1);
    assert.equal(revision.downloads[0].format,'gpx');
    assert.equal(row.availability.fit,'unavailable-no-sanitized-fit-writer');
    assert.ok(row.computed.rawGainM > row.listed.gainM);
    assert.equal(revision.climbs,undefined);
  }
  await validatePack(source.pack,{read});
});

test('real addition report preserves earlier four bundles and adds only three missing geometries', async () => {
  const previousHash='9fa47d767f0d1c6c925c135c69afcbe97697e62ef71683cd11f87b65f6af726d';
  const previous=JSON.parse(await readFile(join(root,`assets/route-manifest-${previousHash}.json`)));
  assert.equal(source.pack.changeReport.previousManifestSha256,previousHash);
  const additions=new Set(['rwgps-57873183','rwgps-57873112','rwgps-57874050']);
  const changes=new Map(source.pack.changeReport.changes.map(c=>[c.routeId,c]));
  for (const route of source.pack.catalog.routes) {
    const old=previous.catalog.routes.find(r=>r.id===route.id), change=changes.get(route.id);
    if (additions.has(route.id)) {
      assert.equal(change.beforeRevisionId,null);
      assert.ok(change.afterRevisionId);
      assert.equal(change.pathChanged,true);
      assert.equal(change.annotationsNeedReview,false);
    } else {
      assert.deepEqual(route,old);
      assert.equal(change.kind,'unchanged');
      for (const ref of [old.revisions[0].geometry,old.revisions[0].profile])
        assert.equal(digest(await readFile(join(root,ref.path))),ref.sha256);
    }
  }
});

test('closed publication graph rejects permission, hashes, stale profiles and unreviewed content', async () => {
  for (const [edit,match] of [
    [p=>{p.catalog.routes[0].rights.redistribution='unknown';}, /public catalog requires/],
    [p=>{p.routes[0].deviceId='private';}, /unexpected\/missing fields/],
    [p=>{p.catalog.routes[0].revisions[0].profile.revisionId='wrong';}, /mixed revision/],
    [p=>{p.catalog.routes[0].revisions[0].climbs={recipe:'arbitrary-v1',revisionId:p.routes[0].revisionId,
      geometrySha256:p.catalog.routes[0].revisions[0].geometrySha256};}, /unsupported or stale/],
    [p=>{p.routes[0].computed.rawGainM=1;}, /summary differs/],
    [p=>{p.catalog.routes[0].revisions[0].profile.path='assets/private.json';}, /allowlist/],
    [p=>{p.changeReport.changes.find(c=>c.beforeRevisionId===null).afterRevisionId='old';}, /report differs/],
  ]) {
    const pack = structuredClone(source.pack); edit(pack);
    await assert.rejects(validatePack(pack,{read}),match);
  }
  await assert.rejects(validatePack(source.pack,{read:path=>Buffer.concat([read(path),Buffer.from('tamper')])}),/bytes do not match/);
  const pack = structuredClone(source.pack), revision=pack.catalog.routes[0].revisions[0];
  const data = JSON.parse(read(revision.profile.path));
  data.samples[10][1] += 1;
  const bytes = Buffer.from(JSON.stringify(data));
  revision.profile.sha256=digest(bytes);
  revision.profile.path=`assets/route-profile-${digest(bytes)}.json`;
  await assert.rejects(validatePack(pack,{read:path=>path===revision.profile.path ? bytes : read(path)}),/not derived from pinned geometry/);
});

test('source private originals/provenance and arbitrary extra assets never ship', async t => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(),'kotr-pack-release-')));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const src=join(tmp,'source');
  await mkdir(src);
  for (const path of ['js','assets']) await cp(join(root,path),join(src,path),{recursive:true});
  for (const path of ['index.html','explore.html']) await cp(join(root,path),join(src,path));
  await mkdir(join(src,'.private'));
  const canary='PRIVATE-ROUTE-ORIGINAL-CANARY';
  await writeFile(join(src,'.private','secret.fit'),canary);
  await writeFile(join(src,'assets','route-unreferenced.fit'),canary);
  await writeFile(join(src,'assets','route-profile-'+'0'.repeat(64)+'.json'),canary);
  await build(src,join(tmp,'a'));
  await build(src,join(tmp,'b'));
  const files=(await readdir(join(tmp,'a'),{recursive:true})).filter(p=>p.includes('/') || p.endsWith('.html') || p==='.nojekyll').sort();
  for (const path of files) {
    const bytes=await readFile(join(tmp,'a',path));
    assert.deepEqual(bytes,await readFile(join(tmp,'b',path)));
    assert.ok(!bytes.includes(canary));
    assert.doesNotMatch(bytes.toString(), /\.private\/route-intake|Personal\.dtBase2|recordUUID|privacy_code|sourcePath|time_created/);
  }
  assert.ok(files.every(path=>!path.endsWith('.fit')));
  assert.ok(!files.includes('assets/route-pack.json'),'mutable source pointer must not ship');
  assert.ok(!files.includes('assets/route-manifest-'+source.pack.changeReport.previousManifestSha256+'.json'),
    'earlier four-geometry manifest is source history, not part of the current public pack');
  const pointer=files.find(path=>/^assets\/route-pack\.[a-f0-9]{24}\.json$/.test(path));
  assert.ok(pointer);
  assert.match(await readFile(join(tmp,'a','index.html'),'utf8'), new RegExp(pointer.replaceAll('.','\\.')));
  const outputPointer=JSON.parse(await readFile(join(tmp,'a',pointer)));
  assert.ok(files.includes(outputPointer.path));
  assert.equal(digest(await readFile(join(tmp,'a',outputPointer.path))),outputPointer.sha256);
  assert.ok(!files.some(path=>/tools|docs|inventory|import-routes|requirements/.test(path)));
});

test('release rejects tampering/symlinks before output; changing pointer invalidates both entries', async t => {
  const tmp = await realpath(await mkdtemp(join(tmpdir(),'kotr-pack-gates-')));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const src=join(tmp,'source');
  await mkdir(src);
  for (const path of ['js','assets']) await cp(join(root,path),join(src,path),{recursive:true});
  for (const path of ['index.html','explore.html']) await cp(join(root,path),join(src,path));
  const [path,bytes]=[...source.files][0];
  await writeFile(join(src,path),'bad');
  await assert.rejects(build(src,join(tmp,'bad')),/bytes do not match/);
  assert.ok(!(await readdir(tmp)).includes('bad'));
  await rm(join(src,path));
  await symlink(join(root,path),join(src,path));
  await assert.rejects(build(src,join(tmp,'symlink')),/symlink/);
  assert.ok(!(await readdir(tmp)).includes('symlink'));
  await rm(join(src,path));
  await writeFile(join(src,path),bytes);
  await build(src,join(tmp,'a'));
  const pack=structuredClone(source.pack);
  pack.catalog.routes[0].name += ' display rename';
  const manifest=Buffer.from(JSON.stringify(pack));
  const manifestPath='assets/route-manifest-'+digest(manifest)+'.json';
  await writeFile(join(src,manifestPath),manifest);
  await writeFile(join(src,'assets/route-pack.json'),JSON.stringify({schemaVersion:1,path:manifestPath,sha256:digest(manifest)}));
  await build(src,join(tmp,'b'));
  for (const entry of ['index.html','explore.html'])
    assert.notDeepEqual(await readFile(join(tmp,'a',entry)),await readFile(join(tmp,'b',entry)));
  for (const [path,bytes] of source.files) if (!path.includes('manifest'))
    assert.deepEqual(await readFile(join(tmp,'b',path)),bytes);
  assert.ok(!(await readdir(join(tmp,'b','assets'))).includes(JSON.parse(source.pointerBytes).path.slice(7)),
    'old manifests must not be recursively copied');
  // A later allowlisted module failure must not expose a partial release tree.
  await rm(join(src,'js/ride-clock.mjs'));
  await assert.rejects(build(src,join(tmp,'incomplete')),/ENOENT/);
  assert.ok(!(await readdir(tmp)).some(path=>path==='incomplete' || path.startsWith('.kotr-release-')));
  await assert.rejects(build(src,join(tmp,'a')),/Output already exists/);
});
