import { comparisonViews, comparisonRow, comparisonScales, profileSamples, profilePoint, radialPoint, variantDelta } from './route-comparison.mjs';
import { outlineProjection, sectionSummary, km } from './route-briefing.mjs';
import { positionAt } from './route-analysis.mjs';
import { subscribePlayback, routePlayback } from './route-session.mjs';

const node = (tag, text, parent, id) => {
  const e=document.createElement(tag); e.textContent=text; parent.append(e);
  if (id) e.id=id;
  return e;
};
const svgNode = (tag, attrs, parent) => {
  const e=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v);
  parent.append(e); return e;
};
const path = (points, parent, color = '#163c34') => svgNode('path',{
  d:'M'+points.map(p=>p.join(',')).join(' L'),fill:'none',stroke:color,'stroke-width':2,
  'vector-effect':'non-scaling-stroke',
},parent);
const signed = (n, format) => `${n>=0 ? '+' : '−'}${format(Math.abs(n))}`;

export function installRouteComparison(parent, {catalog, analysisFor, navigate, href}) {
  const root=node('section','',parent,'route-comparison'); root.hidden=true;
  root.setAttribute('aria-label','Route comparison, skyline and radial overview');
  const records=new Map(), chosen=new Set();
  let current, mode='compare', axis='distance', rotation=0, initialized=false, lastRoute, lastRevision, lastProfile;
  let drawings=[], controls=[], scales;
  node('h2','Compare routes · Skyline · Radial',root);
  node('p','Compare candidates without changing your trip. D1–D4 are source groups, not calendar assignments. '+
    'Use Plan’s explicit itinerary choices to ride a variant; selecting a section here only changes shared exploration.',root);
  const tabs=node('div','',root); tabs.className='site-actions';
  const tabLinks=comparisonViews.map(view=>{
    const a=node('a',view[0].toUpperCase()+view.slice(1),tabs);
    a.dataset.view=view;
    a.onclick=e=>{
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); navigate({area:'explore',view});
    };
    return a;
  });
  const selection=node('p','',root,'comparison-selection'); selection.setAttribute('role','status');
  const choices=node('fieldset','',root); node('legend','Routes to compare (not itinerary choices)',choices);
  const choiceControls=new Map();
  for (const route of catalog.data.routes) {
    const label=node('label','',choices), input=node('input','',label);
    input.type='checkbox'; input.dataset.route=route.id;
    label.append(document.createTextNode(` ${route.name}`));
    input.onchange=()=>{input.checked ? chosen.add(route.id) : chosen.delete(route.id); build();};
    choiceControls.set(route.id,input);
    records.set(route.id,{route,status:'unavailable',reason:'Verifying profile…'});
  }
  const axisLabel=node('label','Compare profile horizontal axis',root);
  const axisSelect=node('select','',axisLabel,'comparison-axis');
  axisSelect.add(new Option('Equal distance · kilometres','distance'));
  axisSelect.add(new Option('Normalized progress · percent','progress'));
  axisSelect.onchange=()=>{axis=axisSelect.value; build();};
  const rotate=node('div','',root); rotate.className='site-actions';
  for (const [text,change] of [['Rotate left −30°',-30],['Rotate right +30°',30],['Reset rotation',0]]) {
    const b=node('button',text,rotate); b.type='button';
    b.onclick=()=>{rotation=change ? (rotation+change+360)%360 : 0; build();};
  }
  const scaleText=node('p','',root,'comparison-scales');
  node('p','Derived 250 m windows are shared with Plan and the route briefing; raw point and source-listed gains remain separate. '+
    'Elevation is not independently verified. Windows can hide short hills; D4S source extremes are retained, not verified actual road grades. No numerical difficulty rating is inferred.',root);
  const deltaText=node('div','',root,'comparison-deltas');
  const panels=node('div','',root,'comparison-panels');

  function patch(row, extra={}) {
    return {area:'explore',view:mode,routeId:row.route.id,revisionId:row.bundle.revision.id,
      dayId:null,variantId:null,...extra};
  }
  function action(parent,text,row,extra={}) {
    const a=node('a',text,parent); a.href=href(patch(row,extra));
    a.onclick=e=>{
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); navigate(patch(row,extra));
    };
    return a;
  }
  function mark(parent,text,row,extra={}) {
    const b=node('button',text,parent); b.type='button';
    b.dataset.comparisonKey=`${row.route.id}:${text}`;
    b.onclick=()=>navigate(patch(row,extra),{focus:false});
    controls.push({b,row,chapterId:extra.chapterId,
      poiDistance:text==='Select route for exploration' || extra.chapterId ? null : extra.distanceM}); return b;
  }
  function chart(parent,id,label,box) {
    const s=svgNode('svg',{viewBox:box,role:'img','aria-label':label},parent);
    s.classList.add(id); return s;
  }
  function build() {
    const activeKey=document.activeElement?.dataset.comparisonKey;
    const rows=[...records.values()].map(row=>current?.bundle && row.route.id===current.state.routeId ?
      comparisonRow(catalog,row.route.id,current.state.revisionId,current.profile) : row);
    scales=comparisonScales(rows);
    axisLabel.hidden=mode!=='compare'; rotate.hidden=mode!=='radial';
    const effectiveAxis=mode==='compare' ? axis : 'distance';
    scaleText.textContent=scales ?
      `Shared elevation: ${scales.lowM}–${scales.highM} m, identical across all panels. `+
      (effectiveAxis==='progress' ? 'Horizontal: normalized progress 0–100% on each route, NOT equal road distance. ' :
        `Horizontal: equal distance 0–${km(scales.distanceM)} km; shorter routes end earlier. `)+
      'Scales include all available routes, even hidden candidates. '+
      (mode==='radial' ? `Radial: clockwise angle = normalized progress 0–100%, NOT geography or equal kilometres. Radius = shared derived elevation. Rotation ${rotation}°; no motion/inertia. Start and finish share an angle. Linear profile below uses equal distance. ` : '') :
      'Shared scales unavailable: no validated profiles.';
    deltaText.replaceChildren();
    for (const day of catalog.data.days) {
      const candidates=rows.filter(r=>chosen.has(r.route.id) && r.variant?.dayId===day.id);
      if (!candidates.length) continue;
      const standard=candidates.find(r=>r.variant.name==='short');
      const longer=candidates.find(r=>r.variant.name==='long');
      const delta=variantDelta(standard,longer);
      node('p',`${day.name} · Long minus Short (source S, standard comparison baseline): `+
        (delta ? `${signed(delta.distanceM,km)} km; ${signed(delta.ascentM,n=>String(Math.round(n)))} m derived ascent. Same validated window recipe, unrounded subtraction.` :
          'added distance/climbing unavailable: select both supported Short and Long variants. No inferred difficulty.'),deltaText);
    }
    panels.replaceChildren(); drawings=[]; controls=[];
    panels.className=mode==='compare' ? 'site-grid' : '';
    let count=0;
    for (const row of rows) {
      const input=choiceControls.get(row.route.id);
      input.checked=chosen.has(row.route.id);
      if (!input.checked) continue;
      count++;
      const card=node('article','',panels); card.className='site-card comparison-route'; card.dataset.route=row.route.id;
      node('h3',row.route.name,card);
      if (row.status!=='supported') { node('p',row.reason,card); continue; }
      const a=row.analysis;
      card.dataset.revision=row.bundle.revision.id;
      node('p',`${row.bundle.revision.status} · ${row.bundle.revision.id}. ${row.bundle.revision.provenance.source}; observed ${row.bundle.revision.provenance.observedOn}. Provider revision date unknown.`,card);
      const heights=profileSamples(a).map(p=>p.elevationM);
      node('p',`${km(row.distanceM)} km horizontal distance · ${Math.round(row.ascentM)} m derived ascent · `+
        `${Math.round(a.processedTotals.descentM)} m derived descent · elevation ${Math.round(Math.min(...heights))}–${Math.round(Math.max(...heights))} m (250 m windows).`,card);
      node('p',`Raw point ascent: ${Math.round(a.rawTotals.ascentM)} m. Source-listed: ${a.sourceTotals?.listed ?
        `${km(a.sourceTotals.listed.distanceM)} km / ${a.sourceTotals.listed.gainM} m gain` : 'unavailable'}. These are distinct bases, not interchangeable totals.`,card);
      mark(card,'Select route for exploration',row,{chapterId:null,distanceM:0});
      const open=action(card,'Open revision-pinned route briefing',row,{view:'briefing'});
      open.className='comparison-open';
      const details=node('details','',card);
      details.open=matchMedia('(max-width:600px)').matches;
      node('summary','Linear / text alternative: all sections, elevations and sourced POIs',details);
      const sections=node('ol','',details);
      for (const [i,c] of a.chapters.entries()) {
        const li=node('li','',sections);
        mark(li,`${i+1}. ${c.kind} · ${km(c.startM)}–${km(c.endM)} km`,row,{chapterId:c.id,distanceM:c.startM});
        node('p',sectionSummary(a,c),li);
      }
      node('h4','Sourced POIs in riding order',details);
      if (!a.annotations.pois.length)
        node('p','No verified POIs. Water, stops and facilities are unknown, not absent or unnecessary.',details);
      for (const p of a.annotations.pois) {
        mark(details,`${p.text} · ${km(p.distanceM)} km · ${p.source.name}, ${p.source.observedOn}, ${p.confidence}`,row,
          {chapterId:null,distanceM:p.distanceM});
      }
      const samples=node('details','',details); node('summary','Every plotted profile sample (metres)',samples);
      const table=node('table','',samples);
      node('caption','Derived window endpoints in riding order; straight lines join these samples in every view.',table);
      const tr=node('tr','',node('thead','',table));
      for (const text of ['Distance (m)','Elevation (m)']) { const th=node('th',text,tr); th.scope='col'; }
      const tbody=node('tbody','',table);
      for (const p of profileSamples(a)) {
        const tr=node('tr','',tbody); node('td',p.distanceM.toFixed(1),tr); node('td',p.elevationM.toFixed(1),tr);
      }
      // Linear alternative stays visible even in Radial. Charts are not focus
      // traps: section/POI buttons above provide every interaction by keyboard.
      node('p',`Linear profile · ${effectiveAxis==='progress' ? '0–100% normalized progress (not kilometres)' :
        `0–${km(scales.distanceM)} km equal distance`} · elevation ${scales.lowM}–${scales.highM} m.`,card);
      const profile=chart(card,'comparison-profile','Shared-scale linear elevation profile. All samples and sections are in the text alternative.','0 0 600 180');
      const xy=p=>{const [x,y]=profilePoint(p,row,scales,effectiveAxis); return [10+580*x,165-150*y];};
      path([[10,15],[10,165],[590,165]],profile,'#9fab96');
      path(profileSamples(a).map(xy),profile);
      const cursor=svgNode('line',{y1:10,y2:170,stroke:'#8a3c22','stroke-width':3},profile);
      let radial, dot, project, map, mapDot;
      if (mode==='radial') {
        node('p','Rotate with the buttons above or drag the wheel and release. Spaced numbered marks select sections; crowded labels are omitted, not chapters. The text list includes every section and sourced POI. Round marks are POIs. No inertia.',card);
        radial=chart(card,'comparison-radial','Radial abstract elevation and progress, clockwise. Same samples, sections and POIs as the linear alternative.','0 0 400 400');
        let drag;
        const angle=e=>{const r=radial.getBoundingClientRect();return Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2)*180/Math.PI;};
        radial.onpointerdown=e=>{
          if (e.button || ['text','circle'].includes(e.target.tagName)) return;
          drag={angle:angle(e),x:e.clientX,y:e.clientY}; radial.setPointerCapture(e.pointerId);
        };
        radial.onpointerup=e=>{
          if (drag && Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5) {
            rotation=Math.round((rotation+angle(e)-drag.angle+360)%360); build();
          }
          drag=null;
        };
        radial.onpointercancel=()=>{drag=null;};
        for (const r of [45,155]) svgNode('circle',{cx:200,cy:200,r,fill:'none',stroke:'#9fab96'},radial);
        const rp=(d,h)=>radialPoint(d,h,row,scales,rotation);
        path(profileSamples(a).map(p=>rp(p.distanceM,p.elevationM)),radial);
        const placed=[];
        for (const [i,c] of a.chapters.entries()) {
          const [x,y]=rp(c.startM,positionAt(a,c.startM).processedElevationM);
          if (placed.some(p=>Math.hypot(p[0]-x,p[1]-y)<32)) continue;
          placed.push([x,y]);
          const marker=svgNode('text',{x,y,fill:'#163c34','font-size':16,'data-chapter':c.id},radial); marker.textContent=String(i+1);
          marker.onclick=()=>navigate(patch(row,{chapterId:c.id,distanceM:c.startM}),{focus:false});
        }
        for (const p of a.annotations.pois) {
          const [cx,cy]=rp(p.distanceM,positionAt(a,p.distanceM).processedElevationM);
          const marker=svgNode('circle',{cx,cy,r:5,fill:'#8a3c22'},radial);
          marker.onclick=()=>navigate(patch(row,{chapterId:null,distanceM:p.distanceM}),{focus:false});
        }
        const [x,y]=rp(0,scales.highM);
        const label=svgNode('text',{x,y,'font-size':12,'pointer-events':'none'},radial); label.textContent='S/F · 0/100%';
        dot=svgNode('circle',{r:6,fill:'#8a3c22',stroke:'white','pointer-events':'none'},radial);
      }
      if (mode==='compare') {
        const start=a.points[0], finish=a.points.at(-1);
        node('p','North-up outline, individually fitted (NOT a common map scale). Do not compare footprint size; use equal-distance profiles and metrics. '+
          `Start S (${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}) → finish F (${finish.lat.toFixed(5)}, ${finish.lon.toFixed(5)}) follows exported order; not navigation.`,card);
        map=chart(card,'comparison-outline','Individually fitted north-up route outline; start and finish may overlap.','0 0 400 400');
        project=outlineProjection(a.points);
        path(a.points.filter((p,i)=>i%Math.max(1,Math.ceil(a.points.length/2500))===0 || i===a.points.length-1).map(project),map);
        for (const [p,text,dy] of [[a.points[0],'S',-8],[a.points.at(-1),'F',14]]) {
          const [x,y]=project(p), label=svgNode('text',{x,y:y+dy},map); label.textContent=text;
        }
        mapDot=svgNode('circle',{r:6,fill:'#8a3c22',stroke:'white'},map);
      }
      drawings.push({row,card,profile,cursor,xy,radial,dot,map,mapDot,project,open});
    }
    if (!count) node('p','No comparison candidates selected. Choose routes above; the active exploration is unchanged.',panels);
    reflect(routePlayback.getSnapshot());
    if (activeKey) controls.find(c=>c.b.dataset.comparisonKey===activeKey)?.b.focus();
  }
  function reflect(snapshot) {
    if (!current) return;
    const s=current.state;
    const matching=snapshot.identity?.routeId===s.routeId && snapshot.identity?.revisionId===s.revisionId && snapshot.position;
    const chapter=matching ? snapshot.chapterId : s.chapterId;
    const distance=matching ? snapshot.distanceM : s.distanceM;
    // A containing chapter is not an explicit chapter seek. Preserve exact POI
    // and scrub positions; chapter URL precedence would otherwise snap to start.
    const linkChapter=s.chapterId && distance===s.distanceM ? s.chapterId : null;
    selection.textContent=`Active exploration: ${current.bundle?.route.name ?? 'unavailable route'} · ${chapter ?? 'no section'} · ${km(distance)} km. `+
      (chosen.has(s.routeId) ? '' : 'Active route is not among the visible comparison candidates.');
    for (const d of drawings) {
      const selected=d.row.route.id===s.routeId && d.row.bundle.revision.id===s.revisionId;
      d.card.dataset.selected=String(selected);
      d.card.dataset.chapter=selected ? chapter ?? '' : '';
      for (const el of [d.cursor,d.dot,d.mapDot]) if (el) el.hidden=!selected || !matching;
      // SVG uses visibility (the HTML hidden property is not supported there).
      for (const el of [d.cursor,d.dot,d.mapDot]) if (el) el.setAttribute('visibility',selected && matching ? 'visible' : 'hidden');
      if (selected && matching) {
        for (const el of [d.profile,d.radial,d.map].filter(Boolean)) {
          el.dataset.distance=String(distance); el.dataset.chapter=chapter ?? '';
        }
        const [x]=d.xy({distanceM:distance,elevationM:snapshot.position.processedElevationM});
        d.cursor.setAttribute('x1',x); d.cursor.setAttribute('x2',x);
        for (const [dot,xy] of [[d.dot,d.dot && radialPoint(distance,snapshot.position.processedElevationM,d.row,scales,rotation)],
          [d.mapDot,d.mapDot && d.project(snapshot.position)]]) if (dot) {
          dot.setAttribute('cx',xy[0]); dot.setAttribute('cy',xy[1]);
        }
      }
      // The public grammar rounds metres to millimetres. Keep finish links
      // inside the exact endpoint, as the shared briefing does for seeking.
      const linkDistance=selected ? Math.min(distance,Math.floor(d.row.distanceM*1000)/1000) : 0;
      d.open.href=href(patch(d.row,{view:'briefing',chapterId:selected ? linkChapter : null,distanceM:linkDistance}));
      // Link handler also uses the current shared occurrence, not build-time state.
      d.open.onclick=e=>{
        if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); navigate(patch(d.row,{view:'briefing',chapterId:selected ? linkChapter : null,distanceM:linkDistance}));
      };
    }
    for (const {b,row,chapterId,poiDistance} of controls) {
      const active=row.route.id===s.routeId && row.bundle.revision.id===s.revisionId &&
        (!chapterId || chapterId===chapter) && (poiDistance===null || Math.abs(poiDistance-distance)<.001);
      if (active) b.setAttribute('aria-current','location'); else b.removeAttribute('aria-current');
    }
  }
  subscribePlayback(s=>{if (!root.hidden) reflect(s);});
  const ready=Promise.all(catalog.data.routes.map(async route=>{
    let analysis;
    try { analysis=await analysisFor(route.id,route.currentRevisionId); }
    catch { /* Named unavailable row, never cached/example substitution. */ }
    records.set(route.id,comparisonRow(catalog,route.id,route.currentRevisionId,analysis));
  })).then(()=>{root.dataset.ready='true'; if (current) build();});
  return {root,ready,show(resolved) {
    current=resolved;
    const visible=['plan','explore'].includes(current.state.area) &&
      (current.state.area==='plan' || comparisonViews.includes(current.state.view));
    root.hidden=!visible;
    if (!visible) return;
    const nextMode=comparisonViews.includes(current.state.view) ? current.state.view : 'compare';
    let rebuild=nextMode!==mode; mode=nextMode;
    if (!initialized) {
      const day=current.state.dayId;
      for (const route of catalog.data.routes) {
        if (!day || catalog.data.variants.find(v=>v.id===route.variantId)?.dayId===day) chosen.add(route.id);
      }
      initialized=true; rebuild=true;
    }
    if (lastRoute!==current.state.routeId) {
      if (choiceControls.has(current.state.routeId)) chosen.add(current.state.routeId);
      lastRoute=current.state.routeId; rebuild=true;
    }
    // Display the active pinned revision, never current geometry beneath an old
    // URL. Other candidates use their explicitly labeled current revisions.
    if (lastRevision!==current.state.revisionId || lastProfile!==current.profile) {
      lastRevision=current.state.revisionId; lastProfile=current.profile; rebuild=true;
    }
    for (const a of tabLinks) {
      a.href=href({area:'explore',view:a.dataset.view});
      if (a.dataset.view===mode) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    }
    if (rebuild || !panels.childElementCount) build();
    else reflect(routePlayback.getSnapshot());
  }};
}
