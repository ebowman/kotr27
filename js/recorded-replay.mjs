// Private, document-memory projections of the existing decoder's samples.
// No I/O, parser, physiology, clock scheduler or physics solver.
import { horizontalDistanceM, positionAt } from './route-analysis.mjs';
import { routeTimeAtDistance } from './route-time.mjs';
import { createRouteClock } from './ride-clock.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const unavailable = reason => ({status:'unavailable',reason});
export const actualSignals = Object.freeze({
  powerW:{unit:'W',min:0,max:65534}, cadenceRpm:{unit:'rpm',min:0,max:254},
  speedMps:{unit:'m/s',min:0,max:200}, heartRateBpm:{unit:'bpm',min:1,max:254},
});
export const replayLimits = Object.freeze({
  samples:50000, points:20000, planPoints:20000, gapSeconds:30,
  corridorM:30, occurrenceM:100, segmentM:500, cellM:100,
  cellEntries:200000, candidateTests:300000,
});
export function actualAtSample(sample, format) {
  return Object.fromEntries(Object.entries(actualSignals).map(([key,{unit,min,max}]) => {
    const value=sample?.[key];
    return [key,finite(sample?.timeMs) && finite(value) && value>=min && value<=max ?
      {status:'available',value,unit,timeMs:sample.timeMs,provenance:`${format} decoded sample`} :
      {...unavailable('No valid timestamped sample'),unit}];
  }));
}
// Upper bound, O(log n) on every frame. No index-fraction time inference.
function floorIndex(values, value) {
  let lo=0, hi=values.length;
  while(lo<hi) {const mid=(lo+hi)>>>1;if(values[mid]<=value)lo=mid+1;else hi=mid;}
  return Math.max(0,lo-1);
}
export function createRecordedReplay(record) {
  const {decoded:d}=record, samples=d.samples, points=d.points;
  if(d.kind!=='recording') return unavailable('A FIT activity or timestamped GPX recording is required; course times are not actual ride times.');
  if(samples.length<2 || samples.length>replayLimits.samples || points.length>replayLimits.points ||
    samples.some((s,i)=>!finite(s.timeMs) || i>0 && s.timeMs<=samples[i-1].timeMs))
    return unavailable('Complete strictly increasing timestamps required. Missing times are not invented; geometry animation is not recorded replay.');
  const times=samples.map(s=>(s.timeMs-samples[0].timeMs)/1000);
  // The axis is a subtotal of supported sample edges, not the geometry-only
  // analysis axis. A timestamp gap must not silently add its endpoint chord.
  const distances=[0], intervals=[], supportedPointEdges=new Set(), ambiguousDistances=new Set();
  const prefixes=[{movingSeconds:0,pausedSeconds:0,unknownSeconds:0}];
  for(let i=0;i<samples.length;i++) {
    const s=samples[i], p=points[s.pointIndex];
    if(!i)continue;
    const prev=samples[i-1], prior=points[prev.pointIndex], dt=times[i]-times[i-1];
    const a=actualAtSample(prev,d.format).speedMps, b=actualAtSample(s,d.format).speedMps;
    const step=p && prior ? horizontalDistanceM(prior,p) : null;
    const gap=dt>replayLimits.gapSeconds || !p || !prior || p.breakBefore ||
      s.pointIndex!==prev.pointIndex+1 || step>500;
    if(gap)ambiguousDistances.add(distances.at(-1));
    else supportedPointEdges.add(s.pointIndex);
    distances.push(distances.at(-1)+(gap ? 0 : step));
    const kind=gap ? 'gap' : a.status==='available' && b.status==='available' ?
      a.value===0 && b.value===0 ? 'paused' : a.value>0 && b.value>0 ? 'moving' : 'unknown' : 'unknown';
    intervals.push(kind);
    const totals={...prefixes.at(-1)};
    totals[kind==='moving' ? 'movingSeconds' : kind==='paused' ? 'pausedSeconds' : 'unknownSeconds']+=dt;
    prefixes.push(totals);
  }
  function atSecond(seconds) {
    const t=Math.max(0,Math.min(times.at(-1),seconds)), i=floorIndex(times,t), sample=samples[i];
    const exact=t===times[i], kind=intervals[i]??'finished', totals={...prefixes[i]};
    totals[kind==='moving' ? 'movingSeconds' : kind==='paused' ? 'pausedSeconds' : 'unknownSeconds']+=t-times[i];
    const point=points[sample.pointIndex];
    const known=point && (exact || kind!=='gap');
    return {status:'available',elapsedSeconds:t,durationSeconds:times.at(-1),sampleIndex:i,
      sampleTimeMs:sample.timeMs,sampleAgeSeconds:t-times[i],exactSample:exact,
      interval:kind,...totals,movingComplete:totals.unknownSeconds===0,
      distanceM:distances[i],distanceStatus:!exact && kind==='gap' ? 'unavailable-in-gap' : 'sample-subtotal',
      distanceBasis:'supported sample-edge geometry subtotal; timestamp/coordinate gaps excluded, not total actual traveled distance',
      position:known ? {...point,pointIndex:sample.pointIndex,distanceM:distances[i]} : null,
      // Do not carry telemetry forward or interpolate even across a short gap.
      signals:actualAtSample(exact ? sample : null,d.format),format:d.format};
  }
  const identity=record.analysis.identity??{routeId:record.id,revisionId:record.revisionId};
  const replay={status:'available',times,distances,intervals,supportedPointEdges,durationSeconds:times.at(-1),atSecond,
    secondAtDistance(m) {
      // Collapsed gap endpoints are different locations/times at one subtotal.
      // Do not silently select either; elapsed/sample seeking remains available.
      if(ambiguousDistances.has(m))return null;
      // Ordinary pause-only duplicates retain explicit first-arrival semantics.
      let lo=0,hi=distances.length-1;
      while(lo<hi){const mid=(lo+hi)>>>1;if(distances[mid]<m)lo=mid+1;else hi=mid;}
      return times[lo];
    }};
  replay.adapter={identity,distanceM:distances.at(-1),
    chapters:record.analysis.status==='supported' && !intervals.includes('gap') ? record.analysis.chapters : [],
    positionAt(m) {
      const second=replay.secondAtDistance(m);
      if(second===null)throw RangeError('Ambiguous recorded distance at gap');
      return {...atSecond(second).position,distanceM:m};
    },
    recordedReplay:replay};
  return replay;
}

