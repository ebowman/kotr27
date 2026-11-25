import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalBytes, safeLocalName, importLimits, fitCRC } from '../js/local-route-parser.mjs';
import { libraryChange } from '../js/local-route-storage.mjs';
import { analyzeRoute } from '../js/route-analysis.mjs';
import { syntheticGPX, syntheticFIT } from './local-route-fixtures.mjs';
const parse=value=>parseLocalBytes(typeof value==='string'?new TextEncoder().encode(value):value);
const analysis=d=>analyzeRoute({routeId:'local-test',revisionId:'local-v1',geometrySha256:'0'.repeat(64),points:d.points});
test('real GPX/FIT bytes: routes and recordings, independent sample stream, endian/header CRC',()=>{
  for(const recording of [false,true])for(const format of ['GPX','FIT']) {
    const d=parse(format==='GPX'?syntheticGPX({recording}):syntheticFIT({recording,bigEndian:true,header14:true}));
    assert.equal(d.kind,recording?'recording':'route');assert.equal(d.format,format);
    assert.equal(d.points.length,40);assert.equal(d.samples.length,40);
    assert.equal(analysis(d).status,'supported');
    assert.ok(!Object.hasOwn(d.points[0],'timeMs'));assert.ok(!Object.hasOwn(d.points[0],'heartRateBpm'));
    if(recording) {assert.ok(d.samples[0].timeMs>0);assert.ok(d.samples[0].heartRateBpm>0);}
    else assert.equal(d.samples[0].timeMs,null);
  }
  assert.equal(parse(syntheticGPX({route:true})).kind,'route');
  assert.equal(parse(syntheticFIT({recording:true})).samples[2].cadenceRpm,null);
});
test('missing elevation, multi-segment and GPS gaps stay explicit; no bridge/flat fabrication',()=>{
  for(const input of [syntheticGPX({missing:true}),syntheticGPX({multi:true}),
    syntheticFIT({missing:true}),syntheticFIT({recording:true,gap:true})]) {
    const d=parse(input),a=analysis(d);assert.equal(a.status,'unsupported');assert.equal(a.windows.length,0);
    assert.ok(d.notices.length>0);
  }
  const d=parse(syntheticFIT({recording:true,gap:true}));
  assert.equal(d.points.length,39);assert.equal(d.samples.length,40);
  assert.equal(d.samples[2].pointIndex,null);assert.equal(d.samples[3].pointIndex,2);
  assert.equal(d.points[2].breakBefore,true);
  assert.equal(parse(syntheticGPX({missing:true})).points[1].elevationM,null);
  const sparse=parse(syntheticGPX().replace('45.0001','46.0001'));
  assert.ok(analysis(sparse).issues.some(i=>i.code==='gap'));
});
test('strict malformed GPX, entities, corrupt timestamps, ambiguity and decoded limits',()=>{
  const valid=syntheticGPX({recording:true});
  const invalid=[
    valid.slice(0,-5), valid+'<x/>', valid.replace('<trk>','<!DOCTYPE x><trk>'),
    valid.replace('<ele>100</ele>','<ele>&xxe;</ele>'),valid.replace('<ele>100</ele>','<ele>NaN</ele>'),
    valid.replace('Synthetic private sentinel','&constructor;'),
    valid.replace('<ele>100</ele>','<ele><b/>100</ele>'),valid.replace('<ele>100</ele>','<ele>100</ele><ele>100</ele>'),
    valid.replace('2026-01-01','2026-02-31'),valid.replace('00:00:01.000','00:00:00.000'),
    valid.replace('lat="45"','lat="91"'),valid.replace('lat="45"','lat="45" lat="46"'),
    valid.replace('<trkseg>','<extensions><trkseg>'),valid.replace('version="1.1"','version="1.0"'),
    valid.replace('<ele>100</ele>','<other:ele>100</other:ele>'),
  ];
  for(const x of invalid)assert.throws(()=>parse(x));
  assert.throws(()=>parse(new Uint8Array(importLimits.bytes+1)),/limit/);
  assert.throws(()=>parse(syntheticGPX({count:20001})),/point limit/);
  assert.equal(parse(syntheticGPX({count:20000})).points.length,20000);
  assert.throws(()=>parse('<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">'+
    '<extensions>'.repeat(33)+'</extensions>'.repeat(33)+'</gpx>'),/depth/);
  const partial=valid.replace('<time>2026-01-01T00:00:01.000Z</time>','');
  assert.equal(parse(partial).samples[1].timeMs,null);
  assert.match(parse(partial).notices.join(' '),/Partial timestamps/);
  assert.equal(safeLocalName('<script>/private\u202e & "name"'),'scriptprivate  name');
});
test('FIT truncation, real CRC corruption, unsupported encoding and type confusion rejected',()=>{
  const valid=syntheticFIT({recording:true,header14:true});
  assert.equal(fitCRC(valid),0);
  const corrupt=Buffer.from(valid);corrupt[50]^=1;
  for(const x of [valid.subarray(0,-1),Buffer.concat([valid,Buffer.from([0])]),corrupt])
    assert.throws(()=>parse(x),/FIT/);
  const reCRC=x=>{x.writeUInt16LE(fitCRC(x.subarray(0,-2)),x.length-2);return x;};
  const compressed=Buffer.from(syntheticFIT());compressed[12]=0x80;
  assert.throws(()=>parse(reCRC(compressed)),/Compressed/);
  const developer=Buffer.from(syntheticFIT());developer[12]|=0x20;
  assert.throws(()=>parse(reCRC(developer)),/developer/);
  const type=Buffer.from(syntheticFIT());type[20]=0x86;
  assert.throws(()=>parse(reCRC(type)),/type|field/);
});
test('XML comment grammar rejects trailing hyphen and double hyphen, accepts valid comments',()=>{
  const withComment=comment=>syntheticGPX().replace('<trk>',comment+'<trk>');
  for(const comment of ['<!--bad--->','<!--bad--bad-->','<!-- --->','<!--bad---->','<!--unclosed'])
    assert.throws(()=>parse(withComment(comment)),/XML comment/);
  for(const comment of ['<!---->','<!--valid-->','<!-- - -->','<!--a-b-->'])
    assert.equal(parse(withComment(comment)).points.length,40);
});
test('XML outside-root text validates raw XML S, never decoded references or JS whitespace',()=>{
  const valid=syntheticGPX(),body=valid.slice(valid.indexOf('<gpx'));
  for(const raw of ['&#32;','&#x20;','&#9;','&#10;','&#13;','\u00a0','\u0085','\u2003','\u2028','\u2029','\ufeff']) {
    for(const text of ['<!--prefix-->'+raw+body,valid+raw,valid+raw+'<!--suffix-->'])
      assert.throws(()=>parse(text),/Text outside XML root/);
  }
  for(const ws of [' ','\t','\r','\n',' \t\r\n']) {
    assert.equal(parse('<!--prefix-->'+ws+body+ws+'<!--suffix-->'+ws).points.length,40);
    assert.equal(parse(valid.replace('<gpx ',`<gpx${ws}`).replace('version="1.1"',`version${ws}=${ws}"1.1"${ws}`)
      .replace('</gpx>',`<extensions${ws}/></gpx${ws}>`)).points.length,40);
    assert.equal(parse(valid.replace('<?xml version=',`<?xml${ws}version${ws}=${ws}`)).points.length,40);
  }
  const prefixed=body.replace(/<(\/?)(gpx|trk|name|trkseg|trkpt|ele)(?=[ >])/g,'<$1g:$2')
    .replace('xmlns=','xmlns:g=');
  assert.equal(parse(' \t<!--before-->'+prefixed+'\r\n<!--after-->').points.length,40);
});
test('XML lexical separators and GPX scalar padding also use XML S, not JS whitespace',()=>{
  const valid=syntheticGPX({recording:true});
  for(const text of [
    valid.replace('<?xml','<?XML'),valid.replace('version=','VERSION='),
    valid.replace('version="1.0"',`version='1.0"`),
    valid.replace('encoding="UTF-8"',`encoding='UTF-8"`),
  ])assert.throws(()=>parse(text),/XML processing instruction\/declaration/);
  assert.equal(parse(valid.replace('version="1.0"',`version = '1.0'`)
    .replace('encoding="UTF-8"',`encoding = 'utf-8'`)).points.length,40);
  for(const ws of ['\u00a0','\u0085','\u2003','\u2028','\u2029','\ufeff']) {
    for(const text of [
      valid.replace('<?xml ',`<?xml${ws}`),valid.replace('<gpx ',`<gpx${ws}`),
      valid.replace('version="1.1"',`version${ws}="1.1"`),
      valid.replace('version="1.1"',`version=${ws}"1.1"`),
      valid.replace('version="1.1">',`version="1.1"${ws}>`),
      valid.replace('</gpx>',`</gpx${ws}>`),valid.replace('</gpx>',`<extensions${ws}/></gpx>`),
      valid.replace('<ele>100</ele>',`<ele>${ws}100${ws}</ele>`),
      valid.replace('<time>2026','<time>'+ws+'2026'),
    ])assert.throws(()=>parse(text));
    // XML character data may contain these characters; it is not a separator.
    assert.equal(parse(valid.replace('Synthetic private sentinel',`Name${ws}inside`)).points.length,40);
  }
  assert.equal(parse(valid.replace('<ele>100</ele>','<ele> \t100\r\n</ele>')
    .replace('<time>2026','<time> \t2026').replace('00:00:00.000Z</time>','00:00:00.000Z\r\n</time>')).points.length,40);
});
test('FIT validates every definition before skipping valid unknown fields/messages',()=>{
  const types=[[0,1],[1,1],[2,1],[0x83,2],[0x84,2],[0x85,4],[0x86,4],[7,1],
    [0x88,4],[0x89,8],[10,1],[0x8b,2],[0x8c,4],[13,1],[0x8e,8],[0x8f,8],[0x90,8]];
  for(const unknownMessage of [false,true]) {
    for(const [type,size] of types) {
      const bytes=syntheticFIT({unknownMessage,unknownField:{type,size:size*2}});
      assert.equal(fitCRC(bytes),0);
      assert.equal(parse(bytes).points.length,40);
      assert.match(parse(bytes).notices.join(' '),/Uninterpreted FIT/);
    }
    for(const [type,size] of [[255,1],[0x91,8],[0x40,1],[0x04,2],[0x87,1],[0x84,3],[0x86,2],[0x90,4]]) {
      const bytes=syntheticFIT({unknownMessage,unknownField:{type,size}});
      assert.equal(fitCRC(bytes),0);
      assert.throws(()=>parse(bytes),/FIT field base type or width/);
    }
  }
});
test('atomic library consent, category tombstones and stale tabs never resurrect deleted files',()=>{
  const id='user:11111111-1111-4111-8111-111111111111';
  const record={id,name:'Synthetic',buffer:new ArrayBuffer(16)};
  const save={type:'save',expected:null,record};
  const saved=libraryChange(null,save,100);
  assert.equal(saved.entries.length,1);assert.equal(saved.generation,null);
  const deleted=libraryChange(saved,{type:'delete',id,nextGeneration:'deleted'},101);
  assert.equal(deleted.entries.length,0);
  assert.throws(()=>libraryChange(deleted,save,102),/another tab/);
  const forgotten=libraryChange(null,{type:'forget',nextGeneration:'revoked'},100);
  assert.throws(()=>libraryChange(forgotten,save,102),/another tab/);
  assert.throws(()=>libraryChange(saved,save,102),/overwritten/);
  const expired=libraryChange(saved,{type:'expire',nextGeneration:'expired'},100+90*86400000);
  assert.equal(expired.entries.length,0);assert.throws(()=>libraryChange(expired,save),/another tab/);
  const full={...saved,entries:Array.from({length:10},(_,i)=>({id:`user:00000000-0000-4000-8000-00000000000${i}`,bytes:16,name:'test',savedAt:100}))};
  assert.throws(()=>libraryChange(full,save),/limit/);
});
