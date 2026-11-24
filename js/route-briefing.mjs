import { chapterAt, nextFeatures } from './route-analysis.mjs';

export const km = m => (m / 1000).toFixed(1);
export function sectionSummary(analysis, chapter) {
  const windows = analysis.windows.filter(w => w.endM > chapter.startM && w.startM < chapter.endM);
  return `${km(chapter.endM - chapter.startM)} km, ${Math.round(chapter.ascentM)} m gain, ` +
    `${chapter.gradePercent.toFixed(1)}% average signed grade, ` +
    `${Math.max(...windows.map(w => w.gradePercent)).toFixed(1)}% maximum signed window grade (derived, 250 m windows; not verified road grade).`;
}
export function briefingAt(analysis, distanceM) {
  if (analysis.status !== 'supported')
    return {status:'unsupported', message:'Profile and section summaries unsupported: source geometry/elevation is incomplete. No substitute estimate.'};
  const current = chapterAt(analysis, distanceM).chapter;
  const currentClimb = analysis.climbs.find(c => c.chapterId === current.id) ?? null;
  const nextClimb = analysis.climbs.find(c => c.startM > distanceM) ?? null;
  // A disclosed descriptive proxy, not a rider-specific physiological ranking.
  const hardest = [...analysis.climbs].sort((a,b) => b.ascentM-a.ascentM || b.distanceM-a.distanceM || a.startM-b.startM)[0] ?? null;
  const next = analysis.chapters.find(c => c.startM > distanceM) ?? null;
  const poi = nextFeatures(analysis, distanceM, {kinds:['feed','water','toilet','caution','viewpoint']}).features[0] ?? null;
  return {status:'supported', current, currentClimb, nextClimb, hardest, next, poi,
    completedM:distanceM, remainingM:analysis.distanceM-distanceM};
}

// Display projection only. Keep ordered visits (including repeated coordinates).
// Fit isotropically in a local equirectangular plane; north remains up.
export function outlineProjection(points) {
  const origin = points[0], cos = Math.cos(origin.lat*Math.PI/180);
  const xy = p => [(((p.lon-origin.lon+540)%360)-180)*cos, p.lat-origin.lat];
  const coordinates = points.map(xy);
  const xs = coordinates.map(p=>p[0]), ys = coordinates.map(p=>p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = 340/Math.max(maxX-minX,maxY-minY,1e-9);
  return p => {
    const [x,y] = xy(p);
    return [200+(x-(minX+maxX)/2)*scale, 200-(y-(minY+maxY)/2)*scale];
  };
}
