import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../js/route-catalog.mjs';
import { exampleCatalog } from '../js/example-catalog.mjs';
import { readSelection, selectionLink, changeSelection } from '../js/route-state.mjs';

// Only synthetic multiday/variant records. Never included in the release.
const record = id => ({
  id, name:id, status:'provisional',
  provenance:{source:'Synthetic test only', observedOn:'2026-11-24'},
  rights:{access:'public', redistribution:'approved', approval:'Synthetic test author'},
});
const revision = id => {
  const hash = 'a'.repeat(64);
  const {name, ...base} = record(id);
  return {...base, geometrySha256:hash,
    geometry:{path:'assets/synthetic.gpx', sha256:hash, format:'gpx', revisionId:id, geometrySha256:hash},
    units:{distance:'m',elevation:'m',grade:'percent'}, distanceSemantics:'source-reported'};
};
const catalog = createCatalog({
  schemaVersion:1, annotations:[],
  events:[{...record('fixture-event'),kind:'organizer'}],
  days:['day-a','day-b'].map(id => ({...record(id), eventId:'fixture-event'})),
  variants:[['short-a','day-a'],['long-a','day-a'],['short-b','day-b']].map(([id,dayId])=>({...record(id),dayId})),
  routes:[
    {...record('route-a'),kind:'organizer',eventId:'fixture-event',variantId:'short-a',currentRevisionId:'rev-new',
      revisions:[{...revision('rev-old'),status:'superseded'},revision('rev-new')]},
    {...record('route-b'),kind:'organizer',eventId:'fixture-event',variantId:'short-b',currentRevisionId:'rev-b',revisions:[revision('rev-b')]},
    {...record('route-gone'),status:'withdrawn',kind:'organizer',eventId:'fixture-event',variantId:'long-a',currentRevisionId:null,revisions:[]},
  ],
});
const profile = {distanceM:20000, chapters:[{id:'section-a',startM:1200}]};
const profiles = Object.fromEntries(['rev-old','rev-new','rev-b','semonzo-example-v1'].map(id=>[id,profile]));
const read = input => readSelection(input,catalog,profiles);

