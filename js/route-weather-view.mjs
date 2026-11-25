import { createWeatherClient, weatherEvidence } from './route-weather.mjs';

const node=(tag,text,parent,id)=>{
  const e=document.createElement(tag);e.textContent=text;parent.append(e);if(id)e.id=id;return e;
};
export function installRouteWeather(parent) {
  const root=node('section','',parent,'route-weather');
  node('h2','Optional public start-area weather',root);
  node('p','Only press the button if you want a direct MET Norway request when event dates are in range. MET receives your IP, request time and the selected approved public start coordinates, and logs them in Oslo, Norway. No rider values, private files, live position or local route geometry are sent. No background requests; the button does not enable future automatic fetching.',root);
  const button=node('button','Check weather / request public forecast',root,'weather-check');button.type='button';
  const clear=node('button','Clear weather snapshot',root,'weather-clear');clear.type='button';
  const output=node('div','',root,'weather-status');output.setAttribute('role','status');output.setAttribute('aria-live','polite');
  const client=createWeatherClient();
  let context={},identity='',generation=0,freshnessTimer;
  const localTime=s=>`${new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',dateStyle:'medium',timeStyle:'short'}).format(new Date(s))} Europe/Rome (${s})`;
  function draw(a=client.view({...context,online:navigator.onLine!==false})) {
    clearTimeout(freshnessTimer);
    output.replaceChildren();
    node('p',`${a.offline?'Offline · ':''}${a.state==='forecast'?'Forecast':a.state==='stale'?'Stale forecast':'Unavailable'} — ${a.reason}`,output);
    if(a.offline && !a.retrievedAt)node('p','No saved weather snapshot in this document.',output);
    if(a.route)node('p',`Selected public route: ${a.route}. D1–D4 labels are not calendar assignments.`,output);
    node('p',`Listed event dates: ${a.startDate??'pending'} – ${a.endDate??'pending'}. Timezone: ${a.timezone??'pending'}.`,output);
    node('p',a.point?`Public start area: ${a.location} · ${a.point.latitude}, ${a.point.longitude} (truncated to four decimals). Source GPX elevation ${a.point.sourceElevation} m, not field-verified. Provider/model elevation: ${a.providerElevation??'unknown'} m. Source elevation accuracy is unknown; no altitude override is sent. Not route-wide or summit weather: valley conditions cannot establish summit conditions.`:
      'Weather location unavailable. No location derived from private geometry.',output);
    const source=node('p','Event date/location source: ',output),link=node('a',a.eventSource.name,source);link.href=a.eventSource.url;
    node('span',` · observed ${a.eventSource.observedOn}. Europe/Rome is the geographic civil timezone, not a departure time.`,source);
    node('p',`Local availability check: ${a.checkedAt??'clock unavailable'}${a.today?` · ${a.today} in ${a.timezone}`:''}.`,output);
    node('p',`Forecast source: ${a.source??'MET Norway (not loaded)'}. Received by this tab: ${a.retrievedAt??'none'}. Provider updated: ${a.updatedAt??'none'}. Expires: ${a.expiresAt??'unknown / none'}.`,output);
    node('p',`Response valid instants (UTC): ${a.validFrom??'none'} – ${a.validTo??'none'}. Next request no earlier than: ${a.retryAt??'not yet requested'}.`,output);
    if(a.deprecated)node('p','Provider API deprecated (203): operator update required.',output);
    const list=node('ul','',output);
    for(const day of a.days) {
      const li=node('li',`${day.date} · ${day.state} — ${day.reason}`,list);
      if(!day.samples.length)continue;
      const details=node('details','',li);
      node('summary',`${day.samples.length} timestamped ${day.state==='stale'?'stale ':''}forecast samples (partial coverage)`,details);
      const values=node('ul','',details);
      for(const s of day.samples)node('li',
        `${localTime(s.time)}: temperature ${s.temperature===null?'unavailable':`${s.temperature} °C`}; wind ${s.wind===null?'unavailable':`${s.wind} m/s`}; `+
        (s.rain===null?'precipitation unavailable.':`forecast precipitation ${s.rain} mm from this instant until ${localTime(s.rainUntil)}.`),values);
    }
    node('p','These are forecasts, never observations or historical climate context. No historical climate service is loaded; past averages are not forecasts. Sample ranges are not daily minima/maxima or guarantees of full-day coverage.',output);
    // Local label expiry only, NEVER a transport trigger. Also recheck after a
    // suspended tab resumes. No looping background poll or focus-stealing fetch.
    if(a.retrievedAt) {
      const now=Date.now(),times=[Date.parse(a.expiresAt),Date.parse(a.updatedAt)+6*3600000,
        Date.parse(a.retrievedAt)+24*3600000+1].filter(t=>Number.isFinite(t) && t>now);
      if(times.length)freshnessTimer=setTimeout(()=>draw(),Math.min(...times)-now+1);
    }
  }
  button.onclick=async()=>{
    const token=++generation;
    const focused=document.activeElement===button;
    draw();
    button.disabled=true;
    node('p','Checking optional weather…',output);
    const value=await client.request({...context,online:navigator.onLine!==false});
    if(token!==generation)return;
    button.disabled=false;draw(value);
    if(focused && [button,document.body].includes(document.activeElement))button.focus();
  };
  function forget() {generation++;client.forget();button.disabled=false;draw();}
  clear.onclick=forget;
  for(const name of ['online','offline'])window.addEventListener(name,()=>draw());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)draw();});
  const attribution=node('p','Weather data: MET Norway, ',root);
  const license=node('a','CC BY 4.0',attribution);license.href=weatherEvidence.licenseURL;
  node('span',' · Changes: selected variables and event-date samples, formatted in Europe/Rome; no meteorological model correction. No MET endorsement or SLA.',attribution);
  const evidence=node('p',`Provider documentation verified ${weatherEvidence.checkedOn}: `,root);
  for(const [text,url] of [['terms',weatherEvidence.termsURL],['forecast format',weatherEvidence.forecastURL],
    ['update limits',weatherEvidence.faqURL],['KOTR27 technical contact / issue tracker',weatherEvidence.contactURL]]) {
    const a=node('a',text,evidence);a.href=url;node('span',' · ',evidence);
  }
  node('p','Provider forecasts extend up to ten days; this app conservatively requests only for today plus nine calendar dates, with returned timestamps authoritative. Tab-memory snapshots only, at most three locations / 24 hours (expiry checked when open); not an offline pack. Identical requests wait at least three hours and until Expires in this document. One request in flight, ten-second timeout, no background retries. Rate-limit/access denial stops requests for this document. Ordinary browser HTTP caching may remain after Clear/Forget; clear site data in browser settings to remove it. No account, key or proxy. Weather is not a go/no-go safety guarantee; confirm conditions and organizer instructions before riding.',root);
  node('p','A new document first reuses any browser-cached response, even if stale, to avoid repeating another document’s request. A stale first result may need a three-hour wait before an explicit refresh here. Reloading is not a refresh or cooldown bypass; browser cache eviction is outside this app’s control.',root);
  return {forget,show(selection,event) {
    const local=selection.code==='local' || selection.bundle?.route.kind==='local' || selection.state.routeId?.startsWith('user:');
    const key=`${selection.state.routeId}|${selection.state.revisionId}`;
    if(key!==identity){generation++;client.cancel();button.disabled=false;identity=key;}
    context={event,local,bundle:local?null:selection.bundle};
    draw();
  }};
}
