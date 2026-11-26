import { loadRouteAnalysis } from '../../js/route-analysis-loader.mjs';
import { positionAt } from '../../js/route-analysis.mjs';
import { verifyAsset } from '../../js/route-catalog.mjs';
import { validatePackPointer, validateRoutePack } from '../../js/route-pack-contract.mjs';
import { createRideSimulation, createSimulationScheduler, rideRiderFromInput, exampleDrivetrain } from '../../js/ride-simulation.mjs';
import { rideInsights, sectionName } from '../../js/ride-insights.mjs';
import { routeSection, createRideCamera, flyoverLimits } from '../../js/route-flyover.mjs';
import { createRideComparison } from '../../js/ride-comparison.mjs';
import { installRideRelive } from '../../js/ride-relive.mjs';

const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const groups = [
  {label:'D0 Warm-up', routes:['rwgps-57874121']},
  {label:'D1 Vicentine Hills', routes:['rwgps-57873183','rwgps-57874024']},
  {label:'D2 Asolo / Monte Grappa', routes:['rwgps-57873112','rwgps-57873019']},
  {label:'D3 Brentha Valley', routes:['rwgps-57874050','rwgps-57874076']},
];
const names = {
  'rwgps-57873019':'D2 Monte Grappa', 'rwgps-57873112':'D2 Asolo',
  'rwgps-57873183':'D1 Vicentine Hills', 'rwgps-57874024':'D1 Vicentine Hills',
  'rwgps-57874050':'D3 Brentha Valley', 'rwgps-57874076':'D3 Brentha Valley',
  'rwgps-57874121':'D0 Warm-up',
};
const params = new URLSearchParams(location.search);
document.body.classList.toggle('long-name',params.get('layout') === 'long-name');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Both sheets share the space between the live header/status and playbar.
// Enlarged text can make the cockpit too tall to anchor Profile above it.
const bar = document.querySelector('.playbar'), credit = document.querySelector('.player-credit');
function layoutSheets() {
  const headerBottom = Math.max(document.querySelector('.player-header').getBoundingClientRect().bottom,
    document.querySelector('.player-status').getBoundingClientRect().bottom);
  document.querySelector('.player-bottom').style.setProperty('--playbar-clearance',
    `${bar.getBoundingClientRect().height+credit.getBoundingClientRect().height+8}px`);
  document.querySelector('.player-bottom').style.setProperty('--sheet-max-height',
    `${Math.max(0,bar.getBoundingClientRect().top-headerBottom-16)}px`);
  $('player').style.setProperty('--terrain-controls-top',
    `${document.querySelector('.player-status').getBoundingClientRect().bottom+8}px`);
}
const sheetLayout = new ResizeObserver(layoutSheets);
for (const el of [bar,credit,document.querySelector('.player-header'),
  document.querySelector('.player-status'),document.querySelector('.player-bottom'),$('player')])
  sheetLayout.observe(el);
let pack, selected, analysis, inPlayer = false, playing = false, distance = 0;
let generation = 0, routeController, terrainController, terrainHandle, frame, projection;
let simulation, scheduler, pendingGear, pendingHistory, notice = '';
let comparison, comparisonSample, comparisonHistory, presentedSeconds, comparisonNotice = '';
let selectedChapterId, highlightedChapterId, insights, lastHUD = -Infinity;
let mode = 'experiment';
let privateView = false;
const profileHelp = $('profile-help').textContent;
let terrainReady = false;
const rideCamera = createRideCamera();
function cameraControls(available = terrainReady) {
  $('zoom-help').title='Satellite imagery and approximate terrain only. Road surfaces and road cuts are not modeled; this is not literal rider eyesight.';
  for (const view of ['rider','aerial']) {
    $(`view-${view}`).disabled = !available;
    pressed($(`view-${view}`),available && !manual && camera==='follow' && rideCamera.view===view);
  }
  $('zoom-nearer').disabled = !available || rideCamera.zoom >= flyoverLimits.maxZoom;
  $('zoom-farther').disabled = !available || rideCamera.zoom <= flyoverLimits.minZoom;
  text('zoom-help', available ? manual ? 'Manual exploration · Return restores your chosen view.' :
    camera!=='follow' ? 'Aerial framing · choose Rider to look forward.' : rideCamera.view==='rider' ?
    'Rider · 2–9 m above approximate terrain; lifts on steep DEM. Not Street View.' :
    'Closer view, same terrain detail. New route resets distance.' :
    privateView ? 'Private route · camera zoom unavailable in 2D.' : 'Camera zoom requires online terrain.');
}
for (const [id,delta] of [['zoom-nearer',.5],['zoom-farther',-.5]])
  $(id).addEventListener('click',()=>terrainHandle?.setZoom(rideCamera.zoom+delta));
for (const view of ['rider','aerial'])
  $(`view-${view}`).addEventListener('click',()=>{
    if (!terrainReady) return;
    rideCamera.setView(view);cameraControls();frameRoute('follow');
  });
