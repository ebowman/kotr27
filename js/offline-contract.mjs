// Public release graph only. No arbitrary URL or opportunistic cache entries.
import {validateRoutePack} from './route-pack-contract.mjs';
export const packLimits = Object.freeze({route:25*1024**2, active:50*1024**2, total:100*1024**2});
export const canonical = value => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}
const need = (ok, message) => { if (!ok) throw Error(message); };
export function offlineRouteInventory(catalog) {
  return catalog.routes.map(r=>({
    id:r.id,name:r.name,day:catalog.variants.find(v=>v.id===r.variantId).dayId,
    revision:r.currentRevisionId,status:r.status,
    paths:[...new Set(r.revisions.flatMap(v=>[v.geometry,v.profile,v.climbs,v.pois,...(v.downloads??[])])
      .filter(r=>r?.path).map(r=>r.path))],
  }));
}
export async function validateOfflineManifest(m,read) {
  need(m?.schema===1 && /^[a-f0-9]{64}$/.test(m.release) &&
    Array.isArray(m.resources) && m.resources.length<=256 && Array.isArray(m.common) &&
    Array.isArray(m.routes) && m.routes.length<=100 && Array.isArray(m.days), 'Unsupported offline manifest');
  const {release,...body}=m;
  need(await sha256(new TextEncoder().encode(canonical(body)))===release, 'Release graph checksum mismatch');
  const paths=new Set();
  for (const r of m.resources) {
    need(r && /^(?:(?:index|explore)\.html|(?:js|assets)\/[a-z0-9-]+\.[a-f0-9]{24}\.(?:mjs|js|css|gpx|json)|assets\/route-(?:manifest-|profile-)?[a-f0-9]{64}\.(?:json|gpx))$/.test(r.path) &&
      !paths.has(r.path) && /^[a-f0-9]{64}$/.test(r.sha256) &&
      Number.isSafeInteger(r.bytes) && r.bytes>0 && r.bytes<=packLimits.route, 'Invalid offline resource');
    paths.add(r.path);
  }
  need(m.common.includes('index.html') && m.common.includes('explore.html') &&
    m.common.every(p=>paths.has(p)), 'Incomplete offline shell');
  need(/^assets\/route-manifest-[a-f0-9]{64}\.json$/.test(m.catalog) &&
    m.common.includes(m.catalog), 'Missing bound route catalog');
  const ids=new Set();
  for (const d of m.days) {
    need(/^[a-z0-9-]+$/.test(d.id) && !ids.has(d.id) && typeof d.name==='string', 'Invalid offline day');
    ids.add(d.id);
  }
  const routes=new Set();
  for (const r of m.routes) {
    need(/^[a-z0-9-]+$/.test(r.id) && !routes.has(r.id) && ids.has(r.day) &&
      typeof r.name==='string' && ['provisional','confirmed','superseded','withdrawn'].includes(r.status) &&
      (r.revision===null || /^[a-z0-9-]+$/.test(r.revision)) &&
      Array.isArray(r.paths) && r.paths.every(p=>paths.has(p) && !m.common.includes(p)), 'Invalid offline route');
    routes.add(r.id);
    need(m.resources.filter(x=>r.paths.includes(x.path)).reduce((n,x)=>n+x.bytes,0)<=packLimits.route, 'Route exceeds 25 MiB');
  }
  need(m.resources.every(r=>m.common.includes(r.path) || m.routes.some(x=>x.paths.includes(r.path))), 'Unbound resource');
  if(read) {
    const ref=m.resources.find(r=>r.path===m.catalog);
    const response=await verifiedResponse(await read(ref.path),ref);
    const pack=await response.json();
    await validateRoutePack(pack,{metadataOnly:true});
    need(canonical(offlineRouteInventory(pack.catalog))===canonical(m.routes) &&
      canonical(pack.catalog.days.map(d=>({id:d.id,name:d.name})))===canonical(m.days),
    'Offline inventory differs from bound approved catalog');
  }
  return m;
}
export function selectedResources(manifest, days) {
  need(Array.isArray(days) && days.length>0 && new Set(days).size===days.length &&
    days.every(d=>manifest.days.some(x=>x.id===d)), 'Choose at least one available source day');
  const routes=manifest.routes.filter(r=>days.includes(r.day) && r.revision && r.status!=='withdrawn');
  need(days.every(d=>routes.some(r=>r.day===d)), 'Selected day has no permitted route');
  const paths=new Set([...manifest.common,...routes.flatMap(r=>r.paths)]);
  const resources=manifest.resources.filter(r=>paths.has(r.path));
  need(resources.reduce((n,r)=>n+r.bytes,0)<=packLimits.active,'Selected pack exceeds 50 MiB');
  return resources;
}
export async function verifiedResponse(response, ref) {
  need(response.ok && !response.redirected && response.type!=='opaque', 'Resource unavailable');
  const bytes=await response.arrayBuffer();
  need(bytes.byteLength===ref.bytes && await sha256(bytes)===ref.sha256, 'Resource checksum/size mismatch');
  return new Response(bytes,{status:200,headers:{'Content-Type':response.headers.get('Content-Type') || 'application/octet-stream'}});
}
