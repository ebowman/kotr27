// Read-only interpretations of the selected revision's existing 250 m windows.
// No climb detector, elevation repair, ride model or clock.
import { chapterAt, positionAt } from './route-analysis.mjs';

function span(analysis, startM, endM) {
  const parts = analysis.windows.filter(w=>w.endM > startM && w.startM < endM);
  const grades = parts.map(w=>w.gradePercent);
  return {
    startM,endM,distanceM:endM-startM,
    ascentM:parts.reduce((sum,w)=>sum+Math.max(0,w.gradePercent/100)*
      (Math.min(endM,w.endM)-Math.max(startM,w.startM)),0),
    minGradePercent:parts.length ? Math.min(...grades) : null,
    maxGradePercent:parts.length ? Math.max(...grades) : null,
    // Same known domain boundary as the shared riding model. This flags input,
    // not a claim that the actual road has an extreme gradient.
    inputAnomaly:grades.some(g=>Math.abs(g)>50),
  };
}
export function sectionName(analysis, chapter) {
  if (!chapter) return 'Section unavailable';
  const kind = analysis.climbs.some(c=>c.chapterId === chapter.id) ? 'Climb' :
    ({ascent:'Rise',descent:'Descent',flat:'Level'})[chapter.kind];
  return `${kind} ${analysis.chapters.indexOf(chapter)+1}`;
}
export function rideInsights(analysis, distanceM, selectedChapterId) {
  if (analysis?.status !== 'supported' || !analysis.chapters?.length)
    return {status:'unavailable',identity:analysis?.identity};
  const current = chapterAt(analysis,distanceM).chapter;
  const index = analysis.chapters.indexOf(current);
  const selected = analysis.chapters.find(c=>c.id === selectedChapterId) || current;
  const mainClimb = analysis.climbs.reduce((best,c)=>!best || c.ascentM>best.ascentM ? c : best,null);
  return {
    status:'available',identity:analysis.identity,position:positionAt(analysis,distanceM),
    current,next:analysis.chapters[index+1] || null,selected,
    mainClimb:mainClimb ? analysis.chapters.find(c=>c.id === mainClimb.chapterId) : null,
    remaining:span(analysis,distanceM,current.endM),
    selectedRemaining:span(analysis,Math.max(selected.startM,Math.min(selected.endM,distanceM)),selected.endM),
    selectedSummary:span(analysis,selected.startM,selected.endM),
    ahead:span(analysis,distanceM,Math.min(analysis.distanceM,distanceM+1000)),
    finished:distanceM === analysis.distanceM,
  };
}
