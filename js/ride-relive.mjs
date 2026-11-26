// Shared-player adapter only. Decoder, consent library, signal semantics and
// source clock remain owned by the existing local/replay modules. No RAF/I/O.
import { installLocalRoutes } from './local-routes-view.mjs';
import { createRecordedReplay, matchRecordedRoute, compareRecorded } from './recorded-replay.mjs';
import { createRoutePlayback } from './route-playback.mjs';
import { estimateRouteTime } from './route-time.mjs';
import { outlineProjection } from './route-briefing.mjs';

const $=id=>document.getElementById(id);
const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
const element=(tag,parent,id,copy='')=>{
  const el=document.createElement(tag);el.id=id;el.textContent=copy;parent.append(el);return el;
};
const svg=(tag,attrs,parent)=>{
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
  parent.append(el);return el;
};
export function installRideRelive({beforeOpen,open,removed,changed,cancelled,seek,pause,publicPlan}) {
  const root=element('details',$('tools-panel'),'relive-sheet');
  $('ride-mode').parentElement.after(root);
  element('summary',root,'relive-entry','Relive a private recording');
  element('p',root,'relive-help','FIT activity or timestamped GPX · private first-party 2D only. No uploads. Courses without timestamps are geometry-only exploration.');
  const library=installLocalRoutes(root,{beforeOpen,open,removed,changed,cancelled});
  const message=element('p',root,'relive-message');message.setAttribute('role','status');
  const controls=element('div',root,'relive-controls');controls.hidden=true;
  element('p',controls,'relive-source');
  const steps=element('div',controls,'relive-steps');steps.className='section-actions';
  for(const [id,label,delta] of [['relive-previous','Previous sample',-1],['relive-next','Next sample',1]]) {
    element('button',steps,id,label).onclick=()=>{
      const a=actual(),i=Math.max(0,Math.min(replay.times.length-1,a.sampleIndex+delta));
      seek(replay.times[i]);
    };
  }
  const label=element('label',controls,'relive-seek-label','Recorded elapsed seconds');
  const elapsed=element('input',label,'relive-seek');elapsed.type='range';elapsed.min=0;elapsed.step='any';
  elapsed.oninput=()=>seek(Number(elapsed.value));
  element('p',controls,'relive-sample');
  element('p',controls,'relive-totals');
  element('p',controls,'relive-semantics','Sensors appear only at exact source samples, never interpolated or carried forward. Between samples the dot is the last known source position; age is shown. Inside gaps no position or sensors are shown. Distance is a supported-edge subtotal, not total actual travel. Raw elevation dots use recorded elapsed, not movie fraction.');
  const alternative=element('button',root,'relive-alternative','Try modeled alternative');
  alternative.hidden=true;
  const compare=element('details',controls,'relive-comparison');
  element('summary',compare,'relive-comparison-title','Plan vs actual · aligned segments only');
  element('p',compare,'relive-plan');
  const basisLabel=element('label',compare,'relive-basis-label','Comparison time / distance basis');
  const basis=element('select',basisLabel,'relive-basis');
  basis.add(new Option('Choose explicitly',''));
  basis.add(new Option('Matched distance · modeled arrival','distance'));
  basis.add(new Option('Elapsed since planned route start','elapsed'));
  element('p',compare,'relive-plan-assumptions','Plan: example rider 75 kg, FTP 220 W, bike + kit 12 kg, Steady 75%, still air, no stops. Not the frozen Experiment ghost. Only conservative aligned segments qualify; loops, reversals, gaps and off-route portions may decline. No itinerary assignment or whole-route verdict.');
  const apply=element('button',compare,'relive-compare','Compare with this exact public revision');
  element('p',compare,'relive-alignment');
  element('p',compare,'relive-difference');
  element('button',root,'relive-public','Return to public exploration');
  const shelf=element('details',root,'relive-library');
  element('summary',shelf,'relive-library-title','Import / remembered library / remove');
  shelf.append(library.root,$('local-details'));shelf.open=true;
  let record,replay,clock,plan,match,estimate,comparisonBasis,project;
  const actual=()=>clock?.getSnapshot().recordedClock;
  function clearComparison() {
    plan=match=estimate=comparisonBasis=undefined;basis.value='';
    text('relive-alignment','');text('relive-difference','No comparison applied.');
    $('relive-difference').dataset.status='unavailable';
  }
  basis.onchange=()=>{pause();plan=match=estimate=comparisonBasis=undefined;
    $('relive-difference').dataset.status='unavailable';
    text('relive-alignment','');text('relive-difference','Basis changed; apply explicitly.');};
  apply.onclick=()=>{
    pause();const chosen=publicPlan();
    if(!chosen || !basis.value) {text('relive-difference','Choose a basis and an available public revision. Actual replay remains available.');return;}
    plan=chosen.analysis;comparisonBasis=basis.value;
    match=matchRecordedRoute(record.decoded,plan);estimate=estimateRouteTime(plan,{scenario:'steady'});
    text('relive-alignment',`${match.status}: ${match.reason??match.confidence}. ${match.segments.length} supported segment(s) only: ${
      match.segments.slice(0,100).map(s=>`${(s.startM/1000).toFixed(3)}–${(s.endM/1000).toFixed(3)} km`).join('; ')}. ${
      match.segments.length>100?'First 100 shown. ':''}Ambiguous/off-route/gap portions excluded; never a whole-route match.`);
    render();
  };
  function clear() {
    clock?.pause();clock=record=replay=project=undefined;controls.hidden=true;alternative.hidden=true;
    clearComparison();text('relive-message','');text('relive-source','');text('relive-sample','');
    text('relive-totals','');text('relive-plan','');
    elapsed.max=0;elapsed.value=0;elapsed.removeAttribute('aria-valuetext');
  }
  async function load(r) {
    clear();record=r;replay=createRecordedReplay(r);
    alternative.hidden=false;
    alternative.disabled=r.analysis.status!=='supported' || replay.intervals?.includes('gap');
    text('relive-message',replay.status==='available' ? 'Recording ready · paused · nothing uploaded.' :
      `${replay.reason} Geometry-only exploration when continuous analysis is supported.`);
    if(replay.status!=='available')return replay;
    const player=createRoutePlayback({loadRoute:async()=>replay.adapter});
    clock=player;await player.selectRoute(replay.adapter.identity);
    if(clock!==player)return {status:'unavailable',reason:'Selection changed.'};
    controls.hidden=false;elapsed.max=replay.durationSeconds;
    shelf.open=false;
    text('relive-source',`${r.name} · ${r.decoded.format} decoded recording · private on this device`);
    const publicRoute=publicPlan();
    text('relive-plan',publicRoute ? `Optional plan: ${publicRoute.name} · exact revision ${publicRoute.analysis.identity.revisionId}. Applying confirms this revision and basis.` :
      'No valid public revision selected. Actual replay remains available.');
    return replay;
  }
  function draw() {
    const map=$('player-map'),profile=$('player-profile'),points=record.decoded.points;
    map.replaceChildren();profile.replaceChildren();
    project=outlineProjection(points);
    // Independent supported edges: never simplify across a gap into a chord.
    let path='';
    for(let i=0;i<points.length;i++)path+=`${replay.supportedPointEdges.has(i)?' L':' M'}${project(points[i]).join(',')}`;
    map.setAttribute('viewBox','0 0 400 400');
    svg('path',{d:path,class:'track'},map);
    svg('circle',{id:'outline-rider',r:5,fill:'#dfb767',stroke:'white','stroke-width':2},map);
    const heights=points.map(p=>p.elevationM).filter(Number.isFinite);
    const low=Math.min(...heights),high=Math.max(...heights);
    const step=Math.max(1,Math.ceil(record.decoded.samples.length/3000));
    for(let i=0;i<record.decoded.samples.length;i+=step) {
      const p=points[record.decoded.samples[i].pointIndex];
      if(Number.isFinite(p?.elevationM))svg('circle',{cx:640*replay.times[i]/replay.durationSeconds,
        cy:90-80*(p.elevationM-low)/(high-low||1),r:2,fill:'#dfb767'},profile);
    }
    svg('line',{id:'profile-cursor',y1:0,y2:100,stroke:'white','stroke-width':2},profile);
  }
  function render() {
    const a=actual();if(!a || a.status!=='available')return;
    const known=a.position,exact=a.exactSample;
    const signal=(key,multiplier=1,decimals=0)=>a.signals[key].status==='available' ?
      (a.signals[key].value*multiplier).toFixed(decimals) : '—';
    const source=exact?'exact sample':a.interval==='gap'?'gap · unknown':'between samples';
    const sample=`Sample ${a.sampleIndex+1} · ${new Date(a.sampleTimeMs).toISOString()} · age ${a.sampleAgeSeconds.toFixed(1)} s`;
    text('ride-speed',signal('speedMps',3.6,1));text('speed-provenance','km/h · recorded');
    text('ride-power',signal('powerW')+' W');text('ride-effort',`Recorded · ${source}`);
    const processed=exact && record.analysis.status==='supported' && !replay.intervals.includes('gap') ?
      (record.analysis.windows.find(w=>a.distanceM<w.endM)??record.analysis.windows.at(-1)).gradePercent : null;
    text('ride-grade',Number.isFinite(processed)?processed.toFixed(1)+'%':'—');
    text('ride-gear','Not recorded');text('ride-cadence',signal('cadenceRpm')+' rpm · recorded');
    text('ride-elapsed',`Source ${a.elapsedSeconds.toFixed(1)} / ${a.durationSeconds.toFixed(1)} s`);
    text('ride-remaining','Recorded time, not modeled duration');
    text('model-provenance',`${record.decoded.format} recorded samples`);
    text('road-current',a.interval==='gap'&&!exact?'Recording gap · position unknown':
      `${source} · ${a.interval} · age ${a.sampleAgeSeconds.toFixed(1)} s`);
    text('road-ahead',exact?`Sample ${a.sampleIndex+1} · ${signal('cadenceRpm')} rpm`:
      known?'Last-known source position only; sensors unavailable':'No position or sensors inferred');
    text('relive-sample',`${sample}. ${exact?'Exact source sample.':known?'Last-known position only, NOT current telemetry.':'Position unknown inside recording gap.'}`);
    text('relive-totals',`Speed-qualified moving ${a.movingSeconds.toFixed(1)} s · paused ${a.pausedSeconds.toFixed(1)} s · unknown ${a.unknownSeconds.toFixed(1)} s. Not a complete device moving-time total.`);
    text('ride-notice',`${clock.getSnapshot().phase} · recorded ${source}`);
    text('progress',a.distanceStatus==='unavailable-in-gap'?'Distance unknown':`${(a.distanceM/1000).toFixed(3)} km subtotal`);
    text('position',`${a.elapsedSeconds.toFixed(1)} s source elapsed`);
    text('height',Number.isFinite(known?.elevationM)?`${known.elevationM.toFixed(0)} m raw sample`:'Height unknown');
    elapsed.value=a.elapsedSeconds;
    elapsed.setAttribute('aria-valuetext',`${a.elapsedSeconds.toFixed(1)} source seconds; ${sample}`);
    $('seek').value=1000*a.elapsedSeconds/a.durationSeconds;
    const x=640*a.elapsedSeconds/a.durationSeconds;
    $('profile-cursor')?.setAttribute('x1',x);$('profile-cursor')?.setAttribute('x2',x);
    $('player-profile').setAttribute('aria-valuenow',String(1000*a.elapsedSeconds/a.durationSeconds));
    $('player-profile').setAttribute('aria-valuetext',`${a.elapsedSeconds.toFixed(1)} recorded seconds; ${source}`);
    const dot=$('outline-rider');dot?.setAttribute('visibility',known?'visible':'hidden');
    if(known&&project){const [x,y]=project(known);dot?.setAttribute('cx',x);dot?.setAttribute('cy',y);}
    Object.assign($('cockpit').dataset,{status:'available',motion:a.interval,seconds:String(a.elapsedSeconds),
      distance:String(a.distanceM),sample:String(a.sampleIndex),age:String(a.sampleAgeSeconds),exact:String(exact),origin:'',history:''});
    if(plan) {
      const c=compareRecorded(a,match,plan,estimate,comparisonBasis);
      $('relive-difference').dataset.status=c.status;
      text('relive-difference',c.status!=='available'?`Comparison unavailable: ${c.reason}. Actual replay remains available.`:
        `Basis ${comparisonBasis} · aligned ${(c.alignedDistanceM/1000).toFixed(3)} km · recorded minus modeled progress ${c.deltaM.toFixed(1)} m · arrival ${
          c.deltaSeconds===null?'unavailable':c.deltaSeconds.toFixed(1)+' s'}. Source position age ${a.sampleAgeSeconds.toFixed(1)} s. Supported segment only, not a whole-route verdict.`);
    }
  }
  return {library,root,load,clear,clearComparison,draw,render,actual,
    get replay(){return replay;},get clock(){return clock;},get record(){return record;}};
}
