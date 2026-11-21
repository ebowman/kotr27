// First-party interpretation of the existing flyover trace. No elevation
// table is bundled. Match the distance-window contract in docs/semonzo-chapters.md.
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
export function deriveProfile(xml) {
  const tracks = xml.querySelectorAll('trk > trkseg');
  if (tracks.length !== 1) throw Error('Expected one track segment');
  let prev, end = 0;
  const samples = [];
  for (const p of tracks[0].querySelectorAll('trkpt')) {
    const lat = number(p.getAttribute('lat')) * Math.PI / 180;
    const lon = number(p.getAttribute('lon')) * Math.PI / 180;
    const z = number(p.querySelector('ele')?.textContent);
    if (prev) {
      const a = Math.sin((lat-prev.lat)/2)**2 +
        Math.cos(prev.lat)*Math.cos(lat)*Math.sin((lon-prev.lon)/2)**2;
      const run = 12742000*Math.asin(Math.sqrt(a));
      if (!(run > 0)) throw Error('Invalid track interval');
      end += run;
    }
    samples.push({x:end, z});
    prev = {lat, lon};
  }
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
  const response = await fetch(new URL('../assets/semonzo.gpx', import.meta.url));
  if (!response.ok) throw Error('Missing route');
  return deriveProfile(new DOMParser().parseFromString(await response.text(), 'application/xml'));
}
