// First-party interpretation of the existing flyover trace. No elevation
// table is bundled. Match the distance-window contract in docs/semonzo-chapters.md.
import { exampleCatalog, exampleRouteId, loadExampleGPX } from './example-catalog.mjs';
const chapters = [
  [0, 'long-lift', 'Long lift', 'The first nine kilometres gain height almost without a break.'],
  [9000, 'half-step', 'Half step', 'The road still rises, but gains roughly half as much height per kilometre.'],
  [11000, 'high-step', 'High step', 'Over the next two and a half kilometres the average crosses ten percent.'],
  [13500, 'dip-and-return', 'Dip and return', 'The first half-kilometre loses height before the climb resumes toward the finish.'],
];
const mm = n => Number(n.toFixed(3));
function number(text) {
  if (!text?.trim() || !Number.isFinite(Number(text))) throw Error('Missing GPX measurement');
  return Number(text);
}
export function readExampleTrack(xml) {
  const tracks = xml.querySelectorAll('trk > trkseg');
  if (tracks.length !== 1) throw Error('Expected one track segment');
  let prev, end = 0;
  const points = [];
  for (const p of tracks[0].querySelectorAll('trkpt')) {
    const latitude = number(p.getAttribute('lat')), longitude = number(p.getAttribute('lon'));
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw Error('Invalid GPX coordinates');
    const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
    const z = number(p.querySelector('ele')?.textContent);
    if (prev) {
      const a = Math.sin((lat-prev.lat)/2)**2 +
        Math.cos(prev.lat)*Math.cos(lat)*Math.sin((lon-prev.lon)/2)**2;
      const run = 12742000*Math.asin(Math.sqrt(a));
      if (!(run > 0)) throw Error('Invalid track interval');
      end += run;
    }
    points.push({distanceM:end, height:z, lat:latitude, lon:longitude});
    prev = {lat, lon};
  }
  if (points.length < 2) throw Error('Empty example track');
  return points;
}

export function deriveProfile(xml) {
  const samples = readExampleTrack(xml).map(p => ({x:p.distanceM, z:p.height}));
  const end = samples.at(-1).x;
  if (end < chapters.at(-1)[0]+250) throw Error('Incomplete chapter coverage');
  const profile = {schemaVersion:1, chapters:[], segments:[], distanceM:mm(end)};
  let i = 1, start = 0, z = samples[0].z;
  for (const [c, [startM, id, name, notice]] of chapters.entries()) {
    const stop = chapters[c+1]?.[0] ?? end, first = z;
    let ascent = 0;
    while (start < stop) {
      const next = end-start < 500 ? end : start+250;
      while (samples[i].x < next) i++;
      const lo = samples[i-1], hi = samples[i];
      const height = lo.z + (next-lo.x)/(hi.x-lo.x)*(hi.z-lo.z);
      profile.segments.push({chapterId:id, startM:mm(start), endM:mm(next),
        startElevationM:mm(z), endElevationM:mm(height)});
      ascent += Math.max(0,height-z);
      start = next; z = height;
    }
    profile.chapters.push({id,name,notice,startM,endM:mm(stop),netRiseM:mm(z-first),ascentM:mm(ascent)});
  }
  return profile;
}

export async function loadProfile() {
  const {revision} = exampleCatalog.resolve(exampleRouteId);
  if (revision.profile?.recipe !== 'semonzo-250m-v1' || revision.climbs?.recipe !== 'semonzo-chapters-v1')
    throw Error('Unsupported example profile/chapter derivation');
  return deriveProfile(await loadExampleXML());
}

async function loadExampleXML() {
  return new DOMParser().parseFromString(await loadExampleGPX(), 'application/xml');
}

export async function loadExampleTrack() {
  return readExampleTrack(await loadExampleXML());
}
