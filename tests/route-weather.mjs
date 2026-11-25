import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { weatherAvailability, createWeatherClient, weatherLimits, parseForecast } from '../js/route-weather.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { forecastFixture } from './route-weather-fixtures.mjs';

const {pack}=await readRoutePack(process.cwd()),event=pack.catalog.events[0],route=pack.catalog.routes[0];
const bundle={route,revision:route.revisions.find(r=>r.id===route.currentRevisionId)};
const context={event,bundle};
const check=(time,extra={})=>weatherAvailability({...context,now:new Date(time),...extra});
const START=Date.parse('2027-05-19T21:00:00Z'),HOUR=3600000;
const response=(now=START,{json=forecastFixture({now:new Date(now).toISOString().replace('.000Z','Z')}),status=200,expiry=now+HOUR}={})=>
  new Response(JSON.stringify(json),{status,headers:expiry?{Expires:new Date(expiry).toUTCString()}:{}});

test('actual dispatch clock and Rome inclusive horizon boundary never request far-future dates',async()=>{
  const a=check('2026-11-25T08:59:05.804Z');
  assert.equal(a.today,'2026-11-25');assert.equal(a.eligible,false);assert.equal(a.days.length,5);
  assert.deepEqual(a.days.map(d=>d.date),['2027-05-20','2027-05-21','2027-05-22','2027-05-23','2027-05-24']);
  assert.ok(a.days.every(d=>/Outside/.test(d.reason)));
  const before=check('2027-05-10T21:59:59Z'),after=check('2027-05-10T22:00:00Z');
  assert.equal(before.eligible,false);assert.equal(after.today,'2027-05-11');
  assert.equal(after.days[0].eligible,true);assert.ok(after.days.slice(1).every(d=>!d.eligible));
  let count=0;const client=createWeatherClient({clock:()=>Date.parse('2026-11-25'),fetcher:()=>count++});
  for(let i=0;i<20;i++)await client.request(context);
  assert.equal(count,0);
});
test('DST, past, absent/withdrawn dates, invalid clock and non-reviewed routes fail closed',async()=>{
  assert.equal(check('2027-03-27T23:30:00Z').today,'2027-03-28');
  assert.equal(check('2027-10-30T22:30:00Z').today,'2027-10-31');
  assert.match(check('2027-05-24T22:00:00Z').days[4].reason,/Past date.*no observations/);
  const cases=[{now:new Date(NaN)},{event:null},{event:{...event,status:'withdrawn'}},{event:{...event,metadata:{}}},
    {local:true},{bundle:null},{bundle:{route:{kind:'local',name:'private-name'}}},
    {bundle:{...bundle,route:{...route,kind:'example'}}},
    {bundle:{...bundle,revision:{...bundle.revision,id:'new-revision'}}},
    {bundle:{...bundle,revision:{...bundle.revision,geometrySha256:'changed'}}},
    {bundle:{...bundle,revision:{...bundle.revision,status:'withdrawn'}}}];
  for(const extra of cases) {
    const a=check('2027-05-20',extra);assert.equal(a.eligible,false);assert.deepEqual(a.days,[]);
    assert.doesNotMatch(JSON.stringify(a),/private-name/);
  }
  let count=0;const client=createWeatherClient({clock:()=>START,fetcher:()=>count++});
  for(const extra of cases.filter(c=>!c.now))await client.request({...context,...extra});
  await client.request({...context,online:false});
  assert.equal(count,0);
});
test('all seven pins match approved public GPX first points; exactly three request locations',async()=>{
  const locations=new Set();
  for(const route of pack.catalog.routes) {
    const revision=route.revisions.find(r=>r.id===route.currentRevisionId);
    const a=check('2027-05-20',{bundle:{route,revision}});
    assert.equal(a.eligible,true);
    const gpx=await readFile(revision.geometry.path,'utf8');
    const [,lat,lon,ele]=gpx.match(/<trkpt lat="([^"]+)" lon="([^"]+)"><ele>([^<]+)/);
    assert.equal(a.point.latitude,Math.trunc(Number(lat)*10000)/10000);
    assert.equal(a.point.longitude,Math.trunc(Number(lon)*10000)/10000);
    assert.equal(a.point.sourceElevation,Number(ele));locations.add(a.point.key);
  }
  assert.equal(locations.size,weatherLimits.cacheEntries);
});
test('explicit simple GET only, no personal request data; missing days/variables and periods are honest',async()=>{
  const calls=[],client=createWeatherClient({clock:()=>START,fetcher:async(...args)=>{calls.push(args);return response();}});
  assert.equal(client.view(context).state,'unavailable');assert.equal(calls.length,0);
  const a=await client.request({...context,ftp:333,filename:'private-sentinel',latitude:1});
  assert.equal(a.state,'forecast');assert.equal(a.providerElevation,110);
  assert.equal(a.source,'MET Norway Locationforecast 2.0');
  assert.equal(a.retrievedAt,new Date(START).toISOString());assert.equal(a.updatedAt,'2027-05-19T21:00:00Z');
  assert.equal(a.days[0].samples.length,3);assert.equal(a.days[1].samples.length,1);
  assert.equal(a.days[2].state,'unavailable');assert.match(a.days[2].reason,/No remaining/);
  assert.equal(a.days[0].samples[0].rain,0);
  assert.equal(a.days[0].samples[0].rainUntil,'2027-05-19T23:00:00.000Z');
  assert.equal(a.days[4].samples[0].rain,null);
  const [url,options]=calls[0];
  assert.equal(url,'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=45.7508&lon=11.7489');
  assert.deepEqual(Object.keys(options).sort(),['cache','credentials','method','mode','referrerPolicy','signal']);
  assert.equal(options.cache,'force-cache');
  assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'origin');
  assert.doesNotMatch(JSON.stringify(calls),/333|private-sentinel|rwgps|2027/);
});
test('Expires and three-hour product rule both bind; expired cache is stale not current or historical',async()=>{
  let now=START,count=0;const modes=[];
  const client=createWeatherClient({clock:()=>now,fetcher:async(url,options)=>{count++;modes.push(options.cache);return response(now);}});
  await client.request(context);now+=HOUR;
  let a=await client.request(context);assert.equal(a.state,'stale');assert.equal(count,1);
  assert.match(a.reason,/cooldown/);assert.equal(a.retryAt,new Date(START+3*HOUR).toISOString());
  now=START+3*HOUR;a=await client.request(context);assert.equal(count,2);assert.equal(a.state,'forecast');
  assert.deepEqual(modes,['force-cache','default']);
  let otherCount=0;now=START;
  const long=createWeatherClient({clock:()=>now,fetcher:async()=>{otherCount++;return response(now,{expiry:START+5*HOUR});}});
  await long.request(context);now+=4*HOUR;
  await long.request(context);assert.equal(otherCount,1);
  assert.equal(long.view(context).retryAt,new Date(START+5*HOUR).toISOString());
});
test('unknown expiry, old issue time and cached offline results remain explicitly stale',async()=>{
  const j=forecastFixture({now:'2027-05-19T12:00:00Z'});
  const client=createWeatherClient({clock:()=>START,fetcher:async()=>response(START,{json:j,expiry:null})});
  const a=await client.request(context);assert.equal(a.state,'stale');assert.equal(a.expiresAt,null);
  const offline=await client.request({...context,online:false});
  assert.equal(offline.state,'stale');assert.equal(offline.offline,true);assert.match(offline.reason,/Offline/);
});
test('provider failures and 429/403 stop with no retries, even after waiting or clearing snapshots',async()=>{
  for(const status of [429,403]) {
    let count=0,now=START;
    const client=createWeatherClient({clock:()=>now,fetcher:async()=>{count++;return response(now,{status});}});
    let a=await client.request(context);assert.equal(a.state,'unavailable');assert.match(a.reason,new RegExp(String(status)));
    assert.match(client.view({...context,local:true}).reason,/private local routes/);
    assert.match(client.view({...context,event:null}).reason,/verified event dates/);
    now+=4*HOUR;client.forget();await client.request(context);assert.equal(count,1);
  }
  let now=START,count=0;
  const client=createWeatherClient({clock:()=>now,fetcher:async()=>{count++;return count===1?response(now):response(now,{status:503});}});
  await client.request(context);now+=3*HOUR;
  const a=await client.request(context);assert.equal(a.state,'stale');assert.match(a.reason,/503/);
  assert.equal(a.retrievedAt,new Date(START).toISOString());assert.equal(count,2);
  await client.request(context);assert.equal(count,2);
});
test('single in-flight request, cancellation and late results cannot install a stale route response',async()=>{
  let resolve,count=0;const client=createWeatherClient({clock:()=>START,fetcher:()=>{count++;return new Promise(r=>resolve=r);}});
  const pending=client.request(context);
  assert.match((await client.request(context)).reason,/in progress/);assert.equal(count,1);
  client.cancel();resolve(response());await pending;
  assert.equal(client.view(context).source,null);
  assert.equal(client.view({...context,local:true}).point,null);
  assert.equal((await client.request(context)).source,null);assert.equal(count,1);
});
test('timeout, rejection, oversized/malformed responses and mismatched identities remain bounded',async()=>{
  for(const fetcher of [()=>new Promise(()=>{}),()=>Promise.reject(Error('network')),
    async()=>new Response('x'.repeat(weatherLimits.bytes+1)),
    async()=>new Response('{bad JSON'),
    async()=>response(START,{json:forecastFixture({latitude:60})})]) {
    const client=createWeatherClient({clock:()=>START,fetcher,timeoutMs:10});
    const a=await client.request(context);assert.equal(a.state,'unavailable');
    assert.match(a.reason,/timed out|network\/CORS/);
  }
});
test('format validation: units, duplicate times, size, missing elevations and deprecation',()=>{
  const point=check('2027-05-20').point;
  const parse=j=>parseForecast(j,point,START,START+HOUR,203);
  let j=forecastFixture();j.properties.meta.units.air_temperature='kelvin';
  let a=parse(j);assert.equal(a.samples[0].temperature,null);assert.equal(a.deprecated,true);
  j=forecastFixture();j.geometry.coordinates.pop();assert.equal(parse(j).elevation,null);
  j=forecastFixture();j.properties.timeseries[1].time=j.properties.timeseries[0].time;assert.throws(()=>parse(j));
  j=forecastFixture();j.properties.timeseries=Array(351).fill(j.properties.timeseries[0]);assert.throws(()=>parse(j));
  j=forecastFixture();j.properties.meta.updated_at='2099-01-01T00:00:00Z';assert.throws(()=>parse(j));
  j=forecastFixture();j.properties.timeseries[0].time='2027-02-30T00:00:00Z';assert.throws(()=>parse(j));
});
test('no cross-location cache, bounded requests, forget preserves cooldown and retention expires',async()=>{
  let now=START,count=0;
  const client=createWeatherClient({clock:()=>now,fetcher:async url=>{
    count++;const u=new URL(url);return response(now,{json:forecastFixture({
      longitude:Number(u.searchParams.get('lon')),latitude:Number(u.searchParams.get('lat'))})});
  }});
  await client.request(context);
  const route=pack.catalog.routes.find(r=>r.name.startsWith('D4S')),other={event,bundle:{route,revision:route.revisions[0]}};
  assert.equal(client.view(other).source,null);
  assert.match((await client.request(other)).reason,/request limit/);
  now+=11000;await client.request(other);assert.equal(count,2);
  assert.equal(client.view(other).source,'MET Norway Locationforecast 2.0');
  client.forget();assert.equal(client.view(other).source,null);
  await client.request(other);assert.equal(count,2);
  now+=25*HOUR;assert.equal(client.view(context).source,null);
});