// Conservative local segment index: bounded memory + candidate work, not
// 20k recording points × 8k route points. Never resolve a repeated occurrence
// merely by selecting the closest coordinate.
export function matchRecordedRoute(decoded, plan) {
  const stats={cellEntries:0,candidateTests:0};
  const decline=reason=>({status:'unavailable',reason,stats,points:[],segments:[]});
  const route=plan?.points, points=decoded.points;
  if(plan?.status!=='supported' || !route || route.length>replayLimits.planPoints ||
    points.length>replayLimits.points) return decline('Matching bounds or continuous planned geometry unavailable');
  const lat=route[0].lat, lon=route[0].lon;
  if(Math.abs(lat)>80 || route.some(p=>Math.abs(p.lon-lon)>5 || Math.abs(p.lat-lat)>5))
    return decline('Projection extent unsupported; no global or antimeridian matching');
  const scale=Math.cos(lat*Math.PI/180), xy=p=>[(p.lon-lon)*111195*scale,(p.lat-lat)*111195];
  const cells=new Map(), segments=[], cell=replayLimits.cellM, radius=replayLimits.corridorM;
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i],[x,y]=xy(a),[u,v]=xy(b);
    if(!finite(a.distanceM) || !finite(b.distanceM) || b.distanceM-a.distanceM>replayLimits.segmentM)
      return decline('Sparse planned segments unsupported');
    const segment={x,y,dx:u-x,dy:v-y,startM:a.distanceM,endM:b.distanceM};
    segments.push(segment);
    for(let cx=Math.floor((Math.min(x,u)-radius)/cell);cx<=Math.floor((Math.max(x,u)+radius)/cell);cx++)
      for(let cy=Math.floor((Math.min(y,v)-radius)/cell);cy<=Math.floor((Math.max(y,v)+radius)/cell);cy++) {
        if(++stats.cellEntries>replayLimits.cellEntries)return decline('Matching index budget exceeded');
        const key=`${cx},${cy}`;
        if(!cells.has(key))cells.set(key,[]);
        cells.get(key).push(segment);
      }
  }
  let last=null;
  const matches=[];
  for(const p of points) {
    const [x,y]=xy(p), candidates=[];
    for(const s of cells.get(`${Math.floor(x/cell)},${Math.floor(y/cell)}`)??[]) {
      if(++stats.candidateTests>replayLimits.candidateTests)return decline('Matching candidate budget exceeded');
      const length2=s.dx*s.dx+s.dy*s.dy;
      const f=length2 ? Math.max(0,Math.min(1,((x-s.x)*s.dx+(y-s.y)*s.dy)/length2)) : 0;
      const errorM=Math.hypot(x-s.x-f*s.dx,y-s.y-f*s.dy);
      if(errorM<=radius)candidates.push({distanceM:s.startM+f*(s.endM-s.startM),errorM,
        dx:s.dx,dy:s.dy,length:Math.sqrt(length2)});
    }
    candidates.sort((a,b)=>a.distanceM-b.distanceM);
    let m;
    if(!candidates.length)m={status:'off-route'};
    else if(candidates.at(-1).distanceM-candidates[0].distanceM>replayLimits.occurrenceM)
      m={status:'ambiguous',reason:'Multiple route occurrences within corridor'};
    else {
      const best=candidates.reduce((a,b)=>a.errorM<=b.errorM?a:b);
      const opposing=candidates.some(c=>Math.abs(c.distanceM-best.distanceM)>20 &&
        c.length>0 && best.length>0 && (c.dx*best.dx+c.dy*best.dy)/(c.length*best.length)<.5);
      if(opposing)m={status:'ambiguous',reason:'Conflicting nearby directions/occurrences'};
      else if(last!==null && best.distanceM<last-1) m={status:'ambiguous',reason:'Reversal in route order'};
      else {m={status:'matched',distanceM:best.distanceM,errorM:best.errorM};last=Math.max(last??0,best.distanceM);m.distanceM=last;}
    }
    matches.push(m);
  }
  // Only consecutive, continuous recording edges qualify. Isolated coordinate
  // hits are not aligned segments, and no detour/gap is bridged.
  const aligned=[];
  const pointTimes=new Map(decoded.samples.map(s=>[s.pointIndex,s.timeMs]));
  for(let i=1;i<matches.length;i++) {
    const a=matches[i-1],b=matches[i],p=points[i],prior=points[i-1];
    const run=horizontalDistanceM(prior,p);
    const t0=pointTimes.get(i-1),t1=pointTimes.get(i);
    if(a.status!=='matched' || b.status!=='matched' || p.breakBefore || run>500 ||
      !finite(t0) || !finite(t1) || t1-t0>replayLimits.gapSeconds*1000 ||
      b.distanceM-a.distanceM>Math.max(100,run*2)) continue;
    const previous=aligned.at(-1);
    if(previous?.endPoint===i-1){previous.endPoint=i;previous.endM=b.distanceM;}
    else aligned.push({startPoint:i-1,endPoint:i,startM:a.distanceM,endM:b.distanceM});
  }
  const member=new Set();
  for(const s of aligned)for(let i=s.startPoint;i<=s.endPoint;i++)member.add(i);
  matches.forEach((m,i)=>{if(m.status==='matched'&&!member.has(i))matches[i]={status:'ambiguous',reason:'Isolated hit; no continuous alignment'};});
  return {status:aligned.length?'available':'declined',points:matches,segments:aligned,stats,
    confidence:'conservative corridor + unique occurrence + monotonic sequence, not exact GPS truth',
    coverage:'Only listed aligned segments; never a whole-route completion claim'};
}

