import { eventFacts, calendarStatus, eventSources, printableBundle } from './event-guide.mjs';

export const weatherEvidence = Object.freeze({
  checkedOn:'2026-11-25', provider:'MET Norway',
  forecastURL:'https://docs.api.met.no/doc/ForecastJSON.html',
  termsURL:'https://docs.api.met.no/doc/TermsOfService.html',
  faqURL:'https://docs.api.met.no/doc/locationforecast/FAQ.html',
  licenseURL:'https://creativecommons.org/licenses/by/4.0/',
  contactURL:'https://github.com/ebowman/kotr27/issues',
  maximumForecastDays:10,
});
const HOUR=3600000, DAY=24*HOUR;
export const weatherLimits=Object.freeze({repeatMs:3*HOUR, timeoutMs:10000, bytes:262144,
  samples:350, cacheEntries:3, retainMs:DAY, requestsPerHour:3, minimumGapMs:10000});
// First points of the seven approved public GPX revisions, NOT runtime geometry
// extraction. Positive coordinates truncated (not rounded) to four decimals.
// A changed/withdrawn revision cannot inherit these request locations.
const pins=Object.freeze({
  'rwgps-57873019':['34d3d7bbc5683ba77cc17b5c0381b1c5a70a73f5ed17ce410ead468b7dd22751','e8a4c0562b91d5fcebb2c18dee0dabb4623dd4ac6ff29610ef3a733c94ff6f6e',45.7508,11.7489,115.8],
  'rwgps-57873112':['8f41a27bfcfac15a0304cf23549609ddb8760b8f80264fefb08a010204530a83','2f6357a4e53670b054df235a1d0cb364c590515eafadcc9570418cbd68f4abd4',45.7508,11.7489,115.8],
  'rwgps-57873183':['3361fbb7f97fa2ca44c1e24dc8d9e54605a60ae22a17dfef8c220ce11a5e33b0','e727a0f39433a57bd754620692b33d8a5cf6956b15877af8d517fec799b7ffe4',45.7508,11.7489,115.8],
  'rwgps-57874024':['b826857646e116d6b7e189f923c96a32a0a8c91d9bf247935d8d468cc1220c5d','381ce37485c0a2313614752ed2c6c10a92c6f369490208307c1d1708a0aaf653',45.7508,11.7489,115.8],
  'rwgps-57874050':['4d9c0ac2fe378c343d595efd2cd5c27f268cab47ff7ca34df5210cd29684441a','e745fe77485fc496ed9f20711cd4bc6a5d7059369f605d824d2872f018380843',45.7508,11.7487,115.6],
  'rwgps-57874076':['35a93faf0abb8502ac8d2e3174c6c9975d44bf5d410b0b54289f9867e2399687','0b174e376d646ef961876ae699ecb854a7f7d40715f0e074a8b12c25450ea5c3',45.7508,11.7487,115.6],
  'rwgps-57874121':['eaac1b60720ea6a8911127b4ff9d8ea9afa9357c8ba8c3c24b654aa8a9c0f01f','2b6de16bdd4c4f7cece67d24b0998456984bf7a38fadf4c4d454c5609c58d925',45.7509,11.7491,116],
});
const civil=(time,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
export function weatherAvailability({event,bundle,local=false,now=new Date(),online=true}={}) {
  const facts=eventFacts(event), calendar=calendarStatus(facts,now);
  const result={state:'unavailable',checkedAt:Number.isFinite(now.getTime())?now.toISOString():null,
    today:calendar.today??null,timezone:facts.timezone,location:null,point:null,
    startDate:facts.startDate,endDate:facts.endDate,eventSource:eventSources.event,
    days:[],route:null,offline:!online,eligible:false,source:null,retrievedAt:null,validAt:null,
    reason:'Weather unavailable: verified event dates, location or timezone are missing.'};
  if(local || bundle?.route.kind==='local') return {...result,reason:
    'Weather unavailable for private local routes and recordings. No nearest public location is substituted; no coordinates, filenames or rider values are sent.'};
  if(!printableBundle(bundle)) return {...result,reason:
    'Weather unavailable: choose a cleared organizer route. No weather location is inferred for an example, missing or withdrawn route.'};
  if(!facts.location || !calendar.today) return result;
  const p=pins[bundle.route.id], rev=bundle.revision;
  if(!p || rev.id!==`${bundle.route.id}-v-${p[0]}` || rev.geometrySha256!==p[1])
    return {...result,reason:'Weather unavailable: this route revision has no reviewed public weather location.'};
  result.route=bundle.route.name;
  result.location=facts.location;
  result.point={latitude:p[2],longitude:p[3],sourceElevation:p[4],key:`${p[2]},${p[3]}`};
  const start=Date.parse(facts.startDate),end=Date.parse(facts.endDate);
  if((end-start)/DAY>30) return {...result,point:null,reason:'Weather unavailable: event date range needs review.'};
  for(let date=start;date<=end;date+=DAY) {
    // Conservative civil-date gate: today + nine dates. A rolling ten-day
    // provider horizon can overlap part of an eleventh civil date; do not
    // promise that edge day or imply the provider guarantees this whole window.
    const offset=(date-Date.parse(calendar.today))/DAY, eligible=offset>=0 && offset<weatherEvidence.maximumForecastDays;
    result.days.push({date:new Date(date).toISOString().slice(0,10),state:'unavailable',eligible,samples:[],
      reason:offset<0?'Past date: no observations or historical climate data loaded.':
        !eligible?'Outside this app’s conservative ten-calendar-date request window.':
          'No forecast loaded. Optional request only when you press the button.'});
  }
  result.eligible=result.days.some(d=>d.eligible);
  result.reason=result.eligible?'Optional public start-area forecast is not loaded.':
    'Event dates unavailable in the forecast horizon; no request will be sent.';
  return result;
}
const stamp=s=>{
  if(typeof s!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s))return NaN;
  const time=Date.parse(s);
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z','Z')===s?time:NaN;
};
const number=(v,min,max)=>typeof v==='number' && Number.isFinite(v) && v>=min && v<=max ? v : null;
export function parseForecast(json,point,receivedAt,expires,status=200) {
  const coords=json?.geometry?.coordinates,meta=json?.properties?.meta,series=json?.properties?.timeseries;
  if(json?.type!=='Feature' || json.geometry?.type!=='Point' || !Array.isArray(coords) ||
    Math.abs(coords[0]-point.longitude)>0.00001 || Math.abs(coords[1]-point.latitude)>0.00001 ||
    !Number.isFinite(coords[0]) || !Number.isFinite(coords[1]) ||
    !Number.isFinite(stamp(meta?.updated_at)) || stamp(meta.updated_at)>receivedAt+300000 ||
    !Array.isArray(series) || !series.length || series.length>weatherLimits.samples)
    throw Error('Invalid forecast identity, timestamps or size.');
  let previous=-Infinity;
  const samples=series.map(row=>{
    const time=stamp(row.time);
    if(!Number.isFinite(time) || time<=previous) throw Error('Invalid forecast time order.');
    previous=time;
    const d=row.data?.instant?.details, units=meta.units;
    const temperature=units?.air_temperature==='celsius'?number(d?.air_temperature,-100,70):null;
    const wind=units?.wind_speed==='m/s'?number(d?.wind_speed,0,150):null;
    // Keep periods separate; never sum overlapping 1h/6h/12h amounts.
    const hours=row.data?.next_1_hours?1:row.data?.next_6_hours?6:null;
    const rain=units?.precipitation_amount==='mm' && hours?
      number(row.data[`next_${hours}_hours`]?.details?.precipitation_amount,0,2000):null;
    return {time:row.time,temperature,wind,rain,rainUntil:rain===null?null:new Date(time+hours*HOUR).toISOString()};
  });
  return {samples,updatedAt:meta.updated_at,receivedAt,expires:Number.isFinite(expires)?expires:null,
    elevation:number(coords[2],-500,9000),deprecated:status===203,
    validFrom:samples[0].time,validTo:samples.at(-1).time};
}
async function boundedJSON(response) {
  const reader=response.body?.getReader();
  if(!reader) throw Error('Forecast body unavailable.');
  let bytes=0,text='',decoder=new TextDecoder();
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>weatherLimits.bytes) throw Error('Forecast response exceeds size limit.');
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
}
// Only this controller constructs URLs, from the immutable public allowlist.
// No caller-supplied coordinate, URL, profile, date or name enters the request.
export function createWeatherClient({fetcher=globalThis.fetch,clock=()=>Date.now(),
  timeoutMs=weatherLimits.timeoutMs}={}) {
  const cache=new Map(),next=new Map();
  let pending=null,attempts=[],last=-Infinity,stopped=null,generation=0;
  function view(context,message='') {
    const now=clock(),a=weatherAvailability({...context,now:new Date(now)});
    for(const [key,data] of cache)if(now-data.receivedAt>weatherLimits.retainMs)cache.delete(key);
    const data=a.eligible && a.point?cache.get(a.point.key):null;
    // Privacy/rights/date gates take precedence over an unrelated provider stop.
    if(a.eligible)a.reason=message || stopped || a.reason;
    a.retryAt=a.point && next.has(a.point.key)?new Date(next.get(a.point.key)).toISOString():null;
    if(!data)return a;
    const stale=!data.expires || now>=data.expires || now-stamp(data.updatedAt)>=6*HOUR || now<data.receivedAt;
    a.source='MET Norway Locationforecast 2.0';a.retrievedAt=new Date(data.receivedAt).toISOString();
    a.updatedAt=data.updatedAt;a.expiresAt=data.expires?new Date(data.expires).toISOString():null;
    a.providerElevation=data.elevation;a.validFrom=data.validFrom;a.validTo=data.validTo;a.deprecated=data.deprecated;
    a.days=a.days.map(day=>{
      if(!day.eligible)return day;
      const samples=data.samples.filter(s=>stamp(s.time)>=now && civil(s.time,a.timezone)===day.date &&
        (s.temperature!==null || s.wind!==null || s.rain!==null));
      return {...day,samples,state:samples.length?(stale?'stale':'forecast'):'unavailable',
        reason:samples.length?'Timestamped forecast samples only; not a full-day summary.':'No remaining forecast samples for this date; no day substituted.'};
    });
    a.state=a.days.some(d=>d.samples.length)?(stale?'stale':'forecast'):'unavailable';
    a.reason=message || stopped || (a.state==='unavailable'?'No event-date samples in the response.':
      stale?'Stale forecast — provider expiry passed, age exceeded six hours or freshness unknown.':
        'Forecast, not observations or historical climate. Coverage may be partial.');
    return a;
  }
  function cancel() {generation++;pending?.abort.abort();pending=null;}
  async function request(context) {
    let a=view(context);const now=clock();
    if(!a.eligible || !a.point)return a;
    if(a.offline)return view(context,'Offline: no request sent. Any displayed forecast is a dated memory snapshot.');
    if(stopped)return view(context,stopped);
    if(pending)return view(context,'A weather request is already in progress; no additional request sent.');
    if(now<(next.get(a.point.key)??0))return view(context,'Cached result / request cooldown. No repeat before the displayed next-request time.');
    attempts=attempts.filter(t=>now-t<HOUR);
    if(now-last<weatherLimits.minimumGapMs || attempts.length>=weatherLimits.requestsPerHour)
      return view(context,'Local weather request limit reached. Wait before another explicit request.');
    const key=a.point.key,token=++generation,abort=new AbortController();
    // A new document has no durable request ledger. Prefer even an expired
    // ordinary HTTP-cache entry on its first explicit read instead of repeating
    // a prior document's network request. Later explicit reads can revalidate,
    // but only after this document's three-hour/Expires barrier. Cache eviction
    // is browser-controlled; never claim a distributed/durable quota guarantee.
    const cacheMode=next.has(key)?'default':'force-cache';
    pending={abort};last=now;attempts.push(now);next.set(key,now+weatherLimits.repeatMs);
    let timer;
    try {
      const work=(async()=>{
        const url=`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${a.point.latitude}&lon=${a.point.longitude}`;
        const response=await fetcher(url,{method:'GET',mode:'cors',credentials:'omit',
          referrerPolicy:'origin',cache:cacheMode,signal:abort.signal});
        if(token!==generation)throw Error('Cancelled.');
        const receivedAt=clock(),expires=Date.parse(response.headers.get('expires'));
        if(Number.isFinite(expires))next.set(key,Math.max(next.get(key),expires));
        if(response.status===429 || response.status===403) {
          await response.body?.cancel();
          stopped=response.status===429?'Rate limited (429). Weather requests stopped for this document; operator review required.':
            'Provider access denied (403). Weather requests stopped for this document; operator review required.';
          throw Error(stopped);
        }
        if(![200,203].includes(response.status)) {
          await response.body?.cancel();throw Error(`Provider error (${response.status}).`);
        }
        const data=parseForecast(await boundedJSON(response),a.point,receivedAt,expires,response.status);
        return data;
      })();
      const data=await Promise.race([work,new Promise((_,reject)=>{
        timer=setTimeout(()=>{abort.abort();reject(Error('Weather request timed out.'));},timeoutMs);
      })]);
      if(token!==generation)return view(context,'Weather request cancelled.');
      if(cache.size>=weatherLimits.cacheEntries && !cache.has(key))cache.delete(cache.keys().next().value);
      cache.set(key,data);
      return view(context);
    } catch(error) {
      return view(context,token!==generation?'Weather request cancelled.':
        `${error?.message?.includes('Provider') || error?.message?.includes('Weather request') || stopped ?
          stopped || error.message : 'Weather unavailable: network/CORS or invalid response.'} Core route pages remain usable; no automatic retry.`);
    } finally {clearTimeout(timer);if(token===generation)pending=null;}
  }
  return {view,request,cancel,forget(){cancel();cache.clear();}};
}
