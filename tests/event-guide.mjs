import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eventFacts, calendarStatus, publicValue, practice, practiceWeek, routeCard, printableBundle } from '../js/event-guide.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';
import { createAnalysisPlaybackRoute } from '../js/route-playback-adapters.mjs';
import { createRoutePlayback } from '../js/route-playback.mjs';
import { readSelection, selectionLink } from '../js/route-state.mjs';
import { exampleCatalog } from '../js/example-catalog.mjs';
import { validatePreferenceLink } from '../js/preference-storage.mjs';

const dates={startDate:'2027-05-20',endDate:'2027-05-24',timezone:'Europe/Rome'};
test('calendar uses event civil dates, inclusive end and no invented departure',()=>{
  for(const [instant,phase,days] of [
    ['2027-05-18T22:00:00Z','before',1],
    ['2027-05-19T21:59:59Z','before',1],
    ['2027-05-19T22:00:00Z','during',null],
    ['2027-05-24T21:59:59Z','during',null],
    ['2027-05-24T22:00:00Z','after',null],
  ]) {
    const result=calendarStatus(dates,new Date(instant));
    assert.equal(result.phase,phase);assert.equal(result.days,days);
  }
  // Civil days, not 23/25-hour durations across Italian daylight-saving changes.
  assert.equal(calendarStatus({...dates,startDate:'2027-03-29',endDate:'2027-03-30'},
    new Date('2027-03-27T23:30:00Z')).days,1);
  assert.equal(calendarStatus({...dates,startDate:'2027-11-01',endDate:'2027-11-02'},
    new Date('2027-10-30T22:30:00Z')).days,1);
  for(const bad of [{},{...dates,timezone:null},{...dates,timezone:'Not/AZone'},
    {...dates,startDate:'2027-02-29'},{...dates,endDate:'2027-05-19'}])
    assert.equal(calendarStatus(bad).phase,'pending');
  assert.equal(calendarStatus(dates,new Date(NaN)).phase,'pending');
});
test('absent/unapproved/withdrawn event fields cannot acquire values',async()=>{
  const {pack}=await readRoutePack(process.cwd()),event=pack.catalog.events[0];
  assert.deepEqual(eventFacts(event),{...dates,location:'Bassano del Grappa, Vicenza, Italy',organizer:'Eat Sleep Cycle'});
  for(const e of [null,{...event,status:'withdrawn'},{...event,rights:{access:'participant',redistribution:'approved'}}])
    assert.equal(calendarStatus(eventFacts(e)).phase,'pending');
  assert.equal(publicValue({...event.metadata.startDate,rights:{access:'private',redistribution:'approved'}}),null);
  assert.equal(calendarStatus(eventFacts({...event,metadata:{}})).phase,'pending');
});
test('all 16 independent practice choices, defaults and public revisioned links',()=>{
  const titles=new Set();
  for(let week=1;week<=4;week++)for(const goal of ['social','performance'])for(const cue of ['feel','power']) {
    const p=practice(week,goal,cue);titles.add(p.title);
    for(const field of ['action','cue','recovery','shorter','missed'])assert.ok(p[field].length>20);
    const s=readSelection(`/?area=prepare&week=${week}&goal=${goal}&cue=${cue}`,exampleCatalog).state;
    const next=readSelection(selectionLink(s),exampleCatalog).state;
    assert.deepEqual([next.week,next.goal,next.cue],[week,goal,cue]);
    assert.equal(validatePreferenceLink(selectionLink(s)),true);
    assert.doesNotMatch(selectionLink({...s,ftp:333,filename:'secret.fit'}),/333|secret/);
  }
  assert.equal(titles.size,4);
  const invalid=readSelection('/?area=prepare&week=9&goal=private&cue=power&cue=feel',exampleCatalog);
  assert.deepEqual([invalid.state.week,invalid.state.goal,invalid.state.cue],[1,'social','feel']);
  assert.match(invalid.notices.join(' '),/Practice choice unavailable/);
  assert.throws(()=>practice(5));assert.throws(()=>practice(1,'unknown'));
  assert.equal(practiceWeek({kind:'ascent'}),2);assert.equal(practiceWeek({kind:'descent'}),3);
  for(const query of ['week=5','goal=private','cue=watts','week=1&week=2','packing=private'])
    assert.equal(validatePreferenceLink('./index.html?area=prepare&view=briefing&'+query),false);
});
test('all cleared cards use exact shared metrics/controller, reject private and mismatched revisions',async()=>{
  const {pack}=await readRoutePack(process.cwd());
  for(const route of pack.catalog.routes) {
    const revision=route.revisions[0],bundle={route,revision};
    const a=await loadRouteAnalysis({pack,routeId:route.id,revisionId:revision.id,
      readAsset:path=>readFile(new URL('../'+path,import.meta.url))});
    const adapter=createAnalysisPlaybackRoute(a);
    const playback=createRoutePlayback({loadRoute:()=>adapter});
    await playback.selectRoute({routeId:route.id,revisionId:revision.id});
    playback.seekDistance(a.chapters[1]?.startM??100);
    const snapshot=playback.getSnapshot(),card=routeCard(bundle,a,snapshot),text=card.lines.join(' ');
    assert.equal(card.revision,revision.id);
    assert.match(text,new RegExp(`${Math.round(a.processedTotals.ascentM)} m`));
    assert.match(text,new RegExp(`${(snapshot.distanceM/1000).toFixed(1)} km`));
    assert.match(text,/What to expect/);assert.match(text,/not verified road grade/);
    assert.match(text,/Next sourced stop unknown/);assert.match(text,/Water, food, toilets and emergency exits unknown/);
    assert.match(text,/Shared ride-time model unavailable/);
    assert.match(routeCard(bundle,null,snapshot).lines.join(' '),/Profile.*unavailable/);
    assert.match(routeCard(bundle,{...a,revisionId:'stale'},snapshot).lines.join(' '),/No substitute totals/);
    assert.match(routeCard(bundle,a,{...snapshot,identity:{...snapshot.identity,revisionId:'stale'}}).lines.join(' '),/pending the matching shared/);
    for(const blocked of [
      {route:{...route,kind:'local'},revision},
      {route:{...route,kind:'example'},revision},
      {route,revision:{...revision,status:'withdrawn'}},
      {route:{...route,rights:{access:'private',redistribution:'approved'}},revision},
    ]) {
      assert.equal(printableBundle(blocked),false);
      assert.equal(routeCard(blocked,a,snapshot).available,false);
      assert.doesNotMatch(JSON.stringify(routeCard(blocked,a,snapshot)),new RegExp(route.name));
    }
  }
});
