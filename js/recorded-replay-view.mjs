import { actualSignals, matchRecordedRoute, compareRecorded } from './recorded-replay.mjs';
import { routePlayback, subscribePlayback } from './route-session.mjs';
import { routePace, paceScenarios } from './route-pace.mjs';
import { outlineProjection } from './route-briefing.mjs';
import { horizontalDistanceM } from './route-analysis.mjs';

const node=(tag,text,parent,id)=>{
  const e=document.createElement(tag);e.textContent=text;parent.append(e);if(id)e.id=id;return e;
};
const svgNode=(tag,attrs,parent)=>{
  const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);
  parent.append(e);return e;
};
const coord=p=>p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : 'unavailable';
const seconds=n=>`${n.toFixed(1)} s`;
export function installRecordedReplay(parent,{plans,onSeek}) {
  const root=node('section','',parent,'recorded-replay');root.hidden=true;
  root.setAttribute('aria-label','Private recorded replay');
  let record=null,replay=null,draw=()=>{},refreshModel=()=>{};
  const act=(command,...args)=>onSeek(routePlayback[command](...args));
  function clear() {
    record=null;replay=null;draw=()=>{};refreshModel=()=>{};root.replaceChildren();root.hidden=true;
  }
  function build() {
    node('h2','Recorded ride replay · private on this device',root);
    node('p',`${record.name} · source ${record.decoded.format} decoded samples · local revision ${record.revisionId}. `+
      'Not live GPS, navigation, ranking or sharing. No recording coordinates are requested from a map service.',root);
    if(replay.status!=='available') {node('p',replay.reason,root,'replay-unavailable');return;}
    node('p','Recorded elapsed is timestamp minus first timestamp. Playback 1× advances one source second per accepted animation second; '+
      'rate changes presentation only. Moving/paused intervals require valid speed at both endpoints (>0 / both 0 m/s); '+
      'other intervals stay unknown. Gaps over 30 s, disconnected segments and missing positions are unknown, not pauses. '+
      'Signals appear only at their exact sample time: no holding, interpolation, modeled actuals or heart-rate fabrication.',root);
    const status=node('p','',root,'replay-position');
    const signals=node('dl','',root,'replay-signals'), values={};
    for(const [key,def] of Object.entries(actualSignals)) {
      node('dt',`${{powerW:'Actual power',cadenceRpm:'Actual cadence',speedMps:'Actual speed',heartRateBpm:'Actual heart rate'}[key]} (${def.unit})`,signals);
      values[key]=node('dd','unavailable',signals,`replay-${key}`);
    }
    const deck=node('div','',root,'replay-controls');deck.className='site-actions';
    const button=(text,id,fn)=>{const b=node('button',text,deck,id);b.type='button';b.onclick=fn;return b;};
    const play=button('Play recorded replay','replay-play',()=>act(routePlayback.getSnapshot().phase==='playing'?'pause':'play'));
    button('Restart recording','replay-restart',()=>act('seekRecordedSeconds',0));
    button('Route overview (keep position)','replay-overview',()=>act('backToOverview'));
    function sampleStep(delta) {
      const current=routePlayback.getSnapshot().recordedClock;
      const i=Math.max(0,Math.min(replay.times.length-1,current.sampleIndex+delta));
      act('seekRecordedSeconds',replay.times[i]);
    }
    button('Previous recorded sample','replay-previous',()=>sampleStep(-1));
    button('Next recorded sample','replay-next',()=>sampleStep(1));
    const label=node('label','Recorded elapsed seconds',root);
    const seek=node('input','',label,'replay-seek');seek.type='range';seek.min=0;seek.max=replay.durationSeconds;seek.step='any';
    seek.oninput=()=>act('seekRecordedSeconds',Number(seek.value));
    seek.onkeydown=e=>{
      if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(e.key)) {
        e.preventDefault();
        if(e.key==='Home'||e.key==='End')act('seekRecordedSeconds',e.key==='Home'?0:replay.durationSeconds);
        else sampleStep(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1);
      }
    };
    const rateLabel=node('label','Replay rate (not actual riding speed)',root),rate=node('select','',rateLabel,'replay-rate');
    for(const n of [.5,1,2,4])rate.add(new Option(`${n}×`,n));
    rate.onchange=()=>act('setAnimationRate',Number(rate.value));
    if(replay.intervals.includes('gap'))
      node('p','Gaps prevent use of the continuous geometry chapter-distance axis. Use recorded elapsed or sample seeking; collapsed gap endpoints cannot be selected unambiguously by distance.',root);
    if(replay.adapter.chapters.length) {
      const chapters=node('details','',root);
      node('summary','Linked recorded route sections',chapters);
      node('p','These are geometry-derived sections from the shared briefing analysis, not recorded laps. Distance seeks choose first recorded arrival; use elapsed seek inside pauses.',chapters);
      const list=node('ol','',chapters);
      for(const [i,c] of replay.adapter.chapters.entries()) {
        const li=node('li','',list),b=node('button',`${i+1}. ${c.kind} · ${(c.startM/1000).toFixed(2)}–${(c.endM/1000).toFixed(2)} km`,li);
        b.type='button';b.onclick=()=>act('selectChapter',c.id);
      }
    }
    node('h3','Linked local outline and raw elevation samples',root);
    node('p','North up; S = first coordinate, F = last. Rust marker = recorded sample (last known between samples, age shown above); blue = modeled planned position. '+
      'Elevation is raw recorded sample height, not a smoothed or interpolated actual. Tap profile to seek elapsed time, or use the keyboard slider/sample buttons.',root);
    const map=svgNode('svg',{viewBox:'0 0 400 400',role:'img','aria-label':'Local recorded outline and selected sample. Exact coordinates and comparison positions are also written as text.'},root);
    map.id='replay-map';
    const profile=svgNode('svg',{viewBox:'0 0 1000 180',role:'img','aria-label':'Raw elevation samples by recorded elapsed seconds. Missing heights and gaps are not joined.'},root);
    profile.id='replay-profile';
    profile.onclick=e=>{
      const rect=profile.getBoundingClientRect();
      act('seekRecordedSeconds',(e.clientX-rect.left)/rect.width*replay.durationSeconds);
    };
    let project,actualDot,plannedDot;
    function drawMap(plan=null) {
      map.replaceChildren();
      project=outlineProjection([...record.decoded.points,...(plan?.points??[])]);
      function path(points,color,supportedEdges=null) {
        // Keep separate runs. Bounded display sampling never bridges a break.
        const step=Math.max(1,Math.ceil(points.length/3000));let d='';
        const breaks=i=>!i || (supportedEdges ? !supportedEdges.has(i) :
          points[i].breakBefore || horizontalDistanceM(points[i-1],points[i])>500);
        for(let i=0;i<points.length;i++) {
          const p=points[i],broken=breaks(i);
          if(broken || i===points.length-1 || i%step===0 ||
            points[i+1] && breaks(i+1))
            d+=`${broken?' M':' L'}${project(p).join(',')}`;
        }
        svgNode('path',{d,fill:'none',stroke:color,'stroke-width':2},map);
      }
      if(plan)path(plan.points,'#2466a0');
      path(record.decoded.points,'#729379',replay.supportedPointEdges);
      for(const [p,text] of [[record.decoded.points[0],'S'],[record.decoded.points.at(-1),'F']]) {
        const [x,y]=project(p);svgNode('text',{x,y:y-8},map).textContent=text;
      }
      actualDot=svgNode('circle',{r:5,fill:'#8a3c22'},map);
      plannedDot=svgNode('circle',{r:5,fill:'#2466a0',visibility:'hidden'},map);
    }
    drawMap();
    const heights=record.decoded.points.map(p=>p.elevationM).filter(Number.isFinite);
    const lo=heights.length?Math.min(...heights):0,hi=heights.length?Math.max(...heights):1;
    node('p',`Raw height range: ${heights.length?`${lo.toFixed(0)}–${hi.toFixed(0)} m`:'unavailable'}. Profile horizontal axis: 0–${seconds(replay.durationSeconds)} recorded elapsed. `+
      'Distance totals exclude disconnected/gap edges; no whole-route completion is inferred.',root);
    const y=h=>155-130*(h-lo)/Math.max(1,hi-lo);
    // Dots, not joined lines: never imply elevation across missing samples.
    const step=Math.max(1,Math.ceil(record.decoded.samples.length/3000));
    for(let i=0;i<record.decoded.samples.length;i+=step) {
      const p=record.decoded.points[record.decoded.samples[i].pointIndex];
      if(Number.isFinite(p?.elevationM))svgNode('circle',{cx:1000*replay.times[i]/replay.durationSeconds,cy:y(p.elevationM),r:2,fill:'#729379'},profile);
    }
    const cursor=svgNode('line',{y1:0,y2:180,stroke:'#8a3c22','stroke-width':3},profile);
    const detail=node('details','',root,'replay-comparison');node('summary','Compare with an exact planned revision',detail);
    node('p','Choose the intended route revision yourself: the recording does not certify one. Any changed choice requires acknowledgment. '+
      'Matching is conservative, not exact GPS truth: 30 m corridor, unique occurrence within 100 m of route distance, monotonic order; '+
      'loops/reversals/isolated hits can be declined. Only continuous aligned segments count. These thresholds are not safety guidance.',detail);
    const chooseLabel=node('label','Planned route / exact revision',detail),choose=node('select','',chooseLabel,'replay-plan');
    choose.add(new Option('Choose explicitly',''));
    const choices=plans();
    for(const p of choices)choose.add(new Option(`${p.name} · ${p.revisionId}`,p.revisionId));
    const basisLabel=node('label','Comparison basis',detail),basis=node('select','',basisLabel,'replay-basis');
    basis.add(new Option('Choose explicitly',''));
    basis.add(new Option('Recorded elapsed since planned start (modeled plan)','elapsed'));
    basis.add(new Option('Matched route distance (aligned segments only)','distance'));
    const ackLabel=node('label','',detail),ack=node('input','',ackLabel,'replay-ack');ack.type='checkbox';
    ackLabel.append(document.createTextNode('I choose this exact planned revision and basis, including any change from my previous choice. Elapsed basis assumes recording starts at the planned route start.'));
    const apply=node('button','Apply acknowledged comparison',detail,'replay-apply');apply.type='button';
    const selection=node('p','No planned route or basis selected.',detail,'replay-selection');selection.setAttribute('role','status');
    const scenarioLabel=node('label','Modeled plan effort (never actual power)',detail),scenario=node('select','',scenarioLabel,'replay-scenario');
    for(const [key,text] of Object.entries(paceScenarios))scenario.add(new Option(text,key));
    scenario.value=routePace.snapshot().scenario;scenario.onchange=()=>routePace.setScenario(scenario.value);
    const assumptions=node('p','',detail,'replay-assumptions');
    const limits=node('p','',detail,'replay-alignment');
    const comparison=node('p','Choose a plan and basis; acknowledge to compare.',detail,'replay-difference');
    let selected=null,matched=null,estimate=null,selectedBasis=null;
    function resetComparison() {
      routePlayback.pause();ack.checked=false;selected=null;matched=null;estimate=null;selectedBasis=null;
      selection.textContent='Selection changed; acknowledge exact revision and basis before comparison.';
      limits.textContent='';assumptions.textContent='';comparison.textContent='Comparison not applied.';
      comparison.dataset.status='unavailable';drawMap();draw(routePlayback.getSnapshot());
    }
    choose.onchange=basis.onchange=resetComparison;
    apply.onclick=()=>{
      if(!ack.checked || !choose.value || !basis.value) {
        selection.textContent='Choose an exact revision and basis, then acknowledge.';return;
      }
      const p=choices.find(p=>p.revisionId===choose.value),analysis=p?.analysis();
      if(!analysis || analysis.status!=='supported') {
        selection.textContent='Exact planned geometry unavailable or still loading. Retry explicitly; no different revision substituted.';return;
      }
      routePlayback.pause();selected=analysis;selectedBasis=basis.value;
      matched=matchRecordedRoute(record.decoded,selected);
      selection.textContent=`Source: ${p.name} · ${p.source} · exact revision ${p.revisionId} · basis: ${selectedBasis==='elapsed'?'recorded elapsed since planned start':'matched route distance'}.`;
      const unmatched=[];
      matched.points.forEach((p,i)=>{
        if(p.status==='matched')return;
        const last=unmatched.at(-1);
        if(last?.end===i-1 && last.status===p.status)last.end=i;
        else unmatched.push({start:i,end:i,status:p.status});
      });
      limits.textContent=`${matched.status}: ${matched.reason??matched.confidence}. `+
        `${matched.segments.length} aligned segment(s), only: `+
        matched.segments.slice(0,100).map(s=>`${(s.startM/1000).toFixed(3)}–${(s.endM/1000).toFixed(3)} km (recorded points ${s.startPoint+1}–${s.endPoint+1})`).join('; ')+
        `. Unmatched ranges (${unmatched.length}): `+
        unmatched.slice(0,100).map(s=>`${s.status}, recorded points ${s.start+1}–${s.end+1}`).join('; ')+
        '. Lists show at most the first 100 ranges each; other positions still decline at seek. Off-route and ambiguous portions are not aligned; partial overlap is not a whole-route match.';
      drawMap(selected);refreshModel();
    };
    refreshModel=()=>{
      if(!selected)return;
      estimate=routePace.model(selected);
      scenario.value=routePace.snapshot().scenario;
      assumptions.textContent=estimate.status==='available' ?
        `Modeled plan only: ${JSON.stringify(estimate.assumptions)}. 90% FTP is an assumption, not actual power or a sustainability claim. Recorded values are unchanged.` :
        'Planned time model unavailable (invalid inputs or model domain, including unsupported D4S grades). Distance comparison and actual replay remain available; no estimate is coerced.';
      draw(routePlayback.getSnapshot());
    };
    draw=s=>{
      if(s.identity?.routeId!==record.id || s.recordedClock.status!=='available')return;
      const a=s.recordedClock;
      status.textContent=`Recorded elapsed ${seconds(a.elapsedSeconds)} / ${seconds(a.durationSeconds)} · ${a.interval}. `+
        `Speed-qualified moving ${seconds(a.movingSeconds)}, paused ${seconds(a.pausedSeconds)}, unknown/gaps ${seconds(a.unknownSeconds)} (not a complete device moving-time total). `+
        `Sample ${a.sampleIndex+1} at ${new Date(a.sampleTimeMs).toISOString()}, age ${seconds(a.sampleAgeSeconds)}; ${a.exactSample?'exact sample':'last-known position only, no interpolated actuals'}. `+
        `Position ${coord(a.position)} · raw elevation ${Number.isFinite(a.position?.elevationM)?`${a.position.elevationM.toFixed(1)} m`:'unavailable'} · `+
        `${(a.distanceM/1000).toFixed(3)} km ${a.distanceBasis}. `+
        `${a.distanceStatus==='unavailable-in-gap'?'Current distance unavailable inside gap; displayed subtotal is last supported geometry. ':''}`+
        `${s.seekNotice??''} ${s.phase}.`;
      for(const key of Object.keys(actualSignals)) {
        const v=a.signals[key];
        values[key].textContent=v.status==='available'?`${v.value} ${v.unit} · ${v.provenance} · ${new Date(v.timeMs).toISOString()}`:'unavailable — no valid sample at this time';
      }
      seek.value=a.elapsedSeconds;seek.setAttribute('aria-valuetext',`${seconds(a.elapsedSeconds)} recorded elapsed; sample ${a.sampleIndex+1}`);
      rate.value=s.animationRate;play.textContent=s.phase==='playing'?'Pause recorded replay':'Play recorded replay';
      for(const e of [map,profile,status])e.dataset.distance=String(s.distanceM);
      cursor.setAttribute('x1',1000*a.elapsedSeconds/replay.durationSeconds);cursor.setAttribute('x2',1000*a.elapsedSeconds/replay.durationSeconds);
      actualDot.setAttribute('visibility',a.position?'visible':'hidden');
      if(a.position){const [x,y]=project(a.position);actualDot.setAttribute('cx',x);actualDot.setAttribute('cy',y);}
      plannedDot.setAttribute('visibility','hidden');
      if(!selected)return;
      const c=compareRecorded(a,matched,selected,estimate,selectedBasis);
      comparison.dataset.status=c.status;
      if(c.status!=='available'){comparison.textContent=`Comparison unavailable: ${c.reason}. Actual replay is independent.`;return;}
      comparison.textContent=`Basis ${selectedBasis==='elapsed'?'recorded elapsed':'matched route distance'} · planned position ${coord(c.planned)} at ${(c.planned.distanceM/1000).toFixed(3)} km; `+
        `recorded ${coord(c.actual)} (sample age ${seconds(a.sampleAgeSeconds)}), aligned ${(c.alignedDistanceM/1000).toFixed(3)} km. `+
        `Recorded minus planned route progress ${c.deltaM.toFixed(1)} m; spatial separation ${c.separationM.toFixed(1)} m. `+
        `Recorded elapsed minus modeled arrival ${c.deltaSeconds===null?'unavailable (time basis/model/start not applicable)':seconds(c.deltaSeconds)}. `+
        'Not a ranking; planned time and positions use model assumptions. Matched distance selects modeled arrival, not a moment inside a planned stop.';
      const [x,y]=project(c.planned);plannedDot.setAttribute('cx',x);plannedDot.setAttribute('cy',y);plannedDot.setAttribute('visibility','visible');
    };
  }
  subscribePlayback(s=>{if(!root.hidden)draw(s);});
  routePace.subscribe(()=>{if(!root.hidden)refreshModel();});
  return {root,forget(id){if(record?.id===id)clear();},
    show(r,model,visible) {
      if(!r || r.decoded.kind!=='recording' || !visible){clear();return;}
      root.hidden=false;
      if(record!==r){clear();root.hidden=false;record=r;replay=model;build();}
      draw(routePlayback.getSnapshot());
    }};
}