export function compareRecorded(actual, match, plan, estimate, basis) {
  if(!['elapsed','distance'].includes(basis))return unavailable('Choose an explicit comparison basis');
  if(!actual?.position)return unavailable('Recorded position unavailable in timestamp/coordinate gap');
  const aligned=match?.points[actual.position.pointIndex];
  if(aligned?.status!=='matched')return unavailable(aligned?.status??match?.reason??'No supported alignment');
  if(estimate?.status==='available' && JSON.stringify(estimate.identity)!==JSON.stringify(plan.identity))
    return unavailable('Modeled plan revision/analysis identity mismatch');
  let plannedM, deltaSeconds=null;
  if(basis==='elapsed') {
    // Time zero is route start, not inferred recording start on a partial ride.
    // Explicitly refuse temporal alignment of partial-start recordings.
    if(match.points[0]?.status!=='matched' || match.points[0].distanceM>30)
      return unavailable('Elapsed comparison requires recording beginning at planned start; use matched distance for partial overlap');
    const clock=createRouteClock(estimate);
    if(clock.status!=='available')return unavailable('Planned time model unavailable; actual replay remains available');
    plannedM=clock.atSecond(actual.elapsedSeconds).distanceM;
  } else {
    plannedM=aligned.distanceM;
    const at=routeTimeAtDistance(estimate,plannedM);
    if(at.status==='available' && match.points[0]?.status==='matched' && match.points[0].distanceM<=30)
      deltaSeconds=actual.elapsedSeconds-at.elapsedSeconds;
  }
  return {status:'available',basis,planned:positionAt(plan,plannedM),actual:actual.position,
    alignedDistanceM:aligned.distanceM,deltaM:aligned.distanceM-plannedM,deltaSeconds,
    separationM:horizontalDistanceM(actual.position,positionAt(plan,plannedM)),
    identity:plan.identity,confidence:match.confidence};
}
