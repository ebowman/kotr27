import { loadRouteAnalysis } from '/js/route-analysis-loader.mjs';
import { positionAt } from '/js/route-analysis.mjs';
import { verifyAsset } from '/js/route-catalog.mjs';

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
let pack, selected, analysis, inPlayer = false, playing = false, distance = 0;
let generation = 0, terrainController, terrainHandle, lastTime, frame, projection;
let terrainReady = false;
let camera = 'follow';
const cache = new Map();
const format = n => new Intl.NumberFormat('en-GB').format(Math.round(n));
const readAsset = async path => {
  const res = await fetch('/'+path);
  if (!res.ok) throw Error('Cleared route asset unavailable');
  return new Uint8Array(await res.arrayBuffer());
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
  if (svg.id === 'player-profile') svg.append(node('line',{id:'profile-cursor',x1:0,x2:0,y1:0,y2:height,stroke:'#f2efe5','stroke-width':2}));
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
    const [x,y] = projection(positionAt(analysis,distance));
    svg.append(node('circle',{id:'outline-rider',cx:x,cy:y,r:8,fill:'#dfb767',stroke:'white','stroke-width':4}));
  }
  $('peak-label').textContent = `${format(peak.elevationM)} m`;
}
function snapshot() {
  return {identity:analysis.identity,position:positionAt(analysis,distance),distanceM:distance,
    phase:playing?'playing':'paused',cameraMode:camera};
}
function updatePosition(force = false) {
  const p = positionAt(analysis,distance), xy = projection(p);
  $('outline-rider')?.setAttribute('cx',xy[0]);
  $('outline-rider')?.setAttribute('cy',xy[1]);
  const ratio = distance/analysis.distanceM;
  $('seek').value = Math.round(ratio*1000);
  $('profile-cursor')?.setAttribute('x1',ratio*640);
  $('profile-cursor')?.setAttribute('x2',ratio*640);
  $('position').value = `${(distance/1000).toFixed(1)} km`;
  $('height').value = `${format(p.rawElevationM)} m`;
  $('progress').textContent = `${(distance/1000).toFixed(1)} km`;
  terrainHandle?.update(snapshot(),force);
}
function pause() {
  playing = false;cancelAnimationFrame(frame);lastTime = undefined;
  $('play').innerHTML = '▶ <span>Play</span>';
  $('play').setAttribute('aria-label','Play route preview');
  if (terrainReady) $('terrain-status').textContent = 'Satellite terrain · paused';
}
function tick(time) {
  if (!playing || !inPlayer) return;
  if (lastTime !== undefined) distance = Math.min(analysis.distanceM,distance+Math.min(time-lastTime,100)*analysis.distanceM/90000);
  lastTime = time;
  updatePosition();
  if (distance >= analysis.distanceM) pause();
  else frame = requestAnimationFrame(tick);
}
function stopTerrain() {
  terrainReady = false;
  $('player').classList.remove('online');
  terrainController?.abort();terrainController = undefined;
  terrainHandle?.dispose();terrainHandle = undefined;
  $('terrain').replaceChildren();$('terrain').style.visibility = 'hidden';
}
async function terrain() {
  stopTerrain();
  if (!inPlayer) return;
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
    const { mountRouteTerrain } = await import('/js/route-terrain-view.mjs');
    if (controller.signal.aborted) return;
    const handle = await mountRouteTerrain({
      container:$('terrain'),analysis,snapshot:snapshot(),signal:controller.signal,
      onManual:()=>pause(),
      onStatus:(state) => {
        if (controller.signal.aborted) return;
        if (state === 'ready') {
          clearTimeout(deadline);terrainReady = true;$('player').classList.add('online');
          status(playing ? 'Satellite terrain · preview playback' : 'Satellite terrain · paused');
        }
        if (state === 'verifying') {
          terrainReady = false;
          status('Satellite terrain · verifying view');
        }
        if (state === 'unavailable') {
          clearTimeout(deadline);
          terrainReady = false;$('player').classList.remove('online');
          status('Terrain unavailable · 2D route preview');
        }
      },
    });
    if (controller.signal.aborted) handle?.dispose();
    else terrainHandle = handle;
  } catch {
    status('Terrain unavailable · 2D route preview');
    stopTerrain();
  }
}
async function choose(id) {
  const request = ++generation;
  pause();stopTerrain();
  $('fly').disabled = true;$('play').disabled = true;
  $('load-status').textContent = 'Loading the cleared route…';
  if (inPlayer) $('terrain-status').textContent = 'Loading selected route…';
  try {
    const summary = pack.routes.find(r=>r.routeId===id);
    if (!summary) throw Error('Unknown preview route');
    if (!cache.has(id)) cache.set(id,loadRouteAnalysis({pack,routeId:id,revisionId:summary.revisionId,readAsset}));
    const next = await cache.get(id);
    if (request !== generation) return;
    if (next.status !== 'supported') throw Error('Route analysis unavailable');
    selected = id;analysis = next;distance = 0;
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
    updatePosition();
    $('load-status').textContent = '';
    $('fly').disabled = false;$('play').disabled = false;$('landing-route').disabled = false;
    if (inPlayer) void terrain();
  } catch {
    if (request !== generation) return;
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
async function enter() {
  if (!analysis) return;
  inPlayer = true;$('landing').hidden = true;$('player').hidden = false;
  document.body.style.overflow = 'hidden';
  $('back').focus({preventScroll:true});
  await terrain();
}
function back() {
  pause();stopTerrain();inPlayer = false;
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
  if (distance >= analysis.distanceM) distance = 0;
  playing = true;$('play').innerHTML = 'Ⅱ <span>Pause</span>';
  if (terrainReady) $('terrain-status').textContent = 'Satellite terrain · preview playback';
  $('play').setAttribute('aria-label','Pause route preview');
  frame = requestAnimationFrame(tick);
});
$('seek').addEventListener('input',e=>{
  pause();distance = Number(e.target.value)/1000*analysis.distanceM;updatePosition(true);
});
for (const [button,panel,otherButton,otherPanel] of [
  ['profile-toggle','profile-panel','tools-toggle','tools-panel'],
  ['tools-toggle','tools-panel','profile-toggle','profile-panel'],
]) $(button).addEventListener('click',()=>{
  $(panel).hidden = !$(panel).hidden;
  $(button).setAttribute('aria-expanded',String(!$(panel).hidden));
  $(otherPanel).hidden = true;$(otherButton).setAttribute('aria-expanded','false');
});
$('camera').addEventListener('change',e=>{camera=e.target.value;updatePosition(true);});
$('offline').checked = params.get('terrain') === 'off';
$('offline').addEventListener('change',()=>{pause();void terrain();});
$('restart').addEventListener('click',()=>{pause();distance=0;updatePosition(true);});
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
$('dialog-close').addEventListener('click',()=>$('info-dialog').close());
$('routes-nav').addEventListener('click',()=>$('landing-route').focus());

try {
  const pointer = JSON.parse(new TextDecoder().decode(await readAsset('assets/route-pack.json')));
  const bytes = await readAsset(pointer.path);
  await verifyAsset(pointer,bytes);
  pack = JSON.parse(new TextDecoder().decode(bytes));
  for (const [i,g] of groups.entries()) $('landing-route').add(new Option(g.label,String(i)));
  for (const g of groups) for (const id of g.routes) $('player-route').add(new Option(`${names[id]} · ${variant(id)}`,id));
  await choose(params.get('route') === 'standard-only' ? 'rwgps-57874121' : 'rwgps-57873019');
} catch {
  $('load-status').textContent = 'Cleared routes unavailable. Reload to try again.';
}
