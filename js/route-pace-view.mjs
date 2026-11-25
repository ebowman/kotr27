import { routePace, paceScenarios, sensitivityProfile, formatDuration } from './route-pace.mjs';
import { routePlayback, subscribePlayback } from './route-session.mjs';
import { createRouteClock } from './ride-clock.mjs';

const node = (tag, text, parent, id) => {
  const e = document.createElement(tag); e.textContent = text; parent.append(e);
  if (id) e.id = id;
  return e;
};
export function installRoutePace(parent, preferences, onSeek) {
  const root = node('section','',parent,'route-pace'); root.hidden = true;
  root.setAttribute('aria-label','Route pace and ride clock');
  const heading = node('h2','',root);
  node('p','Explore with fictional 75 kg / 220 W assumptions; no FTP required. Bike/kit stays 12 kg. ' +
    'Optional entries share Preferences & privacy; memory only unless you explicitly remember rider data there. ' +
    'Scenario and chapter stops are document-memory only, never shared links or saved preferences. ' +
    'Reload or opening a legacy example engine in the other HTML document loses unsaved choices; ' +
    'ordinary route, revision and Plan/Explore changes keep them.',root);
  const inputs = node('div','',root); inputs.className = 'site-choices';
  const input = (label,id,type='text') => {
    const e=node('input','',node('label',label,inputs),id); e.type=type; return e;
  };
  const mass=input('Optional rider weight','pace-mass'); mass.inputMode='decimal';
  const unit=node('select','',node('label','Weight unit',inputs),'pace-unit');
  for (const u of ['kg','lb']) unit.add(new Option(u,u));
  const ftp=input('Optional FTP (W)','pace-ftp'); ftp.inputMode='decimal';
  for (const e of [mass,ftp]) { e.autocomplete='off'; e.spellcheck=false; e.setAttribute('aria-describedby','pace-validation'); }
  const validation=node('p','',root,'pace-validation'); validation.setAttribute('role','status');
  const clear=node('button','Clear rider values · use example',root,'pace-clear'); clear.type='button';
  clear.onclick=()=>preferences.example();
  mass.oninput=()=>preferences.update({mass:mass.value,enteredUnit:unit.value});
  ftp.oninput=()=>preferences.update({ftp:ftp.value});
  unit.onchange=()=>preferences.update({unit:unit.value});
  const scenario=node('select','',node('label','Shared route scenario',root),'pace-scenario');
  for (const [value,label] of Object.entries(paceScenarios)) scenario.add(new Option(label,value));
  scenario.value='steady'; scenario.onchange=()=>routePace.setScenario(scenario.value);
  const assumptions=node('p','',root,'pace-assumptions');
  node('p','Constant-effort estimates, not physiology or guaranteed sustainable power. All Day uses a single ' +
    '75% moving-duration seed and duration bands, not fitness prediction. No peak-power inference. ' +
    'Still air, fixed drag/rolling resistance, 45 km/h cap; no heat, fatigue, traffic or cornering. ' +
    'Mechanical pedal work is not food calories. Source gains are not processed elevation truth.',root);
  node('p','Intentional legacy differences: Semonzo comparison clock uses 70/80%; ascent API defaults 60/75%. ' +
    'This shared route clock defaults to Steady 75%. Sensitivity is independently 70–90%, default 80%, with no stops.',root);
  const stopChapter=node('select','',node('label','Optional stop at section entry',root),'pace-stop-chapter');
  const stop=input('Stop minutes at this section (0–1440)','pace-stop','number');
  stop.min=0; stop.max=1440; stop.step='any'; stop.value='0';
  // Keep the stop control next to its section, not among rider inputs.
  root.append(stop.parentElement);
  const stopError=node('p','',root,'pace-stop-error'); stopError.setAttribute('role','status');
  node('p','Stops are hypothetical, not verified facilities. Distance seeks select arrival at a stop; ' +
    'only the time slider can explore a pause. Animation rate never changes modeled ride time.',root);
  const summary=node('p','',root,'pace-total');
  const position=node('p','',root,'pace-position');
  const clockLabel=node('label','Estimated elapsed ride clock (seconds, including planned stops)',root);
  const slider=node('input','',clockLabel,'pace-clock'); slider.type='range'; slider.min=0; slider.step='any';
  const clockText=node('p','',root,'pace-clock-readout');
  const comparisons=node('ul','',root,'pace-comparisons');
  const chapters=node('details','',root); node('summary','Chapter estimates · same selected scenario',chapters);
  const chapterRows=node('ol','',chapters,'pace-chapters');
  const sensitivity=node('details','',root,'pace-sensitivity');
  node('summary','Explore selected route / section FTP and weight',sensitivity);
  const target=node('select','',node('label','Sensitivity target (named revision)',sensitivity),'pace-sensitivity-target');
  const sensName=node('h3','',sensitivity,'pace-sensitivity-name');
  node('p','Same existing four-factor comparison: baseline, weight only, FTP only, both. ' +
    'Fixed 12 kg kit; no stops. Negative delta means faster; combined savings are solved, not added. ' +
    'FTP W/kg excludes kit; gravity uses system mass. At most 100 points × 500 windows; ' +
    'a selected section does not certify uncertain elevations elsewhere in its route.',sensitivity);
  const lookup = name => root.querySelector(`#pace-sens-${name}`);
  const sens = (tag,name,text='',parent=sensitivity) => node(tag,text,parent,`pace-sens-${name}`);
  const effort=sens('input','effort','',node('label','Sensitivity effort (% FTP, independent of route scenario)',sensitivity));
  Object.assign(effort,{type:'range',min:'70',max:'90',step:'1',value:'80'});
  sens('output','effort-label','80%'); sens('p','error','Open to calculate sensitivity.').setAttribute('role','status');
  const sc=sens('div','content'); sc.hidden=true;
  for (const name of ['baseline','limits']) sens('p',name,'',sc);
  for (const [name,label,options] of [
    ['mode','Chart mode',[['surface','3D surface'],['heatmap','2D heatmap']]],
    ['view','Surface view',[['ftp','FTP foreground'],['weight','Weight foreground']]],
  ]) {
    const select=sens('select',name,'',node('label',label,sc));
    for (const [v,t] of options) select.add(new Option(t,v));
  }
  sens('button','home','Select baseline',sc).type='button';
  const help=sens('p','help','Chart arrows: Left/Right FTP, Up/Down rider weight; Home baseline. ' +
    'Ring = selection, diamond = baseline. Light = faster, dark = slower. Numeric selectors give identical results.',sc);
  const chart=sens('div','chart','',sc); chart.tabIndex=0; chart.setAttribute('role','group');
  chart.setAttribute('aria-label','Select sensitivity point'); chart.setAttribute('aria-describedby',help.id);
  sens('div','scale','',sc);
  sens('select','ftp','',node('label','Selected FTP (W)',sc));
  const ml=node('label','',sc); sens('span','mass-label','Selected weight',ml); sens('select','mass','',ml);
  sens('p','selection','',sc);
  sens('data','minutes','',node('p','Modeled moving minutes: ',sc));
  sens('data','watts','',node('p','Sustained watts: ',sc));
  sens('div','comparisons','',sc);
  let a, name, model, clock, selectedTarget, sensitivityKey, preferenceState=preferences.snapshot();
  let builds=0, updateSensitivity, sensitivityLoader;
  const sensitivityCache=new Map();
  root.dataset.meshBuilds='0';
  function refreshSensitivity() {
    if (!a || root.hidden || !sensitivity.open) { updateSensitivity?.cancel(); return; }
    if (!updateSensitivity) {
      sensitivityLoader ??= import('./climb-sensitivity-view.mjs').then(api=>{
        updateSensitivity=api.installSensitivity(null,{lookup,cache:sensitivityCache,onBuild:()=>{
          root.dataset.meshBuilds=String(++builds);
        }});
        // Read CURRENT selection/input after loading, never a captured draft.
        sensitivityKey=null; refreshSensitivity();
      }).catch(()=>{
        lookup('content').hidden=true;
        lookup('error').textContent='Sensitivity panel unavailable. Route pace and navigation remain usable.';
      });
      return;
    }
    const chosen=target.value || null;
    const key=JSON.stringify([a.identity,chosen]);
    // Validate/copy windows only when the target changes, never on a frame.
    if (key!==sensitivityKey) {
      sensitivityKey=key; selectedTarget=sensitivityProfile(a,chosen);
      if (selectedTarget.status==='available') updateSensitivity.setProfile(selectedTarget.profile,selectedTarget.key);
    }
    const c=a.chapters.find(c=>c.id===chosen);
    sensName.textContent=`${name} · ${a.identity.revisionId} · ${c ? c.name ?? `section ${a.chapters.indexOf(c)+1}: ${c.kind}` : 'whole route'}`;
    if (selectedTarget.status!=='available') {
      updateSensitivity.invalidate(selectedTarget.issues[0].message); return;
    }
    const v=preferenceState.validation;
    updateSensitivity(v.kind==='invalid' ? v : {...v, estimate:{assumptions:{
      riderKg:v.options.riderKg ?? 75,ftpW:v.options.ftpW ?? 220}}},
    preferenceState.input.unit);
  }
  sensitivity.ontoggle=refreshSensitivity;
  target.onchange=()=>{
    if (target.value) onSeek(routePlayback.selectChapter(target.value),target.value);
    refreshSensitivity();
  };
  function stopValue() {
    stop.value=String((routePace.stopsFor(a).find(s=>s.chapterId===stopChapter.value)?.seconds ?? 0)/60);
    stopError.textContent='';
  }
  stopChapter.onchange=stopValue;
  stop.oninput=()=>{
    if (!a) return;
    if (!stop.value.trim() || !stop.checkValidity()) {
      stopError.textContent='Enter 0–1440 minutes; previous committed stop remains until corrected.'; return;
    }
    try { routePace.setStop(a,stopChapter.value,Number(stop.value)*60); stopError.textContent=''; }
    catch (e) { if (!(e instanceof RangeError)) throw e; stopError.textContent=e.message; }
  };
  const metric = (e, value) => {
    for (const k of ['movingSeconds','elapsedSeconds','stopSeconds']) e.dataset[k]=String(value[k]);
  };
  function draw(s) {
    if (root.hidden || !a || s.identity?.revisionId!==a.identity.revisionId) return;
    const p=s.estimatedRide;
    if (p.status!=='available' || model?.status!=='available') {
      position.textContent='Estimated time unavailable; route navigation and briefing remain usable.';
      for (const k of Object.keys(position.dataset)) delete position.dataset[k];
      for (const k of Object.keys(clockText.dataset)) delete clockText.dataset[k];
      clockText.textContent='Ride clock unavailable'; slider.disabled=true; return;
    }
    metric(position,p);
    position.dataset.distance=String(s.distanceM);
    position.textContent=`Estimated ${formatDuration(p.elapsedSeconds)} elapsed (${formatDuration(p.movingSeconds)} moving); ` +
      `${formatDuration(model.total.elapsedSeconds-p.elapsedSeconds)} remaining, including planned stops.`;
    slider.disabled=false; slider.max=clock.finishSeconds; slider.value=p.elapsedSeconds;
    slider.setAttribute('aria-valuetext',position.textContent);
    clockText.textContent=`Ride clock: ${formatDuration(p.elapsedSeconds)} elapsed · distance-seek arrival convention.`;
    metric(clockText,p);
  }
  slider.oninput=()=>{
    const seconds=Number(slider.value), p=clock?.atSecond?.(seconds);
    if (!p) return;
    const s=routePlayback.getSnapshot();
    const d=p.status==='finished' ? s.totalDistanceM : Math.min(p.distanceM,s.totalDistanceM);
    onSeek(routePlayback.seekDistance(d));
    if (p.status==='stopped') {
      slider.value=seconds;
      clockText.textContent=`Within planned stop: ${formatDuration(seconds)} elapsed at ${(d/1000).toFixed(3)} km. ` +
        'Position HUD shows arrival; distance alone cannot locate time within a pause.';
      clockText.dataset.elapsedSeconds=String(seconds);
    }
  };
  function refresh() {
    scenario.value=routePace.snapshot().scenario;
    if (!a) return;
    model=routePace.model(a); clock=createRouteClock(model);
    summary.textContent=model.status==='available' ?
      `Route total: ${formatDuration(model.total.movingSeconds)} moving + ${formatDuration(model.total.stopSeconds)} stops = ` +
      `${formatDuration(model.total.elapsedSeconds)} elapsed · ${model.total.pedalWorkKJ.toFixed(1)} mechanical pedal kJ.` :
      `Route time unavailable: ${model.issues?.map(i=>i.message).join(' ')}. No corrected or clamped profile substituted.`;
    for (const k of Object.keys(summary.dataset)) delete summary.dataset[k];
    if (model.status==='available') {
      metric(summary,model.total);
      const m=model.assumptions;
      assumptions.textContent=`${preferenceState.validation.kind} rider inputs · ${m.riderKg} kg rider + ${m.bikeKitKg} kg kit; ` +
        `${m.ftpW} W FTP × ${m.fraction*100}% = ${m.targetW} W. ` +
        (m.allDay ? `All Day 75% seed: ${formatDuration(m.allDay.seedMovingSeconds)} moving; resolved ${m.fraction*100}%.` : paceScenarios[m.scenario]);
    } else assumptions.textContent='No valid scenario estimate. Correct or clear inputs; no stale personal result is shown.';
    comparisons.replaceChildren();
    for (const [choice,label] of Object.entries(paceScenarios)) {
      const m=routePace.model(a,choice);
      const row=node('li',m.status==='available' ? `${label}: ${formatDuration(m.total.movingSeconds)} moving; ` +
        `${formatDuration(m.total.elapsedSeconds)} elapsed (${m.assumptions.fraction*100}% FTP)` : `${label}: unavailable`,comparisons);
      row.dataset.scenario=choice;
      if (m.status==='available') metric(row,m.total);
    }
    chapterRows.replaceChildren();
    for (const [i,c] of (model.chapters ?? []).entries()) {
      const row=node('li',`${a.chapters[i].name ?? `Section ${i+1}: ${c.kind}`} · ${formatDuration(c.movingSeconds)} moving + ` +
        `${formatDuration(c.stopSeconds)} stops = ${formatDuration(c.elapsedSeconds)} elapsed`,chapterRows);
      row.dataset.chapter=c.id; metric(row,c);
    }
    draw(routePlayback.getSnapshot());
  }
  routePace.subscribe(refresh);
  preferences.subscribe((state,reset)=>{
    preferenceState=state;
    // State is synchronous even when consented persistence is asynchronous.
    // Never reconstruct these controls on late profile/planner completion.
    mass.value=preferences.displayedMass(); unit.value=state.input.unit; ftp.value=state.input.ftp;
    validation.textContent=state.validation.kind==='invalid' ? Object.values(state.validation.errors).join(' ') :
      `${state.validation.kind} inputs; omitted values use fictional assumptions.`;
    mass.setAttribute('aria-invalid',String(Boolean(state.validation.errors?.mass)));
    ftp.setAttribute('aria-invalid',String(Boolean(state.validation.errors?.ftp)));
    routePace.setRider(state.validation,reset);
    if (reset) { effort.value='80'; if (a) stopValue(); }
    refreshSensitivity();
  });
  subscribePlayback(draw);
  return {root, show(resolved, exampleAnalysis) {
    const next=resolved.profile?.identity ? resolved.profile : exampleAnalysis;
    root.hidden=resolved.code!=='ready' || resolved.state.area!=='explore' ||
      ['compare','skyline','radial'].includes(resolved.state.view) || !next;
    if (root.hidden) {
      updateSensitivity?.cancel();
      if(a?.routeId?.startsWith('user:')) {
        a=null;model=null;clock=null;sensitivityKey=null;selectedTarget=null;name='';
        heading.textContent='Pace and ride clock';sensName.textContent='';
        for(const e of [summary,position,clockText,assumptions,comparisons,chapterRows,stopChapter,target]) {
          e.replaceChildren();for(const key of Object.keys(e.dataset))delete e.dataset[key];
        }
        updateSensitivity?.invalidate('Local route no longer active.');
        sensitivityCache.clear();
      }
      return;
    }
    name=resolved.bundle.route.name;
    heading.textContent=`${name} · Pace and ride clock`;
    if (a!==next) {
      a=next; sensitivityKey=null; updateSensitivity?.cancel();
      stopChapter.replaceChildren(); target.replaceChildren(new Option('Whole route',''));
      for (const [i,c] of a.chapters.entries()) {
        const label=c.name ?? `Section ${i+1}: ${c.kind} · ${(c.startM/1000).toFixed(1)}–${(c.endM/1000).toFixed(1)} km`;
        stopChapter.add(new Option(label,c.id)); target.add(new Option(label,c.id));
      }
      stopValue();
    }
    if (resolved.state.view==='sensitivity') sensitivity.open=true;
    refresh(); refreshSensitivity();
  }};
}
