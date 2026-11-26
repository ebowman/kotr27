import { cameraJobs, cameraPose, createRideCamera, officialFlyover, flyoverLimits } from './route-flyover.mjs';
import { routePlayback as controller, subscribePlayback } from './route-session.mjs';

const node=(tag,text,parent,id)=>{
  const e=document.createElement(tag); e.textContent=text; parent.append(e);
  if (id) e.id=id; return e;
};
export function installRouteFlyover(parent,onSeek) {
  const root=node('section','',parent,'route-flyover'); root.hidden=true;
  root.setAttribute('aria-label','Optional route flyover');
  let analysis,visible=false,renderer,abort,deadline,epoch=0,manual=false,priorMode;
  let refinements={},lastSnapshot,draw=()=>{};
  function stop() {
    epoch++; clearTimeout(deadline); abort?.abort(); abort=null;
    renderer?.dispose(); renderer=null;
  }
  function act(command,...args) {
    const s=controller[command](...args); onSeek(s,null); return s;
  }
  function build(resolved) {
    root.replaceChildren(); refinements={}; manual=false;
    const camera=createRideCamera();
    let reframe=false;
    // Selecting a camera is an explicit framing command even when its enum
    // value is unchanged. Carry that intent through the single snapshot draw.
    function cameraAction(command,...args) {
      reframe=true;
      return act(command,...args);
    }
    node('h2',`${resolved.bundle.route.name} · Optional 3D`,root);
    node('p',`${resolved.bundle.revision.id} · Source geometry and derived profile are unchanged. `+
      'Satellite terrain is independent provider elevation, not verified road height. Orange route; white-ring rider; S start → F finish. No navigation or recorded ride is implied.',root);
    node('p','Before enabling: Mapbox receives your IP address and this official route’s viewed region, and supplies online satellite imagery, elevation and its map library. '+
      'Nothing loads from Mapbox until you enable. No offline coverage is promised. Local/private tracks never use this view.',root,'flyover-disclosure');
    const enable=node('button','Enable online 3D',root,'flyover-enable');
    const off=node('button','Use linked 2D / profile',root,'flyover-off');
    const status=node('p','3D is off. The linked 2D route and profile below remain available.',root,'flyover-status');
    status.setAttribute('role','status');
    const fallback=node('a','Go to linked route controls and profile',root,'flyover-fallback');
    fallback.href='#route-briefing';
    fallback.onclick=e=>{
      e.preventDefault();
      document.getElementById('briefing-seek')?.focus();
      document.getElementById('route-briefing')?.scrollIntoView();
    };
    const deck=node('div','',root); deck.className='site-actions';
    const buttons=[];
    for (const [mode,label,help] of cameraJobs) {
      const b=node('button',label,deck,`flyover-${mode}`); b.title=help;
      b.onclick=()=>cameraAction('setCameraMode',mode);
      buttons.push([b,mode]); node('p',`${label}: ${help}`,root);
    }
    const controls=node('div','',root); controls.className='site-actions';
    const play=node('button','Play animation',controls,'flyover-play');
    play.onclick=()=>act(controller.getSnapshot().phase==='playing' ? 'pause' : 'play',{preserveCamera:true});
    const reset=node('button','Reset to route start',controls,'flyover-reset');
    reset.onclick=()=>{
      refinements={};
      root.querySelector('#flyover-pitch').value=45;
      cameraAction('restart');
    };
    const follow=node('button','Return to rider',controls,'flyover-return');
    follow.onclick=()=>cameraAction('setCameraMode','follow');
    const nearer=node('button','Zoom nearer',controls,'flyover-nearer');
    const farther=node('button','Zoom farther',controls,'flyover-farther');
    nearer.onclick=()=>renderer?.setZoom(camera.zoom+.5);
    farther.onclick=()=>renderer?.setZoom(camera.zoom-.5);
    function cameraControls(available=!!renderer) {
      nearer.disabled=!available || camera.zoom>=flyoverLimits.maxZoom;
      farther.disabled=!available || camera.zoom<=flyoverLimits.minZoom;
      const zoom=root.querySelector('#flyover-zoom');
      if (zoom) {zoom.value=camera.zoom;zoom.disabled=!available;}
    }
    cameraControls(false);
    const full=node('button','Fullscreen',controls,'flyover-fullscreen');
    full.onclick=async()=>{
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (root.requestFullscreen) await root.requestFullscreen();
        else throw Error();
        renderer?.resize();
      } catch { status.textContent='Fullscreen unavailable in this browser. All controls remain available here.'; }
    };
    const label=node('label','Animation speed (not rider speed)',root);
    const rate=node('select','',label,'flyover-rate');
    for (const value of [.5,1,2,4]) rate.add(new Option(`${value}×`,value));
    rate.onchange=()=>act('setAnimationRate',Number(rate.value));
    const seekLabel=node('label','Route distance (metres)',root);
    const seek=node('input','',seekLabel,'flyover-seek');
    seek.type='range'; seek.min=0;seek.max=analysis.distanceM;seek.step='any';
    seek.oninput=()=>act('seekDistance',Number(seek.value));
    seek.onkeydown=e=>{
      const delta={ArrowLeft:-100,ArrowDown:-100,ArrowRight:100,ArrowUp:100}[e.key];
      if (delta || ['Home','End'].includes(e.key)) {
        e.preventDefault();act('seekDistance',e.key==='Home' ? 0 : e.key==='End' ? analysis.distanceM : controller.getSnapshot().distanceM+delta);
      }
    };
    const hud=node('p','',root,'flyover-position');
    const orientation=node('p','',root,'flyover-orientation');
    const help=node('details','',root);
    node('summary','Shortcuts and optional camera refinements',help);
    node('p','Within this panel, outside inputs: 1 Follow, 2 Overview, 3 Side, 4 Cinematic; Space play/pause; R reset; F fullscreen; Escape Return to rider (or leave fullscreen). '+
      'Wheel, pinch, +/- keys on the map or Zoom nearer/farther change distance without pausing. Drag/rotate pauses for inspection; Return to rider restores tracking. Zoom requires online 3D; closer views magnify the same terrain detail. Distance survives pause, seek and Return; a new route resets it. Seeks and camera-mode changes pause; camera changes never seek. Reduced motion never autoplays. If the rider leaves the frame or terrain blocks it, the view falls back to linked 2D/profile.',help);
    for (const [key,text,min,max,value] of [['pitch','Pitch (degrees)',20,55,45],['zoom','Zoom',flyoverLimits.minZoom,flyoverLimits.maxZoom,12.6]]) {
      const l=node('label',text,help), input=node('input','',l,`flyover-${key}`);
      input.type='range';input.min=min;input.max=max;input.step=.1;input.value=value;
      if (key==='zoom') {
        input.disabled=true;input.oninput=()=>renderer?.setZoom(Number(input.value));
      } else input.oninput=()=>{refinements[key]=Number(input.value);cameraAction('manipulate');};
    }
    const side=node('button','Swap side',help,'flyover-swap-side');
    side.onclick=()=>{refinements.side=refinements.side===-1 ? 1 : -1;cameraAction('setCameraMode','side');};
    const viewport=node('div','',root,'flyover-viewport');
    const map=node('div','',viewport,'official-terrain'); map.style.visibility='hidden';
    map.setAttribute('aria-label','Optional satellite terrain. Linked 2D and profile are the accessible equivalent.');
    function state(name,message) {
      root.dataset.status=name;
      status.textContent=message+(name==='unavailable' ? ' Linked 2D/profile remains available. No automatic retry; enable again only if wanted.' : '');
      if (name==='unavailable') {
        stop();viewport.hidden=true;enable.disabled=false;controller.enable3D(false);
        cameraControls(false);
      } else if (name==='ready') {
        cameraControls(true);
        clearTimeout(deadline);
        const s=controller.getSnapshot();
        if (s.renderer.status!=='ready') controller.setRendererStatus(s.renderer.requestId,'ready');
      }
    }
    off.onclick=()=>{
      stop();controller.enable3D(false);viewport.hidden=true;enable.disabled=false;
      cameraControls(false);
      state('standby','3D is off. Use the linked 2D route and profile below.');
    };
    viewport.hidden=true; root.dataset.status='standby';
    enable.onclick=async()=>{
      if (!visible || !analysis || !officialFlyover(resolved)) return;
      stop();const token=epoch;abort=new AbortController();
      enable.disabled=true;viewport.hidden=false;map.style.visibility='hidden';manual=false;
      state('loading','Loading online 3D. The linked 2D/profile remains usable.');
      controller.enable3D(true);
      deadline=setTimeout(()=>state('unavailable','3D did not become ready within 12 seconds.'),flyoverLimits.loadMs);
      try {
        const {mountRouteTerrain}=await import('./route-terrain-view.mjs');
        if(token!==epoch)return;
        const result=await mountRouteTerrain({container:map,analysis,snapshot:controller.getSnapshot(),signal:abort.signal,
          camera,onCamera:()=>cameraControls(),
          onStatus:(name,message)=>{if(token===epoch)state(name,message);},
          onManual:()=>{manual=true;act('manipulate');status.textContent='Manual exploration · animation paused. Return to rider restores tracking.';}});
        if(token!==epoch)result?.dispose();else renderer=result;
      } catch { if(token===epoch)state('unavailable','3D library unavailable.'); }
    };
    draw=s=>{
      if (!s.position || s.identity?.revisionId!==analysis.identity.revisionId) return;
      const force=reframe || priorMode!==s.cameraMode || lastSnapshot?.distanceM!==s.distanceM && s.phase!=='playing';
      reframe=false;
      if (force) {
        // The renderer leaves manual mode on this same forced update. Keep
        // labels and interim status in agreement, including seeks/refinements.
        manual=false;
        if (renderer) status.textContent='Preparing selected camera…';
      }
      root.dataset.distance=String(s.distanceM);
      hud.textContent=`${(s.distanceM/1000).toFixed(2)} km selected · ${((analysis.distanceM-s.distanceM)/1000).toFixed(2)} km remaining. `+
        (s.estimatedRide.status==='available' ? `Estimated ride ${(s.estimatedRide.elapsedSeconds/60).toFixed(1)} min elapsed; not animation or recorded time.` :
          'Estimated ride unavailable: profile/model domain or rider inputs unsupported; source extremes are not clamped.');
      const pose=cameraPose(analysis,s,refinements);
      orientation.textContent=manual ? 'Manual exploration · compass shows north. Return to rider restores the selected location.' :
        `${cameraJobs.find(j=>j[0]===s.cameraMode)[1]} · ${s.cameraMode==='follow' ? 'route-context target (camera turns gradually)' : 'view bearing'} ${((pose.bearing%360+360)%360).toFixed(0)}° clockwise from north. Start → finish in source riding order.`;
      seek.value=s.distanceM;seek.setAttribute('aria-valuetext',hud.textContent);rate.value=s.animationRate;
      play.textContent=s.phase==='playing' ? 'Pause animation' : 'Play animation';
      for (const [b,mode] of buttons) b.setAttribute('aria-pressed',String(!manual && s.cameraMode===mode));
      // Paused commands (including rapid seeks) paint immediately. Playing is
      // rate-limited in the adapter; there is no independent position integrator.
      renderer?.update(s,force,refinements);priorMode=s.cameraMode;lastSnapshot=s;
    };
    root.onkeydown=e=>{
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.target.tagName==='BUTTON' && [' ','Enter'].includes(e.key) ||
          e.altKey || e.ctrlKey || e.metaKey || e.key==='Escape' && document.fullscreenElement) return;
      const keys={'1':'follow','2':'overview','3':'side','4':'cinematic',' ':'play',r:'reset',f:'fullscreen',Escape:'return'};
      const id=keys[e.key];if(!id)return;
      e.preventDefault();root.querySelector(`#flyover-${id}`)?.click();
    };
    root.tabIndex=0;
  }
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden && abort) {
      root.querySelector('#flyover-off')?.click();
      root.querySelector('#flyover-status').textContent='3D stopped while hidden to bound background work. Enable explicitly to resume; route position is preserved.';
    }
  });
  subscribePlayback(s=>{if(visible)draw(s);});
  return {show(resolved) {
    const eligible=officialFlyover(resolved);
    if (!eligible || analysis?.identity!==resolved.profile.identity) {
      stop();
      if (controller.getSnapshot().renderer.enabled) controller.enable3D(false);
      analysis=eligible ? resolved.profile : null;
      if(eligible)build(resolved);
    }
    visible=eligible;root.hidden=!visible;
    if(visible)draw(controller.getSnapshot());
  }};
}