test('public multiroute/day/variant/chapter/view selection round trips without private fields', () => {
  const selected = read('/explore.html?area=explore&view=briefing&day=day-a&variant=short-a&route=route-a&rev=rev-new&chapter=section-a&at=22&ftp=300&weight=80&token=private');
  assert.equal(selected.code,'ready');
  assert.equal(selected.state.distanceM,1200,'chapter start takes precedence');
  const url = selectionLink({...selected.state, ftp:300, weight:80, filename:'private.fit', token:'secret'});
  assert.doesNotMatch(url,/ftp|weight|token|filename|private|secret/);
  assert.deepEqual(read(url).state,selected.state);
  for (const area of ['plan','explore','prepare','ride-week']) {
    const state = changeSelection(selected.state,{area});
    assert.deepEqual(read(selectionLink(state)).state,state);
  }
});
test('missing, withdrawn, unavailable and mismatched links never substitute a route', () => {
  for (const [query,code] of [
    ['route=missing&rev=rev-new','missing'],
    ['route=route-gone&rev=rev-old','withdrawn'],
    ['route=route-a&rev=deleted','revision'],
    ['route=route-a&rev=rev-new&variant=short-b','invalid'],
    ['route=route-b&rev=rev-b&day=day-a','invalid'],
    ['route=route-a&rev=rev-new&at=-2','invalid'],
    ['route=route-a&rev=rev-new&at=Infinity','invalid'],
    ['route=route-a&rev=rev-new&at=20001','invalid'],
    ['route=route-a&route=route-b','invalid'],
    ['route=user:local','local'],
    ['rev=rev-new','invalid'],
    ['day=day-a','choose'],
  ]) {
    const result = read('/explore.html?'+query);
    assert.equal(result.code,code,query); assert.equal(result.bundle,null);
    assert.ok(result.message);
  }
  const unsafe = read('/?route=private/filename');
  assert.doesNotMatch(selectionLink(unsafe.state),/private|filename/);
  assert.equal(read(selectionLink(unsafe.state)).bundle,null);
});
test('old revisions warn, route-only resolves visibly, invalid chapter recovers paused to briefing', () => {
  const pending = readSelection('/?route=route-a&rev=rev-new&chapter=section-a&at=12',catalog,{},'semonzo-example',{loading:true});
  assert.equal(pending.code,'loading');
  assert.equal(pending.state.chapterId,'section-a');
  assert.doesNotMatch(pending.notices.join(' '),/unavailable/);
  const old = read('/?route=route-a&rev=rev-old');
  assert.equal(old.bundle.revision.id,'rev-old');
  assert.match(old.notices.join(' '),/Changed route.*2026-11-24/);
  assert.equal(read('/?route=route-a').state.revisionId,'rev-new');
  assert.match(read('/?route=route-a').notices.join(' '),/not revision-pinned/);
  const invalid = read('/?route=route-a&rev=rev-new&chapter=removed&at=12&view=flyover');
  assert.equal(invalid.code,'ready');
  assert.deepEqual([invalid.state.chapterId,invalid.state.distanceM,invalid.state.view],[null,0,'briefing']);
  assert.match(invalid.notices.join(' '),/Section unavailable/);
});
test('sanitizing an invalid revision preserves blocked state until explicit revision recovery', () => {
  for (const rev of ['deleted/revision', '', '../private.fit', 'ftp=300&weight=80', 'deleted']) {
    let result = read('/explore.html?route=route-a&rev='+encodeURIComponent(rev)+'&view=briefing&token=secret');
    assert.equal(result.bundle,null);
    for (const area of ['prepare','ride-week','plan','explore']) {
      const link = selectionLink(changeSelection(result.state,{area}));
      assert.doesNotMatch(link,/private|secret|ftp|weight|token|%2F/i);
      assert.equal(new URL(link,'https://test.invalid/').searchParams.get('rev'),rev === 'deleted' ? rev : '');
      result = read(link);
      assert.equal(result.bundle,null,`must remain blocked in ${area}`);
      assert.match(result.message,/revision unavailable|revision.*invalid/);
      assert.doesNotMatch(result.notices.join(' '),/Resolved current/);
    }
    const recovered = read(selectionLink(changeSelection(result.state,{revisionId:'rev-new'})));
    assert.equal(recovered.code,'ready');
    assert.equal(recovered.bundle.revision.id,'rev-new');
  }
  const repeated = read('/?route=route-a&rev=rev-new&rev=deleted');
  assert.equal(read(selectionLink(repeated.state)).bundle,null,'repeated revisions cannot silently resolve the first');
});
test('history entries validate exact revisions, switching route resets sections, no default variant', () => {
  const first = read('/?route=route-a&rev=rev-old&chapter=section-a').state;
  const next = changeSelection(first,{routeId:'route-b', revisionId:'rev-b',dayId:null,variantId:null});
  assert.deepEqual([next.chapterId,next.distanceM,next.view],[null,0,'briefing']);
  const history = [selectionLink(first),selectionLink(next)];
  assert.equal(read(history[1]).state.routeId,'route-b');
  assert.deepEqual(read(history[0]).state,first);
  assert.equal(read('/?day=day-a&variant=long-a').bundle,null);
});
test('bare explorer, legacy seek and sensitivity refer only to the cleared example', () => {
  const readExample = url => readSelection(url,exampleCatalog,profiles);
  assert.equal(readExample('/explore.html').state.view,'clock');
  assert.equal(readExample('/explore.html#sensitivity').state.view,'sensitivity');
  const legacy = readExample('/index.html#seek-9000');
  assert.equal(legacy.state.routeId,'semonzo-example');
  assert.deepEqual([legacy.state.distanceM,legacy.state.view],[9000,'flyover']);
  for (const fragment of ['#seek','#seek-nope','#seek-999999']) {
    const result = readExample('/index.html'+fragment);
    assert.equal(result.state.view,'briefing');
    assert.match(result.notices.join(' '),/legacy|Legacy/);
  }
});
