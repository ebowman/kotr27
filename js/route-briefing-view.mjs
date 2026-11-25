import { briefingAt, sectionSummary, outlineProjection, km } from './route-briefing.mjs';
import { positionAt } from './route-analysis.mjs';
import { routePlayback, subscribePlayback } from './route-session.mjs';

const node = (tag, text, parent, id) => {
  const e = document.createElement(tag); e.textContent = text; parent.append(e);
  if (id) e.id = id;
  return e;
};
const svgNode = (tag, attributes, parent) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k,v] of Object.entries(attributes)) e.setAttribute(k,v);
  parent.append(e); return e;
};
export function installRouteBriefing(parent, onSeek) {
  const root = node('section','',parent,'route-briefing'); root.hidden = true;
  root.setAttribute('aria-label','Linked route briefing');
  let analysis, identity, visible = false, draw = () => {};
  function act(command, ...args) {
    const s = routePlayback[command](...args);
    onSeek(s, command === 'selectChapter' ? s.chapterId : null);
  }
  function build(bundle, a) {
    root.replaceChildren();
    node('h2',`${bundle.route.name} · Route briefing`,root);
    node('p',bundle.route.kind==='local' ?
      'Private local geometry, not an organizer revision. Dates, facility annotations and source measurements are not verified. No external map.' :
      `${bundle.revision.status} · ${bundle.revision.id}. ${bundle.revision.provenance.source}. ` +
      `Observed ${bundle.revision.provenance.observedOn}; provider revision date unknown. D1–D4 are source groups, not calendar assignments.`,root);
    const unsupported = briefingAt(a,0);
    if (unsupported.status !== 'supported') {
      node('p',unsupported.message,root); draw = () => {}; return;
    }
    node('p',`${km(a.distanceM)} km horizontal route · ${Math.round(a.processedTotals.ascentM)} m processed ascent (derived, 250 m windows). ` +
      `Raw point ascent: ${Math.round(a.rawTotals.ascentM)} m. Source-listed: ${a.sourceTotals?.listed ?
        `${km(a.sourceTotals.listed.distanceM)} km / ${a.sourceTotals.listed.gainM} m gain` : 'unavailable'}.`,root);
    node('p','Source uncertainty: elevation and derived grades are not independently verified road measurements. Windows can omit short hills. Extreme source elevations are not corrected or clamped; difficulty is not a safety or rider fitness assessment.',root);
    if (a.warnings.length) node('p',`Source sampling warning: ${a.warnings.length} sparse interval(s); detail between points is uncertain.`,root);
    const overview = briefingAt(a,0);
    const button = (text,id,command,...args) => {
      const b = node('button',text,root,id); b.type='button'; b.onclick=()=>act(command,...args); return b;
    };
    if (overview.hardest) {
      node('p',`Hardest sustained supported section — proxy: greatest derived gain among qualifying continuous climbs, not physiological difficulty. ` +
        `${km(overview.hardest.startM)}–${km(overview.hardest.endM)} km: ${sectionSummary(a,overview.hardest)}`,root,'briefing-hardest');
      button('Jump to greatest-gain climb','briefing-hardest-jump','selectChapter',overview.hardest.chapterId);
    } else node('p','No sustained climb qualifies (at least 500 m, 30 m gain and 3% average). This does not imply an easy or safe route.',root,'briefing-hardest');
    node('h3','Sections in riding order',root);
    node('p','Section numbers follow the exported riding direction. Repeated coordinates on loops have distinct distances. Select a section here or its numbered outline marker.',root);
    const list = node('ol','',root,'briefing-chapters');
    const chapterButtons = [];
    for (const [i,c] of a.chapters.entries()) {
      const li = node('li','',list);
      const b = node('button',`${i+1}. ${c.kind} · ${km(c.startM)}–${km(c.endM)} km`,li);
      b.type='button'; b.onclick=()=>act('selectChapter',c.id); chapterButtons.push([b,c.id]);
      node('p',`${sectionSummary(a,c)} Why it matters: ${c.kind === 'ascent' ? 'this continuous rising section adds climbing before the next change of terrain' :
        c.kind === 'descent' ? 'the profile loses elevation here; this is not a claim about safe descending speed' :
          'these windows stay within ±0.5% grade; smaller rises and dips may be hidden'}.`,li);
    }
    node('h3','Linked elevation profile',root);
    node('p','Horizontal axis: route kilometres, start → finish. Vertical axis: derived elevation in metres. Tap to seek, or use the labeled distance slider and section buttons.',root);
    const profile = svgNode('svg',{viewBox:'0 0 1000 180',preserveAspectRatio:'none',role:'img',
      'aria-label':'Derived elevation profile; equivalent distances and section metrics are in the ordered list.'},root);
    profile.id='briefing-profile';
    const heights = [a.windows[0].startElevationM,...a.windows.map(w=>w.endElevationM)];
    const lo = Math.min(...heights), hi = Math.max(...heights);
    const y = h => 155-130*(h-lo)/Math.max(1,hi-lo);
    node('p',`Elevation range: ${Math.round(lo)}–${Math.round(hi)} m (derived). Distance: 0–${km(a.distanceM)} km.`,root);
    const path = [[0,heights[0]],...a.windows.map(w=>[w.endM,w.endElevationM])];
    svgNode('path',{d:'M'+path.map(([d,h])=>`${1000*d/a.distanceM},${y(h)}`).join(' L'),fill:'none',stroke:'#163c34','stroke-width':3},profile);
    const cursor = svgNode('line',{y1:0,y2:180,stroke:'#8a3c22','stroke-width':4},profile);
    profile.onclick = e => {
      const rect = profile.getBoundingClientRect();
      act('seekDistance',(e.clientX-rect.left)/rect.width*a.distanceM);
    };
    const status = node('p','',root,'briefing-position');
    const detail = node('p','',root,'briefing-current');
    const next = node('p','',root,'briefing-next');
    const climb = node('p','',root,'briefing-climbs');
    node('h3','Route controls',root);
    const deck = node('div','',root,'briefing-controls'); deck.className='site-actions';
    for (const [text,id,command] of [
      ['Play animation','briefing-play','play'],['Previous chapter','briefing-previous','previousChapter'],
      ['Next chapter','briefing-next-button','nextChapter'],['Restart at start','briefing-restart','restart'],
      ['Route overview (keep position)','briefing-overview','backToOverview'],
    ]) {
      const b = button(text,id,command); deck.append(b);
      if (command === 'play') b.onclick=()=>act(routePlayback.getSnapshot().phase === 'playing' ? 'pause' : 'play');
    }
    const label = node('label','Distance along route (metres)',root);
    const seek = node('input','',label,'briefing-seek'); seek.type='range'; seek.min=0; seek.max=a.distanceM; seek.step='any';
    seek.oninput=()=>act('seekDistance',Number(seek.value));
    seek.onkeydown=e=>{
      const delta={ArrowLeft:-100,ArrowDown:-100,ArrowRight:100,ArrowUp:100}[e.key];
      if (delta || ['Home','End'].includes(e.key)) {
        e.preventDefault(); act('seekDistance',e.key === 'Home' ? 0 : e.key === 'End' ? a.distanceM :
          routePlayback.getSnapshot().distanceM+delta);
      }
    };
    const numberLabel = node('label','Seek to route kilometres',root);
    const distance = node('input','',numberLabel,'briefing-distance'); distance.type='number'; distance.min=0;
    distance.max=a.distanceM/1000; distance.step='any';
    const go = node('button','Seek distance',root); go.type='button';
    go.onclick=()=>{
      if (distance.value.trim() && distance.checkValidity()) act('seekDistance',Number(distance.value)*1000);
      else distance.reportValidity();
    };
    distance.required=true;
    const speedLabel = node('label','Animation rate (not rider speed)',root);
    const speed = node('select','',speedLabel,'briefing-rate');
    for (const rate of [.5,1,2,4]) speed.add(new Option(`${rate}×`,rate));
    speed.onchange=()=>act('setAnimationRate',Number(speed.value));
    node('p','Animation is not ride time. No FTP, recording, map provider or 3D is needed. Changing camera framing never changes route progress.',root);
    const estimateStatus=node('p','',root,'briefing-estimate-status');
    node('h3','Sourced POIs',root);
    const pois = node('ul','',root,'briefing-pois');
    if (!a.annotations.pois.length) node('li','No verified facility POIs. Water, stops and emergency exits are unknown; none have been invented. This is not evidence that facilities do not exist.',pois);
    for (const p of a.annotations.pois) {
      const li=node('li','',pois), b=node('button',`${p.text} · ${km(p.distanceM)} km`,li);
      b.onclick=()=>act('seekDistance',p.distanceM);
      node('span',` ${p.source.name} · ${p.source.observedOn} · ${p.confidence}`,li);
    }
    const nextPOI=node('p','',root,'briefing-next-poi');
    node('h3','2D route outline · north up',root);
    const start=a.points[0], finish=a.points.at(-1);
    node('p',`Start (S): ${start.lat.toFixed(5)}, ${start.lon.toFixed(5)} → finish (F): ${finish.lat.toFixed(5)}, ${finish.lon.toFixed(5)}. ` +
      'Follow increasing section numbers in exported riding order; start and finish may overlap. Outline only, not a road map or live location.',root);
    const map=svgNode('svg',{viewBox:'0 0 400 400',role:'img',
      'aria-label':'North-up route outline with numbered section starts, start S, finish F and current selected position. Use the ordered section buttons for equivalent selection.'},root);
    map.id='briefing-map';
    const project=outlineProjection(a.points);
    const display=a.points.filter((p,i)=>i%Math.max(1,Math.ceil(a.points.length/5000))===0 || i===a.points.length-1);
    svgNode('path',{d:'M'+display.map(p=>project(p).join(',')).join(' L'),fill:'none',stroke:'#729379','stroke-width':2},map);
    for (const [i,c] of a.chapters.entries()) {
      const [x,y]=project(positionAt(a,c.startM));
      const marker=svgNode('text',{x,y,fill:'#163c34','font-size':12},map); marker.textContent=String(i+1);
      // List is the accessible keyboard equivalent. Distance occurrence, never nearest-coordinate snapping.
      marker.onclick=()=>act('selectChapter',c.id);
    }
    for (const [p,text,dy] of [[start,'S',-10],[finish,'F',15]]) {
      const [x,y]=project(p), label=svgNode('text',{x,y:y+dy,'font-weight':'bold'},map); label.textContent=text;
    }
    const dot=svgNode('circle',{r:5,fill:'#8a3c22',stroke:'white'},map);
    draw = s => {
      if (!s.position || s.identity?.revisionId!==a.revisionId) return;
      const b=briefingAt(a,s.distanceM), x=1000*s.distanceM/a.distanceM, [cx,cy]=project(s.position);
      estimateStatus.textContent=s.estimatedRide.status==='unavailable' ?
        'Ride-time estimate unavailable: correct or clear invalid rider inputs, or this profile is outside the shared model domain. Extreme processed grades are not corrected or verified road grades. Route reading remains available.' :
        `Estimated ride time: ${(s.estimatedRide.elapsedSeconds/60).toFixed(1)} min elapsed, ` +
        `${(s.estimatedRide.movingSeconds/60).toFixed(1)} min moving. Same shared pace scenario; not animation or recorded time.`;
      for (const k of ['movingSeconds','elapsedSeconds','stopSeconds']) {
        if (s.estimatedRide.status==='available') estimateStatus.dataset[k]=String(s.estimatedRide[k]);
        else delete estimateStatus.dataset[k];
      }
      for (const e of [map,profile,status]) e.dataset.distance=String(s.distanceM);
      cursor.setAttribute('x1',x); cursor.setAttribute('x2',x);
      dot.setAttribute('cx',cx); dot.setAttribute('cy',cy);
      status.textContent=`${km(b.completedM)} km completed · ${km(b.remainingM)} km remaining · selected location ` +
        `${s.position.lat.toFixed(5)}, ${s.position.lon.toFixed(5)} · ${Math.round(s.position.processedElevationM)} m derived elevation. ${s.phase}.`;
      detail.textContent=`Current section ${a.chapters.indexOf(b.current)+1}: ${b.current.kind}. ${sectionSummary(a,b.current)}`;
      next.textContent=b.next ? `Next feature: section ${a.chapters.indexOf(b.next)+1}, ${b.next.kind}, in ${km(b.next.startM-s.distanceM)} km.` :
        b.remainingM===0 ? 'Finish reached. No later section.' : 'No later section; finish is next.';
      climb.textContent=`Current climb: ${b.currentClimb ? sectionSummary(a,b.currentClimb) : 'none qualifying at this position.'} ` +
        `Next climb: ${b.nextClimb ? `in ${km(b.nextClimb.startM-s.distanceM)} km; ${sectionSummary(a,b.nextClimb)}` : 'No later qualifying climb.'}`;
      nextPOI.textContent=b.poi ? `Next sourced POI in ${km(b.poi.distanceM-s.distanceM)} km: ${b.poi.text}. ${b.poi.source.name}, ${b.poi.source.observedOn}, ${b.poi.confidence}.` : 'No later verified POI.';
      seek.value=s.distanceM; seek.setAttribute('aria-valuetext',status.textContent);
      if (document.activeElement!==distance) distance.value=(s.distanceM/1000).toFixed(3);
      speed.value=s.animationRate;
      root.querySelector('#briefing-play').textContent=s.phase==='playing' ? 'Pause animation' : s.distanceM===a.distanceM ? 'Replay from start' : 'Play animation';
      root.querySelector('#briefing-previous').disabled=!s.previousChapterId;
      root.querySelector('#briefing-next-button').disabled=!s.nextChapterId;
      for (const [button,id] of chapterButtons) {
        if (id===s.chapterId) button.setAttribute('aria-current','location');
        else button.removeAttribute('aria-current');
      }
    };
  }
  subscribePlayback(s=>{ if (visible) draw(s); });
  return {
    root,
    show(resolved) {
      const a=resolved.profile;
      visible=resolved.state.area==='explore' && !['compare','skyline','radial'].includes(resolved.state.view) && Boolean(a?.identity);
      root.hidden=!visible;
      if (!visible) {
        if(analysis?.routeId.startsWith('user:')) {analysis=null;identity=null;draw=()=>{};root.replaceChildren();}
        return;
      }
      if (identity!==a.identity) { identity=a.identity; analysis=a; build(resolved.bundle,analysis); }
      draw(routePlayback.getSnapshot());
    },
  };
}
