import { createCatalog, verifyAsset } from './route-catalog.mjs';

const provenance = {
  source:'Existing BRouter 1.7.11-beta Semonzo study; OpenStreetMap contributors (ODbL). Not an official event route.',
  observedOn:'2026-11-21',
};
const rights = {
  access:'public', redistribution:'approved',
  approval:'Project owner clearance 2026-11-21 for this exact GPX including elevations; docs/semonzo-chapters.md',
};
const binding = {
  revisionId:'semonzo-example-v1',
  geometrySha256:'bd4f3a18bf36bed53229a3efe04e6e5a47aab1b37e2fe597ea961d66de07ffa4',
};
const geometry = {
  ...binding, path:'assets/semonzo.gpx', sha256:binding.geometrySha256, format:'gpx',
};
const record = {status:'provisional', provenance, rights};
export const exampleRouteId = 'semonzo-example';
export const exampleCatalog = createCatalog({
  schemaVersion:1,
  events:[{...record, id:'semonzo-study', name:'Semonzo example study', kind:'example'}],
  days:[], variants:[], annotations:[],
  routes:[{
    ...record, id:exampleRouteId, name:'Semonzo example ascent', kind:'example',
    eventId:'semonzo-study', currentRevisionId:binding.revisionId,
    revisions:[{
      ...record, id:binding.revisionId,
      geometrySha256:binding.geometrySha256, geometry,
      profile:{...binding, recipe:'semonzo-250m-v1'},
      climbs:{...binding, recipe:'semonzo-chapters-v1'},
      downloads:[geometry],
      units:{distance:'m', elevation:'m', grade:'percent'},
      distanceSemantics:'horizontal-haversine-6371000m',
    }],
  }],
});

/** Both legacy entries consume the same permitted, byte-verified example. */
export async function loadExampleGPX() {
  const {revision} = exampleCatalog.resolve(exampleRouteId);
  const response = await fetch(new URL(revision.geometry.path, new URL('../', import.meta.url)));
  if (!response.ok) throw Error('Semonzo example unavailable');
  const bytes = await response.arrayBuffer();
  await verifyAsset(revision.geometry, bytes);
  return new TextDecoder().decode(bytes);
}
