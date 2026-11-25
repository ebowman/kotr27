import { eventSources, eventFacts, calendarStatus, pendingBriefing, practiceWeeks, practice,
  packingItems, routeCard } from './event-guide.mjs';
import { routePlayback, subscribePlayback } from './route-session.mjs';

const node = (tag,text,parent,id) => {
  const e=document.createElement(tag); e.textContent=text; parent.append(e);
  if(id)e.id=id;
  return e;
};
export function installEventGuide(parent,{navigate,link}) {
  const root=node('section','',parent,'event-guide');
  const eventRoot=node('section','',root,'event-briefing');
  const prepare=node('section','',root,'preparation-guide');
  const card=node('section','',root,'ride-card');
  const checks=new Set();
  let resolved=null, event=null;
  function drawEvent() {
    eventRoot.replaceChildren();
    const facts=eventFacts(event), calendar=calendarStatus(facts);
    node('h2','Event guide · sourced snapshot, not live instructions',eventRoot);
    node('p',`${facts.location??'Location pending'} · Organizer: ${facts.organizer??'pending'}.`,eventRoot);
    node('p',`Listed event dates: ${facts.startDate??'pending'} – ${facts.endDate??'pending'}. Timezone: ${facts.timezone??'pending'}.`,eventRoot,'event-dates');
    node('p',`${calendar.text} ${calendar.today ? `Checked for ${calendar.today} in ${facts.timezone}.` : ''} Date-only, not a departure countdown; refresh this check if the page has stayed open.`,eventRoot,'event-countdown');
    const refresh=node('button','Refresh calendar check',eventRoot); refresh.type='button';
    refresh.onclick=()=>{drawEvent();eventRoot.querySelector('button').focus();};
    for (const source of Object.values(eventSources)) {
      const p=node('p','Source: ',eventRoot), a=node('a',source.name,p);
      a.href=source.url; node('span',` · observed ${source.observedOn}.`,p);
    }
    node('p','Europe/Rome is the geographic civil timezone for Italy in IANA tzdb, not an organizer departure-time announcement. Source links may require provider access; no access codes are included.',eventRoot);
    const list=node('dl','',eventRoot);
    for(const [name,text] of pendingBriefing) {node('dt',name,list);node('dd',text,list);}
  }
  function drawPreparation() {
    prepare.replaceChildren();
    const s=resolved.state, week=s.week??1, goal=s.goal??'social', cue=s.cue??'feel';
    const p=practice(week,goal,cue);
    node('h2','Find a practice ride · start anytime',prepare);
    node('p','Four optional ideas, not a calendar prescription, fitness guarantee or compulsory program. Choose familiar terrain appropriate to you; no account, map, meter or FTP test is needed. Weeks do not count down to the event.',prepare);
    for(const [id,title,choices,value] of [
      ['week','Practice week',practiceWeeks.map((w,i)=>[i+1,`${i+1}. ${w.title}`]),week],
      ['goal','Your goal',[['social','Enjoy the ride / social'],['performance','Practise for performance']],goal],
      ['cue','Effort cues',[['feel','Ride by feel'],['power','Use familiar power zones (optional)']],cue],
    ]) {
      const label=node('label',title,prepare), select=node('select','',label,`prepare-${id}`);
      for(const [v,text] of choices)select.add(new Option(text,v));
      select.value=value;
      select.onchange=()=>{
        navigate({[id]:id==='week'?Number(select.value):select.value},{focus:false});
        root.querySelector(`#prepare-${id}`)?.focus();
      };
    }
    const content=node('div','',prepare,'prepare-practice'); content.setAttribute('aria-live','polite');
    node('h3',`Week ${week}: ${p.title}`,content);
    for(const [title,text] of [['Try',p.action],['Cue',p.cue],['Recovery / easier option',p.recovery],
      ['Shorter option',p.shorter],['Missed-week note',p.missed]])node('p',`${title}: ${text}`,content);
    node('p','Selected-section context is a reading aid, not a recommendation to train on that road or match its grade. Choose a familiar local equivalent or skip it.',prepare);
    if(resolved.bundle)link(prepare,'Read selected route / section',{area:'explore',view:'briefing'});
    node('h3','Optional packing checklist · this document only',prepare);
    node('p','Checks stay in tab memory during area changes. Refresh, closing this document or switching documents loses them. Nothing is saved or sent; Remember preferences does not persist this checklist. This is not a complete safety checklist.',prepare);
    for(const [i,text] of packingItems.entries()) {
      const label=node('label','',prepare), input=node('input','',label,`packing-${i}`);
      input.type='checkbox'; input.checked=checks.has(i);
      input.onchange=()=>input.checked?checks.add(i):checks.delete(i);
      node('span',text,label);
    }
    const clear=node('button','Clear packing checks',prepare,'packing-clear'); clear.type='button';
    clear.onclick=()=>{checks.clear();drawPreparation();root.querySelector('#packing-clear').focus();};
  }
  function drawCard(snapshot) {
    card.replaceChildren();
    const data=routeCard(resolved?.bundle,resolved?.profile,snapshot);
    card.dataset.available=String(data.available);
    node('h2','Selected-route printable card',card);
    if(!data.available) {node('p',data.text,card);return;}
    node('h3',data.name,card);
    node('p',`Organizer route · ${data.status} · Revision ${data.revision}`,card);
    node('p',`Source: ${data.source} · As of observation ${data.observedOn}; not a currentness guarantee.`,card);
    for(const text of data.lines)node('p',text,card);
    const actions=node('div','',card); actions.className='site-actions';
    const print=node('button','Print selected route card',actions,'ride-card-print'); print.type='button';
    print.onclick=()=>{routePlayback.pause();drawEvent();drawCard(routePlayback.getSnapshot());window.print();};
    link(actions,'Read / select a route section',{area:'explore',view:'briefing'});
    link(actions,'Verified route downloads in Plan',{area:'plan',view:'briefing'});
    node('p','Print includes this sourced event snapshot and cleared organizer card only, never local files or recordings. Disable browser-added URL headers/footers if unwanted. Saved paper/PDF copies are outside app deletion controls.',card);
  }
  subscribePlayback(s=>{if(resolved && !root.hidden && !card.hidden)drawCard(s);});
  window.addEventListener('beforeprint',()=>{drawEvent();drawCard(routePlayback.getSnapshot());});
  return {root,
    show(selection,selectedEvent) {
      // Do not retain local analyses, recordings or names even in hidden DOM.
      resolved=selection.bundle?.route.kind==='local' ? {...selection,bundle:null,profile:null} : selection;
      event=selectedEvent;
      root.hidden=!['plan','prepare','ride-week'].includes(selection.state.area);
      prepare.hidden=selection.state.area!=='prepare';
      card.hidden=!['prepare','ride-week'].includes(selection.state.area);
      if(selection.state.area==='prepare')root.prepend(prepare);
      else root.prepend(eventRoot);
      drawEvent();drawPreparation();drawCard(routePlayback.getSnapshot());
    },
    forget() {checks.clear();if(resolved)drawPreparation();},
  };
}