let manual = false;
const returnRider = document.createElement('button');
returnRider.id = 'return-rider';returnRider.textContent = 'Return to rider';returnRider.hidden = true;
$('terrain-status').parentElement.append(returnRider);
function followRider() {
  frameRoute('follow');
}
returnRider.addEventListener('click',()=>{pause();followRider();});
let camera = 'follow';
const cache = new Map();
const withdrawn = new Set();
const format = n => new Intl.NumberFormat('en-GB').format(Math.round(n));
// Both the finite local preview and the public entry bind an explicit pointer.
// Release tooling replaces it with the validated content-addressed pointer.
const pointerURL = new URL(document.querySelector('link[title="Approved route catalog"]').href);
const assetRoot = new URL('../',pointerURL);
const readAsset = async (path, signal) => {
  if (!/^assets\/route-(?:pack(?:\.[a-f0-9]{24})?\.json|(?:manifest-|profile-)?[a-f0-9]{64}\.(?:json|gpx))$/.test(path))
    throw Error('Asset outside public route allowlist');
  const res = await fetch(new URL(path,assetRoot), {
    credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',
    signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Error('Cleared route asset unavailable');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 20*1024*1024) throw Error('Route asset exceeds limit');
  return bytes;
};
function node(tag, attrs, text) {
  const el = document.createElementNS(NS,tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
  if (text) el.textContent = text;
  return el;
}
function variant(id) {
  const group = groups.find(g => g.routes.includes(id));
  return group.routes.length === 1 || id === group.routes[0] ? 'Standard' : 'Long';
}
function profile(svg, height) {
  const points = analysis.points;
  const low = Math.min(...points.map(p => p.elevationM));
  const high = Math.max(...points.map(p => p.elevationM));
  const step = Math.max(1,Math.floor(points.length/600));
  const coords = points.filter((p,i) => i%step === 0 || i === points.length-1)
    .map(p => `${(p.distanceM/analysis.distanceM*640).toFixed(2)},${(height-5-(p.elevationM-low)/(high-low || 1)*(height-12)).toFixed(2)}`);
  const line = 'M'+coords.join(' L');
  svg.replaceChildren(
    node('path',{d:line+` L640,${height} L0,${height} Z`,class:'profile-fill'}),
    node('path',{d:line,class:'profile-line'}),
  );
  if (svg.id === 'player-profile') {
    svg.prepend(node('rect',{id:'profile-range',class:'profile-range',x:0,y:0,width:0,height}));
    svg.append(node('line',{id:'profile-cursor',x1:0,x2:0,y1:0,y2:height,stroke:'#f2efe5','stroke-width':2}));
  }
}
function drawMap(svg, rider = false) {
  const points = analysis.points;
  const minLon = Math.min(...points.map(p=>p.lon)), maxLon = Math.max(...points.map(p=>p.lon));
  const minLat = Math.min(...points.map(p=>p.lat)), maxLat = Math.max(...points.map(p=>p.lat));
  const scaleLon = Math.cos((minLat+maxLat)/2*Math.PI/180);
  const width = (maxLon-minLon)*scaleLon, height = maxLat-minLat;
  const scale = Math.min(450/width,420/height);
  projection = p => [320+(p.lon-(minLon+maxLon)/2)*scaleLon*scale,290-(p.lat-(minLat+maxLat)/2)*scale];
  const step = Math.max(1,Math.ceil(points.length/2000));
  const line = 'M'+points.filter((p,i)=>i%step===0 || i===points.length-1).map(p=>projection(p).map(n=>n.toFixed(2)).join(',')).join(' L');
  svg.replaceChildren();
  for (let x=40;x<=640;x+=70) svg.append(node('line',{x1:x,x2:x,y1:0,y2:580,class:'grid'}));
  for (let y=10;y<=580;y+=70) svg.append(node('line',{x1:0,x2:640,y1:y,y2:y,class:'grid'}));
  svg.append(node('path',{d:line,class:'track-shadow'}),node('path',{d:line,class:'track'}));
  const peak = points.reduce((a,b)=>a.elevationM>b.elevationM?a:b);
  for (const [p,label] of [[points[0],'Start/finish'],[peak,`${format(peak.elevationM)} m`]]) {
    const [x,y] = projection(p);
    svg.append(node('circle',{cx:x,cy:y,r:5,class:'point'}),
      node('text',{x:x+12,y:y-10},label));
  }
  if (rider) {
    svg.append(node('path',{id:'outline-section',class:'section-track'}));
    const ghost = node('g',{id:'outline-ghost','aria-label':'Diamond baseline rider',visibility:'hidden'});
    ghost.append(node('path',{d:'M0,-20 L20,0 L0,20 L-20,0 Z',class:'ghost-diamond'}));
    svg.append(ghost);
    const [x,y] = projection(positionAt(analysis,distance));
    svg.append(node('circle',{id:'outline-rider',cx:x,cy:y,r:8,fill:'#dfb767',stroke:'white','stroke-width':4}));
  }
  $('peak-label').textContent = `${format(peak.elevationM)} m`;
}
function snapshot() {
  return {...(simulation?.status === 'available' ? simulation.snapshot() : {}),
    identity:analysis.identity,position:positionAt(analysis,distance),distanceM:distance,
    phase:playing?'playing':'paused',cameraMode:camera,selectedChapterId:highlightedChapterId,
    baseline:comparisonSample?.status === 'available' ?
      {distanceM:comparisonSample.ghost.distanceM,position:positionAt(analysis,comparisonSample.ghost.distanceM)} : null};
}
const text = (id, value) => {if ($(id).textContent !== value) $(id).textContent = value;};
const pressed = (button, value) => {
  const next = String(value);
  if (button.getAttribute('aria-pressed') !== next) button.setAttribute('aria-pressed',next);
};
const duration = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  const minutes = Math.floor(seconds/60);
  return `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
};
const km = m => `${(m/1000).toFixed(1)} km`;
const grade = n => `${n>0?'+':''}${n.toFixed(1)}%`;
function renderSections() {
  $('section-list').replaceChildren();
  text('section-count',`(${analysis.chapters.length})`);
  for (const chapter of analysis.chapters) {
    const li = document.createElement('li'),button = document.createElement('button');
    const info = rideInsights(analysis,chapter.startM,chapter.id);
    button.dataset.chapterId = chapter.id;
    button.dataset.startM = chapter.startM;button.dataset.endM = chapter.endM;
    button.textContent = `${sectionName(analysis,chapter)} · ${km(chapter.startM)}–${km(chapter.endM)}`;
    const detail = document.createElement('small');
    detail.textContent = info.selectedSummary.inputAnomaly ? 'Processed input anomaly · unverified grade' :
      `${km(chapter.distanceM)} · +${format(chapter.ascentM)} m gain · ${grade(chapter.gradePercent)} processed average`;
    button.append(detail);
    button.addEventListener('click',()=>selectSection(chapter.id));
    li.append(button);$('section-list').append(li);
  }
}
function highlightSection(chapter) {
  if (highlightedChapterId === chapter.id) return;
  highlightedChapterId = chapter.id;
  const path = routeSection(analysis,chapter.id).map(([lon,lat])=>projection({lon,lat}));
  $('outline-section').setAttribute('d','M'+path.map(p=>p.join(',')).join(' L'));
  $('outline-section').dataset.chapterId = chapter.id;
  $('profile-range').setAttribute('x',chapter.startM/analysis.distanceM*640);
  $('profile-range').setAttribute('width',(chapter.endM-chapter.startM)/analysis.distanceM*640);
  $('profile-range').dataset.chapterId = chapter.id;
  for (const button of $('section-list').querySelectorAll('button'))
    pressed(button,button.dataset.chapterId === chapter.id);
}
function renderInsights() {
  if (mode === 'relive') return;
  insights = rideInsights(analysis,distance,selectedChapterId);
  $('road-card').dataset.status = insights.status;
  for (const button of document.querySelectorAll('[data-frame]')) button.disabled = insights.status !== 'available';
  if (insights.status !== 'available') {
    text('road-current','Section unavailable');text('road-ahead','');
    text('section-detail','Selected route unavailable.');text('road-transition','');
    $('main-climb').disabled = true;$('retry-section').disabled = true;
    $('player-profile').setAttribute('aria-disabled','true');
    for (const key of ['revision','current','selected']) delete $('road-card').dataset[key];
    return;
  }
  const {current,next,selected:section,remaining,ahead,selectedRemaining,selectedSummary,finished,mainClimb} = insights;
  $('road-card').dataset.revision = analysis.identity.revisionId;
  $('road-card').dataset.current = current.id;
  $('road-card').dataset.selected = section.id;
  $('main-climb').disabled = !mainClimb;
  $('retry-section').disabled = false;
  $('player-profile').setAttribute('aria-disabled','false');
  text('road-current',finished ? 'Route complete · 0.0 km / +0 m left' :
    remaining.inputAnomaly ? `${sectionName(analysis,current)} · processed input anomaly` :
    `${sectionName(analysis,current)} · ${km(remaining.distanceM)} / +${format(remaining.ascentM)} m left`);
  text('road-ahead',finished ? 'End of processed route · seek to explore again' :
    ahead.inputAnomaly ? 'Ahead: processed input anomaly · unverified grade' :
    `Next ${km(ahead.distanceM)} · processed ${grade(ahead.minGradePercent)} to ${grade(ahead.maxGradePercent)}`);
  text('section-detail',`${sectionName(analysis,section)} selected · ${
    selectedRemaining.distanceM === 0 ? 'section complete; Play continues without resetting this trial.' :
    `${km(selectedRemaining.distanceM)} / +${format(selectedRemaining.ascentM)} m left.`} ${
    selectedSummary.inputAnomaly ? 'Processed input anomaly; not a verified road grade.' :
    `${grade(section.gradePercent)} processed average.`}`);
  text('road-transition',next ? `Next: ${sectionName(analysis,next)} in ${km(remaining.distanceM)} · ${
    rideInsights(analysis,next.startM,next.id).selectedSummary.inputAnomaly ? 'unverified input anomaly' :
    `${grade(next.gradePercent)} processed average, +${format(next.ascentM)} m over ${km(next.distanceM)}`}.` :
    finished ? 'No next section.' : 'Last section · no further section after the finish.');
  highlightSection(section);
}
function frameRoute(value) {
  if (!analysis) return;
  camera = value;$('camera').value = value;
  $('player-map').dataset.framing = value;
  manual = false;
  $('player-map').setAttribute('viewBox',mode === 'relive' ? '0 0 400 400' : '0 0 640 580');
  if (camera === 'section' && highlightedChapterId) {
    const points = routeSection(analysis,highlightedChapterId).map(([lon,lat])=>projection({lon,lat}));
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    $('player-map').setAttribute('viewBox',
      `${Math.min(...xs)-25} ${Math.min(...ys)-25} ${Math.max(...xs)-Math.min(...xs)+50} ${Math.max(...ys)-Math.min(...ys)+50}`);
  }
  for (const button of document.querySelectorAll('[data-frame]')) pressed(button,button.dataset.frame === camera);
  cameraControls();
  updatePosition(true);
}
function seekTo(target, chapterId) {
  if (mode === 'relive') {
    const second = relive.replay?.secondAtDistance(target);
    if (second === null) {
      pause();text('relive-message','Distance ambiguous at a gap. Use elapsed or sample controls; no distance inferred.');
    } else if (second !== undefined) seekRecorded(second);
    return;
  }
  if (!analysis) return;
  pause();distance = Math.max(0,Math.min(analysis.distanceM,target));
  if (simulation?.status === 'available') simulation.seek(distance);
  selectedChapterId = chapterId;
  pendingHistory = undefined;pendingGear = undefined;
  notice = mode === 'experiment' ? 'New trial · time/work reset · paused.' : 'Steady arrival time · paused.';
  clearComparison('Seek starts a new trial.');
  renderInsights();
  frameRoute(chapterId ? 'section' : 'follow');
  renderCockpit();
}
function selectSection(id) {
  const chapter = analysis?.chapters.find(c=>c.id === id);
  if (chapter) seekTo(chapter.startM,id);
}
function renderCockpit() {
  $('player').classList.toggle('reliving',mode === 'relive');
  if (mode === 'relive') {
    const available = !!relive.clock;
    for (const id of ['seek','restart','play']) $(id).disabled = !available;
    for (const button of document.querySelectorAll('[data-effort], #coast, #gear-easier, #gear-harder, #main-climb, #retry-section, [data-frame="section"]'))
      button.disabled = true;
    renderComparison();
    $('cockpit').setAttribute('aria-label','Recorded riding cockpit');
    if (available) relive.render();
    else {
      for (const id of ['ride-speed','ride-power','ride-grade','ride-gear','ride-cadence','ride-elapsed','progress'])
        text(id,'—');
      text('speed-provenance','km/h · recorded');
      text('ride-effort','No recording selected');
      text('road-current','Choose a timestamped recording');text('road-ahead','Private first-party 2D only');
      text('ride-notice','Paused · no actuals loaded');
      for (const key of ['motion','seconds','distance','sample','age','exact','origin','history']) delete $('cockpit').dataset[key];
      $('cockpit').dataset.status = 'unavailable';
    }
    return;
  }
  $('cockpit').setAttribute('aria-label','Modeled riding cockpit');
  for (const key of ['sample','age','exact']) delete $('cockpit').dataset[key];
  const available = simulation?.status === 'available';
  const s = available ? simulation.snapshot() : null;
  const interactive = available && mode === 'experiment' && s.motion !== 'finished';
  $('seek').disabled = !analysis;$('restart').disabled = !analysis;
  $('play').disabled = !available || (s.motion === 'finished' && s.trialOriginM === analysis.distanceM);
  for (const button of document.querySelectorAll('[data-effort], #coast, #gear-easier, #gear-harder'))
    button.disabled = !interactive;
  if (pendingHistory !== undefined && s?.historyLength > pendingHistory) {
    pendingHistory = undefined;pendingGear = undefined;
  }
  $('cockpit').dataset.status = available ? 'available' : 'unavailable';
  $('cockpit').dataset.motion = s?.motion || 'unavailable';
  $('cockpit').dataset.seconds = s?.simulationSeconds ?? '';
  $('cockpit').dataset.origin = s?.trialOriginM ?? '';
  $('cockpit').dataset.history = s?.historyLength ?? '';
  text('ride-speed', s ? (s.speedMps*3.6).toFixed(1) : '—');
  text('speed-provenance',s ? `km/h · ${s.provenance.telemetry === 'example-model' ? 'example' : 'personal'} model` : 'km/h · unavailable');
  text('ride-power', s ? `${Math.round(s.pedalPowerW)} W` : '—');
  text('ride-effort', s ? `${Math.round(s.effortFraction*100)}% FTP target` : 'Unavailable');
  text('ride-grade', s ? `${(s.grade*100).toFixed(1)}%` : '—');
  text('ride-gear', s ? `${s.gear.frontTeeth}×${s.gear.rearTeeth}` : '—');
  text('ride-cadence', s ? `${Math.round(s.cadenceRpm)} rpm` : '— rpm');
  text('ride-elapsed', s ? `${mode === 'experiment' ? 'Trial' : 'Elapsed'} ${duration(s.simulationSeconds)}` : 'Estimates unavailable');
  text('ride-remaining', s ? (s.remainingSeconds === null ? 'ETA unknown · live choices' :
    `${duration(s.remainingSeconds)} remaining`) : 'Profile & seek still available');
  text('model-provenance', s ? `${mode === 'experiment' ? 'Experiment' : 'Explore · Steady'} · ${
    s.provenance.telemetry === 'example-model' ? 'Example model' : 'Personal inputs · model'}` : 'Model unavailable');
  text('rider-errors', available ? '' : simulation?.unavailableReasons?.join(' ') || '');
  text('rider-assumptions', s ? `Rider ${s.assumptions.riderKg} kg · FTP ${s.assumptions.ftpW} W · bike + kit ${s.assumptions.bikeKitKg} kg. ${
    s.assumptions.defaultedInputs.length ? 'Example fields: '+s.assumptions.defaultedInputs.map(k=>({riderKg:'rider mass',ftpW:'FTP',bikeKitKg:'bike + kit'}[k])).join(', ')+'.' : 'All three inputs supplied.'}` : 'Correct inputs to restore estimates; geometry is unchanged.');
  text('drivetrain-assumptions', `Example drivetrain: ${exampleDrivetrain.frontTeeth.join('/')} rings, ${
    exampleDrivetrain.rearTeeth.join('/')} cassette, ${exampleDrivetrain.circumferenceM} m wheel. Gears change cadence, not speed. Grade is processed from the route, not a live measurement.`);
  text('physics-assumptions', s ? `Assumed still air, CdA ${s.assumptions.dragAreaM2} m², rolling coefficient ${
    s.assumptions.rollingCoefficient}, drivetrain efficiency ${s.assumptions.drivetrainEfficiency*100}%. A ${
    s.assumptions.speedCapMps*3.6} km/h model cap is not a safe descent speed. Delivered power can be below your FTP target at the cap.` :
    'No riding estimates until the route and inputs are within the shared model’s supported range.');
  for (const button of document.querySelectorAll('[data-effort]'))
    pressed(button,!!s && s.effortFraction === Number(button.dataset.effort));
  pressed($('coast'),!!s?.coast);
  text('ride-notice', !available ? (simulation?.unavailableReasons?.join(' ') || 'Loading model…') :
    pendingHistory !== undefined ? 'Pending · applies at the next model step when playing.' :
    s.motion === 'finished' ? 'Finished · exact route endpoint. Restart trial or seek.' :
    s.motion === 'stalled' ? 'Stalled · choose an effort to resume. No-momentum model.' :
    notice || (playing ? 'Playing' : 'Paused'));
  renderComparison();
}
const signed = (n,decimals=0) => {
  const rounded = Number(n.toFixed(decimals));
  return `${rounded>0?'+':''}${rounded.toFixed(decimals)}`;
};
function clearComparison(reason) {
  if (comparison) {
    comparisonNotice = `Baseline cleared · ${reason}`;
    notice = comparisonNotice;
  }
  comparison = undefined;comparisonSample = undefined;comparisonHistory = undefined;
  $('outline-ghost')?.setAttribute('visibility','hidden');
  for (const key of ['distanceDelta','seconds','baselineDistance','commonM','arrivalDelta','workDelta'])
    delete $('comparison-hud').dataset[key];
}
function sampleComparison() {
  if (!comparison || simulation?.status !== 'available') {comparisonSample = undefined;return;}
  const s = simulation.snapshot();
  if (comparisonHistory !== s.historyLength) {
    const result = comparison.sync(simulation.exportTrial());
    if (result.status !== 'available') {clearComparison(result.reason);return;}
    comparisonHistory = s.historyLength;
  }
  comparisonSample = comparison.sample(s,{seconds:playing ? presentedSeconds : s.simulationSeconds,distanceM:distance});
  if (comparisonSample.status !== 'available') clearComparison(comparisonSample.reason);
  if (comparisonSample) {
    const sample = comparisonSample, hud = $('comparison-hud');
    hud.dataset.distanceDelta = sample.distanceDeltaM;
    hud.dataset.seconds = sample.seconds;
    hud.dataset.baselineDistance = sample.ghost.distanceM;
    hud.dataset.commonM = sample.commonM;
    hud.dataset.arrivalDelta = sample.arrivalDeltaSeconds ?? '';
    hud.dataset.workDelta = sample.pedalWorkDeltaKJ ?? '';
  }
}
function renderComparison() {
  const enabled = simulation?.status === 'available' && mode === 'experiment';
  $('pin-baseline').disabled = !enabled || !!comparison;
  $('repin-baseline').disabled = !enabled || !comparison;
  $('remove-baseline').disabled = !comparison;
  $('comparison-hud').hidden = !comparisonSample;
  text('comparison-notice',comparisonNotice || 'Pin the applied strategy, then change effort. Nothing is saved.');
  if (!comparisonSample) {
    text('comparison-detail','No active baseline.');return;
  }
  const s = comparisonSample;
  text('comparison-gap',`◇ Baseline · live ${signed(s.distanceDeltaM)} m at equal trial time`);
  const detail = s.arrivalDeltaSeconds === null ? 'Common-distance arrival unavailable.' :
    `${signed(s.arrivalDeltaSeconds,1)} s arrival · ${signed(s.pedalWorkDeltaKJ,2)} kJ pedal work at ${(s.commonM/1000).toFixed(3)} km`;
  text('comparison-arrival',detail);
  text('comparison-detail',`Live minus baseline: ${detail}. Negative time = live arrived sooner. ${
    s.baselineFinishSeconds === null ? 'Baseline has no finish estimate within 24 ride hours (it may be stalled).' :
    'Baseline holds its position and work after finishing.'}`);
}
function pinBaseline() {
  if (simulation?.status !== 'available' || mode !== 'experiment') return;
  const next = createRideComparison({analysis,trial:simulation.exportTrial()});
  if (next.status !== 'available') {
    comparisonNotice = next.reason;renderComparison();return;
  }
  comparison = next;comparisonHistory = simulation.snapshot().historyLength;
  notice = '';
  comparisonNotice = 'Pinned applied history; holds its last effort/gear/coast. Pending commands are excluded, even while paused.';
  sampleComparison();updatePosition();renderCockpit();
}
$('pin-baseline').addEventListener('click',pinBaseline);
$('repin-baseline').addEventListener('click',pinBaseline);
$('remove-baseline').addEventListener('click',()=>{
  clearComparison('Removed by you.');updatePosition();renderCockpit();
});
function buildModel(originM = distance) {
  clearComparison('Rider or model changed; comparison needs the same identity.');
  pendingGear = undefined;pendingHistory = undefined;
  scheduler = undefined;simulation = undefined;
  if (!analysis || mode === 'relive') {renderCockpit();return;}
  const rider = rideRiderFromInput({mass:$('rider-mass').value,enteredUnit:'kg',ftp:$('rider-ftp').value});
  if (rider.status !== 'available') simulation = rider;
  else {
    const bike = $('rider-bike').value.trim();
    // Keep an invalid numeric value invalid; never drop it into example defaults.
    const bikeKitKg = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(bike) ? Number(bike) : NaN;
    simulation = createRideSimulation({analysis,mode,originM,rider:{
      ...rider.rider,...(bike === '' ? {} : {bikeKitKg}),
    }});
  }
  if (simulation.status === 'available') {
    scheduler = createSimulationScheduler(simulation,{rate:Number($('playback-rate').value)});
    distance = simulation.snapshot().distanceM;
  }
  for (const [id,field] of [['rider-mass','mass'],['rider-ftp','ftp']]) {
    $(id).setAttribute('aria-invalid',String(rider.issues?.some(issue=>issue.field === field) || false));
    $(id).setAttribute('aria-describedby','rider-errors');
  }
  $('rider-bike').setAttribute('aria-invalid',String(simulation.issues?.some(issue=>issue.message.includes('bikeKitKg')) || false));
  $('rider-bike').setAttribute('aria-describedby','rider-errors');
  renderCockpit();
}
function command(action) {
  if (simulation?.status !== 'available' || mode !== 'experiment') return;
  pendingHistory ??= simulation.snapshot().historyLength;
  simulation.command(action);
  if (action.type === 'gear') pendingGear = action.value;
  notice = '';renderCockpit();
}
function updatePosition(force = false) {
  if (mode === 'relive') {
    if (relive.clock) {distance = relive.actual().distanceM;renderCockpit();}
    return;
  }
  if (!analysis) return;
  sampleComparison();
  if (force) manual = false;
  returnRider.hidden = !manual && camera === 'follow';
  if (force || !playing || performance.now()-lastHUD >= 100) {
    renderInsights();renderCockpit();lastHUD = performance.now();
    $('player-profile').setAttribute('aria-valuenow',String(Math.round(distance/analysis.distanceM*1000)));
    $('player-profile').setAttribute('aria-valuetext',`${km(distance)} · ${sectionName(analysis,insights.current)} · seek pauses`);
  }
  const p = positionAt(analysis,distance), xy = projection(p);
  $('outline-rider')?.setAttribute('cx',xy[0]);
  $('outline-rider')?.setAttribute('cy',xy[1]);
  // Keep the rider a legible point, not a giant symbol when inspecting a short
  // section in the same SVG projection.
  const mapScale = $('player-map').getScreenCTM()?.a;
  if (mapScale > 0) {
    $('outline-rider')?.setAttribute('r',8/mapScale);
    $('outline-rider')?.setAttribute('stroke-width',4/mapScale);
  }
  const ghost = $('outline-ghost');
  if (ghost) {
    ghost.setAttribute('visibility',comparisonSample ? 'visible' : 'hidden');
    if (comparisonSample && mapScale > 0) {
      const xy = projection(positionAt(analysis,comparisonSample.ghost.distanceM));
      ghost.setAttribute('transform',`translate(${xy[0]} ${xy[1]}) scale(${1/mapScale})`);
      ghost.dataset.distance = comparisonSample.ghost.distanceM;
    }
  }
  const ratio = distance/analysis.distanceM;
  $('seek').value = Math.round(ratio*1000);
  $('profile-cursor')?.setAttribute('x1',ratio*640);
  $('profile-cursor')?.setAttribute('x2',ratio*640);
  $('position').value = `${(distance/1000).toFixed(1)} km`;
  $('height').value = `${format(p.rawElevationM)} m`;
  $('progress').textContent = `${(distance/1000).toFixed(1)} km`;
  $('cockpit').dataset.distance = String(distance);
  const sectionPadding = camera === 'section' ? {
    top:Math.max(document.querySelector('.player-header').getBoundingClientRect().bottom,
      document.querySelector('.player-status').getBoundingClientRect().bottom)+16,
    bottom:innerHeight-document.querySelector('.player-bottom').getBoundingClientRect().top+16,
    left:24,right:24,
  } : undefined;
  terrainHandle?.update(snapshot(),force,{sectionPadding});
}
function pause() {
  relive.clock?.pause();
  scheduler?.pause();
  playing = false;cancelAnimationFrame(frame);
  $('play').innerHTML = '▶ <span>Play</span>';
  $('play').setAttribute('aria-label','Play route preview');
  if (mode !== 'relive' && simulation?.status === 'available') distance = simulation.snapshot().distanceM;
  // Flush the exact model boundary to every surface, without recentering a manual map.
  if (analysis) {updatePosition();renderCockpit();}
  if (terrainReady) $('terrain-status').textContent = manual ?
    'Manual exploration · paused' : 'Satellite terrain · paused';
}
function tick(time) {
  if (!playing || !inPlayer) return;
  if (mode === 'relive') {
    const state = relive.clock.tick(time);
    updatePosition();
    if (state.phase !== 'playing') pause();
    else frame = requestAnimationFrame(tick);
    return;
  }
  const {previous,current,alpha,notice:late} = scheduler.frame(time);
  // Interpolate only the adjacent fixed model steps, never extrapolate using
  // watts, speed or a second travel clock. All spatial consumers use this value.
  distance = current.phase === 'playing' ?
    previous.distanceM+(current.distanceM-previous.distanceM)*alpha : current.distanceM;
  presentedSeconds = current.phase === 'playing' ?
    previous.simulationSeconds+(current.simulationSeconds-previous.simulationSeconds)*alpha : current.simulationSeconds;
  updatePosition();
  if (late) notice = 'Playback paused after a late frame. Press Play to continue; no catch-up.';
  if (current.phase !== 'playing') pause();
  else frame = requestAnimationFrame(tick);
}
function stopTerrain() {
  terrainReady = false;
  cameraControls(false);
  $('camera').disabled = !analysis;
  manual = false;returnRider.hidden = camera === 'follow';
  $('player').classList.remove('online');
  terrainController?.abort();terrainController = undefined;
  terrainHandle?.dispose();terrainHandle = undefined;
  $('terrain').replaceChildren();$('terrain').style.visibility = 'hidden';
  for (const key of ['frame','pose','renderSequence','distance','requests','uniqueRequests','camera','input']) delete $('terrain').dataset[key];
}
async function terrain() {
  stopTerrain();
  if (!inPlayer) return;
  // Privacy boundary is checked before any provider import/mount. It remains
  // closed during parsing, unavailable files and modeled local alternatives.
  if (privateView) {
    $('provider-credit').hidden = true;
    text('terrain-status','Private local · first-party 2D only');
    return;
  }
  if ($('offline').checked) {
    $('terrain-status').textContent = '2D route preview · terrain off';
    return;
  }
  const controller = new AbortController();
  terrainController = controller;
  const status = text => {if (!controller.signal.aborted) $('terrain-status').textContent = text;};
  status('Loading terrain · 2D route ready');
  $('provider-credit').hidden = false;
  // The reused SDK loader itself has no timeout. Bound this prototype request.
  const deadline = setTimeout(() => {
    status('Terrain unavailable · 2D route preview');
    stopTerrain();
  },15000);
  controller.signal.addEventListener('abort',()=>clearTimeout(deadline),{once:true});
  try {
    const { mountRouteTerrain } = await import('../../js/route-terrain-view.mjs');
    if (controller.signal.aborted) return;
    const handle = await mountRouteTerrain({
      container:$('terrain'),analysis,snapshot:snapshot(),signal:controller.signal,
      camera:rideCamera,onCamera:()=>cameraControls(),
      onManual:()=>{
        if (controller.signal.aborted) return;
        manual = true;returnRider.hidden = false;cameraControls();pause();
      },
      onStatus:(state,reason) => {
        if (controller.signal.aborted) return;
        if (state === 'ready') {
          clearTimeout(deadline);terrainReady = true;$('player').classList.add('online');
          cameraControls(true);
          $('camera').disabled = false;
          status(manual ? 'Manual exploration · paused' :
            playing ? 'Satellite terrain · preview playback' : 'Satellite terrain · paused');
        }
        if (state === 'verifying') {
          terrainReady = false;
          status(reason);
        }
        if (state === 'relocating') {
          terrainReady = false;$('player').classList.remove('online');
          cameraControls(false);status(reason);
        }
        if (state === 'unavailable') {
          clearTimeout(deadline);
          terrainReady = false;$('player').classList.remove('online');
          cameraControls(false);
          $('camera').disabled = !analysis;
          manual = false;returnRider.hidden = camera === 'follow';
          status(`Terrain unavailable · ${reason} · 2D route preview`);
        }
      },
    });
    if (controller.signal.aborted) handle?.dispose();
    else {terrainHandle = handle;updatePosition(true);}
  } catch {
    if (controller.signal.aborted || terrainController !== controller) return;
    status('Terrain unavailable · 2D route preview');
    stopTerrain();
  }
}
async function choose(id) {
  const request = ++generation;
  pause();stopTerrain();
  rideCamera.reset();
  relive.library.cancelPending();relive.clear();
  if (privateView) {
    privateView = false;mode = 'experiment';$('ride-mode').value = mode;
    configureRate(false);
  }
  $('player-route').querySelector('[data-private]')?.remove();
  credit.firstChild.textContent='Route: Ride with GPS · Route preview ';
  $('offline').disabled = false;
  $('profile-help').textContent = profileHelp;
  clearComparison('Route changed.');
  routeController?.abort();
  const controller = new AbortController();routeController = controller;
  analysis = null;projection = undefined;selected = id;distance = 0;
  $('camera').disabled = true;
  selectedChapterId = undefined;highlightedChapterId = undefined;insights = undefined;
  camera = 'follow';$('camera').value = camera;
  $('player-map').dataset.framing = camera;
  $('section-list').replaceChildren();text('section-count','');
  $('sections').open = false;
  for (const id of ['landing-map','player-map','player-profile','landing-profile']) $(id).replaceChildren();
  $('player-map').setAttribute('viewBox','0 0 640 580');
  renderInsights();
  simulation = undefined;scheduler = undefined;
  renderCockpit();
  text('progress','—');
  $('fly').disabled = true;$('play').disabled = true;
  $('load-status').textContent = 'Loading the cleared route…';
  if (inPlayer) $('terrain-status').textContent = 'Loading selected route…';
  try {
    const summary = pack.routes.find(r=>r.routeId===id);
    if (!summary || withdrawn.has(id)) throw Error('Unavailable preview route');
    const next = cache.get(id) || await loadRouteAnalysis({pack,routeId:id,revisionId:summary.revisionId,
      readAsset:path=>readAsset(path,controller.signal)});
    if (request !== generation || withdrawn.has(id)) return;
    if (next.status !== 'supported') throw Error('Route analysis unavailable');
    cache.set(id,next);
    selected = id;analysis = next;distance = 0;
    notice = '';buildModel(0);
    const groupIndex = groups.findIndex(g=>g.routes.includes(id)), group = groups[groupIndex];
    $('landing-route').value = groupIndex;
    $('player-route').value = id;
    $('route-title').textContent = params.get('layout') === 'long-name' ?
      `${names[id]} — long-name layout sample` : names[id];
    $('distance').textContent = (summary.listed.distanceM/1000).toFixed(1);
    $('ascent').textContent = format(summary.listed.gainM);
    $('variants').replaceChildren();
    if (group.routes.length === 1) {
      const label = document.createElement('span');label.className = 'only';label.textContent = 'Standard only';
      $('variants').append(label);
    } else for (const route of group.routes) {
      const button = document.createElement('button');
      button.textContent = variant(route);button.setAttribute('aria-pressed',String(route===id));
      button.addEventListener('click',async()=>{
        await choose(route);
        // Recreated variant buttons must not leave focus on the body.
        $('variants').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
      });
      $('variants').append(button);
    }
    drawMap($('landing-map'));drawMap($('player-map'),true);
    profile($('landing-profile'),70);profile($('player-profile'),100);
    renderSections();$('camera').disabled = false;
    frameRoute('follow');
    $('load-status').textContent = '';
    $('fly').disabled = false;$('landing-route').disabled = false;
    if (inPlayer) void terrain();
  } catch {
    if (request !== generation) return;
    simulation = {status:'unavailable',unavailableReasons:['Selected route unavailable. Choose another route or return to Routes.']};
    renderCockpit();
    $('load-status').textContent = 'Route unavailable. Reload to try this public preview again.';
    $('terrain-status').textContent = 'Selected route unavailable · return to Routes';
    // Never let an old route stand in for the failed requested selection.
    $('play').disabled = true;
    $('landing-map').replaceChildren();$('player-map').replaceChildren();
    $('player-profile').replaceChildren();$('landing-profile').replaceChildren();
    $('route-title').textContent = 'Route unavailable';
    $('distance').textContent = '—';$('ascent').textContent = '—';
  }
}
window.addEventListener('kotr-offline-withdrawn',event=>{
  for (const id of event.detail) {withdrawn.add(id);cache.delete(id);}
  if (withdrawn.has(selected)) void choose(selected);
});
async function enter() {
  if (!analysis) return;
  inPlayer = true;$('landing').hidden = true;$('player').hidden = false;
  document.body.style.overflow = 'hidden';
  layoutSheets();
  $('back').focus({preventScroll:true});
  await terrain();
}
function back() {
  pause();stopTerrain();inPlayer = false;
  if (privateView) void choose(selected);
  else relive.library.cancelPending();
  $('player').hidden = true;$('landing').hidden = false;
  $('provider-credit').hidden = true;
  document.body.style.overflow = '';
  $('fly').focus({preventScroll:true});
}
$('fly').addEventListener('click',enter);
$('back').addEventListener('click',back);
$('landing-route').addEventListener('change',e=>choose(groups[Number(e.target.value)].routes[0]));
$('player-route').addEventListener('change',e=>choose(e.target.value));
$('play').addEventListener('click',()=>{
  if (playing) {pause();return;}
  if (mode === 'relive') {
    if (!relive.clock) return;
    relive.clock.play();playing = true;
    $('play').innerHTML = 'Ⅱ <span>Pause</span>';
    $('play').setAttribute('aria-label','Pause recorded replay');
    frame = requestAnimationFrame(tick);return;
  }
  if (!scheduler) return;
  if (distance >= analysis.distanceM) {
    clearComparison('Restart starts a new trial.');
    distance = simulation.restart().distanceM;pendingHistory = undefined;pendingGear = undefined;
  }
  if (manual || camera === 'section') followRider();
  notice = '';scheduler.play();
  presentedSeconds = simulation.snapshot().simulationSeconds;
  playing = true;$('play').innerHTML = 'Ⅱ <span>Pause</span>';
  if (terrainReady) $('terrain-status').textContent = 'Satellite terrain · preview playback';
  $('play').setAttribute('aria-label','Pause route preview');
  frame = requestAnimationFrame(tick);
});
$('seek').addEventListener('input',e=>{
  if (mode === 'relive') {seekRecorded(Number(e.target.value)/1000*relive.replay.durationSeconds);return;}
  if (!analysis) return;
  seekTo(Number(e.target.value)/1000*analysis.distanceM);
});
$('player-profile').addEventListener('pointerdown',e=>{
  if (mode === 'relive' && relive.clock && e.button === 0) {
    const box=e.currentTarget.getBoundingClientRect();
    seekRecorded((e.clientX-box.left)/box.width*relive.replay.durationSeconds);
    e.currentTarget.focus({preventScroll:true});return;
  }
  if (!analysis || e.button !== 0) return;
  const box = e.currentTarget.getBoundingClientRect();
  seekTo((e.clientX-box.left)/box.width*analysis.distanceM);
  e.currentTarget.focus({preventScroll:true});
});
$('player-profile').addEventListener('keydown',e=>{
  if (mode === 'relive' && relive.clock) {
    const a=relive.actual(), times=relive.replay.times;
    const targets={Home:0,End:relive.replay.durationSeconds,
      ArrowLeft:times[Math.max(0,a.sampleIndex-1)],ArrowDown:times[Math.max(0,a.sampleIndex-1)],
      ArrowRight:times[Math.min(times.length-1,a.sampleIndex+1)],ArrowUp:times[Math.min(times.length-1,a.sampleIndex+1)],
      PageDown:a.elapsedSeconds-10,PageUp:a.elapsedSeconds+10};
    if (e.key in targets) {e.preventDefault();seekRecorded(targets[e.key]);}
    return;
  }
  if (!analysis) return;
  const targets = {ArrowLeft:distance-250,ArrowDown:distance-250,ArrowRight:distance+250,ArrowUp:distance+250,
    PageDown:distance-1000,PageUp:distance+1000,Home:0,End:analysis.distanceM};
  if (!(e.key in targets)) return;
  e.preventDefault();seekTo(targets[e.key]);
});
$('main-climb').addEventListener('click',()=>selectSection(insights?.mainClimb?.id));
$('retry-section').addEventListener('click',()=>selectSection(insights?.selected?.id));
$('profile-close').addEventListener('click',()=>{
  $('profile-panel').hidden = true;$('profile-toggle').setAttribute('aria-expanded','false');$('profile-toggle').focus();
});
for (const button of document.querySelectorAll('[data-frame]'))
  button.addEventListener('click',()=>{pause();frameRoute(button.dataset.frame);});
for (const [button,panel,otherButton,otherPanel] of [
  ['profile-toggle','profile-panel','tools-toggle','tools-panel'],
  ['tools-toggle','tools-panel','profile-toggle','profile-panel'],
]) $(button).addEventListener('click',()=>{
  $(panel).hidden = !$(panel).hidden;
  $(button).setAttribute('aria-expanded',String(!$(panel).hidden));
  $(otherPanel).hidden = true;$(otherButton).setAttribute('aria-expanded','false');
  layoutSheets();
  if (!$(panel).hidden) $(panel === 'profile-panel' ? 'seek' : 'tools-close').focus({preventScroll:true});
});
$('tools-close').addEventListener('click',()=>{
  $('tools-panel').hidden = true;$('tools-toggle').setAttribute('aria-expanded','false');$('tools-toggle').focus();
});
$('camera').addEventListener('change',e=>{pause();frameRoute(e.target.value);});
$('offline').checked = params.get('terrain') === 'off';
$('offline').addEventListener('change',()=>{pause();void terrain();});
$('restart').addEventListener('click',()=>{
  if (mode === 'relive') {seekRecorded(0);return;}
  pause();
  clearComparison('Restart starts a new trial.');
  distance = simulation?.status === 'available' ? simulation.restart().distanceM : 0;
  pendingHistory = undefined;pendingGear = undefined;
  notice = `Restarted at trial origin · paused. ${comparisonNotice}`;updatePosition(true);renderCockpit();
});
$('playback-rate').addEventListener('change',()=>{
  pause();
  if (mode === 'relive') {
    relive.clock?.setAnimationRate(Number($('playback-rate').value));renderCockpit();return;
  }
  scheduler?.setRate(Number($('playback-rate').value));
  notice = 'Playback rate changed · paused. Riding speed is unchanged.';renderCockpit();
});
$('ride-mode').addEventListener('change',e=>{
  if (e.target.value === 'relive') {
    if (relive.record && relive.replay.status === 'available') {
      pause();mode='relive';configureRate(true);simulation=scheduler=undefined;
      relive.library.cancelPending();relive.clearComparison();relive.clock.setAnimationRate(1);
      text('relive-message','Recording retained unchanged · paused.');
      clearComparison('Recorded replay is not a strategy ghost.');relive.draw();renderCockpit();
    } else beginPrivate();
    relive.root.open=true;return;
  }
  if (privateView && (!relive.record || $('relive-alternative').disabled)) {
    $('ride-mode').value=mode;
    text('relive-message','Modeled alternative unavailable without continuous supported geometry; recording and gaps are unchanged.');
    return;
  }
  if (mode === 'relive') {
    configureRate(false);distance=0;
    drawMap($('player-map'),true);profile($('player-profile'),100);renderSections();
    $('profile-help').textContent=profileHelp;
  }
  relive.library.cancelPending();
  relive.clearComparison();
  if(privateView)text('relive-message','Modeled alternative · recording retained unchanged. Select Relive to return to source time.');
  pause();mode = e.target.value;notice = 'Mode changed · new model, paused.';
  buildModel();updatePosition(true);
});
for (const button of document.querySelectorAll('[data-effort]'))
  button.addEventListener('click',()=>command({type:'effort',value:Number(button.dataset.effort)}));
$('coast').addEventListener('click',()=>command({type:'coast'}));
// Sort only the shared example drivetrain's legal ratios. No speed/cadence solver here.
const gears = exampleDrivetrain.frontTeeth.flatMap(frontTeeth=>
  exampleDrivetrain.rearTeeth.map(rearTeeth=>({frontTeeth,rearTeeth})))
  .sort((a,b)=>a.frontTeeth/a.rearTeeth-b.frontTeeth/b.rearTeeth);
for (const [id,delta] of [['gear-easier',-1],['gear-harder',1]])
  $(id).addEventListener('click',()=>{
    const gear = pendingGear || simulation.snapshot().gear;
    const i = gears.findIndex(g=>g.frontTeeth === gear.frontTeeth && g.rearTeeth === gear.rearTeeth);
    const next = Math.max(0,Math.min(gears.length-1,i+delta));
    if (i === next) {notice = delta < 0 ? 'Already in the easiest example gear.' : 'Already in the hardest example gear.';renderCockpit();return;}
    command({type:'gear',value:gears[next]});
  });
for (const id of ['rider-mass','rider-ftp','rider-bike'])
  $(id).addEventListener('input',()=>{
    pause();notice = 'Inputs changed · new model here, paused. Not saved.';
    buildModel();updatePosition(true);
  });
$('rider-reset').addEventListener('click',()=>{
  pause();
  for (const id of ['rider-mass','rider-ftp','rider-bike']) $(id).value = '';
  notice = 'Example rider restored · new model here, paused.';buildModel();updatePosition(true);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
reduced.addEventListener('change',()=>pause());
document.addEventListener('keydown',e=>{
  if (e.key !== 'Escape' || !inPlayer) return;
  for (const [panel,toggle] of [['tools-panel','tools-toggle'],['profile-panel','profile-toggle']]) {
    if (!$(panel).hidden) {
      $(panel).hidden = true;$(toggle).setAttribute('aria-expanded','false');$(toggle).focus();return;
    }
  }
  back();
});
const dialogText = {
  week:['My week','Preview only. Ride order is D0 Warm-up, D1 Vicentine Hills, D2 Asolo / Monte Grappa, D3 Brentha Valley. Dates are not assigned; no itinerary is saved here.'],
  essentials:['Essentials','KOTR 2027 · Bassano del Grappa · May 20–24, 2027. Logistics are not part of this prototype. Standard labels the source short variant (or warm-up); Long may be a different route, not merely an extension.'],
};
document.querySelectorAll('[data-dialog]').forEach(button=>button.addEventListener('click',()=>{
  const [title,copy] = dialogText[button.dataset.dialog];
  $('dialog-title').textContent = title;$('dialog-copy').textContent = copy;$('info-dialog').showModal();
}));
$('dialog-close')?.addEventListener('click',()=>$('info-dialog').close());
$('routes-nav').addEventListener('click',()=>$('landing-route').focus());

function configureRate(recorded) {
  $('playback-rate').replaceChildren(...(recorded?[.5,1,2,4]:[1,4,16,60]).map(n=>new Option(`${n}×`,n)));
  $('playback-rate').value=recorded?'1':'16';
  document.querySelector('.playback-rate').firstChild.textContent=recorded?'Source time':'Ride time';
  $('profile-help').textContent=recorded ?
    'Raw source elevation dots by recorded elapsed. Tap to seek paused. Arrow keys step exact samples; Page keys 10 s; Home / End. Gaps remain unknown.' : profileHelp;
}
function beginPrivate() {
  // Dispose the public provider BEFORE the importer may parse/derive anything.
  pause();stopTerrain();generation++;routeController?.abort();
  privateView=true;$('offline').checked=true;$('offline').disabled=true;
  cameraControls(false);
  credit.firstChild.textContent='Private local recording / course · first-party 2D ';
  $('provider-credit').hidden=true;text('terrain-status','Private local · first-party 2D only');
  relive.clear();clearComparison('Private recording selected.');
  mode='relive';$('ride-mode').value=mode;configureRate(true);
  simulation=scheduler=undefined;analysis=null;distance=0;
  projection=undefined;camera='follow';$('camera').value=camera;
  selectedChapterId=highlightedChapterId=insights=undefined;
  $('player-route').querySelector('[data-private]')?.remove();
  for (const id of ['player-map','player-profile','section-list']) $(id).replaceChildren();
  for (const id of ['position','height','section-detail','road-transition','model-provenance','ride-remaining'])
    text(id,'');
  renderCockpit();
}
function seekRecorded(seconds) {
  pause();
  if (!relive.clock || !Number.isFinite(seconds)) {
    text('relive-message','Recorded seek unavailable. Choose a valid timestamped recording.');return;
  }
  relive.clock.seekRecordedSeconds(seconds);updatePosition();
}
const relive = installRideRelive({
  beforeOpen:beginPrivate,pause,seek:seekRecorded,changed:()=>{},
  cancelled:()=>{beginPrivate();text('relive-message','Import cancelled; playback and derived view cleared.');},
  removed:id=>{
    if (relive.record?.id===id) {beginPrivate();text('relive-message','Local file removed; playback and derived view cleared.');}
  },
  publicPlan:()=>{
    const a=cache.get(selected);
    return a && !withdrawn.has(selected) ? {name:names[selected],analysis:a} : null;
  },
  open:async record=>{
    const request=generation;
    const replay=await relive.load(record);
    if(request!==generation)return;
    analysis=record.analysis;
    const option=new Option(`${record.name} · private ${record.decoded.kind}`,record.id);
    option.dataset.private='true';$('player-route').add(option);$('player-route').value=record.id;
    if(replay.status==='available') {
      relive.draw();renderCockpit();
    } else if(analysis.status==='supported') {
      mode='explore';$('ride-mode').value=mode;configureRate(false);
      drawMap($('player-map'),true);profile($('player-profile'),100);renderSections();
      buildModel(0);updatePosition();
      text('ride-notice','Geometry only · no complete actual timestamps. Modeled, not recorded.');
    } else {
      renderCockpit();
      text('relive-message',`${replay.reason} Continuous geometry analysis also unavailable; no model or gaps invented.`);
    }
  },
});
$('ride-mode').add(new Option('Relive · recorded source time','relive'));
relive.root.addEventListener('toggle',()=>{
  if(relive.root.open && !privateView)beginPrivate();
});
$('relive-alternative').addEventListener('click',()=>{
  $('ride-mode').value='experiment';$('ride-mode').dispatchEvent(new Event('change'));
});
$('relive-public').addEventListener('click',()=>choose(selected));

try {
  if (pointerURL.origin !== location.origin ||
      !/^route-pack(?:\.[a-f0-9]{24})?\.json$/.test(pointerURL.pathname.split('/').pop()))
    throw Error('Invalid public pointer URL');
  const pointer = JSON.parse(new TextDecoder().decode(await readAsset('assets/'+pointerURL.pathname.split('/').pop())));
  validatePackPointer(pointer);
  const bytes = await readAsset(pointer.path);
  await verifyAsset(pointer,bytes);
  pack = JSON.parse(new TextDecoder().decode(bytes));
  await validateRoutePack(pack,{metadataOnly:true});
  for (const [i,g] of groups.entries()) $('landing-route').add(new Option(g.label,String(i)));
  for (const g of groups) for (const id of g.routes) $('player-route').add(new Option(`${names[id]} · ${variant(id)}`,id));
  $('landing-route').disabled = false;
  await choose(params.get('route') === 'standard-only' ? 'rwgps-57874121' : 'rwgps-57873019');
} catch {
  $('load-status').textContent = 'Cleared routes unavailable. Reload to try again.';
}
