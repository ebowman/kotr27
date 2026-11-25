// Deliberately narrow, bounded browser decoder. No URLs, DOM, fetch or repair.
// Unknown metadata stays in the original bytes, not in public route objects.
export const importLimits = Object.freeze({
  bytes:4*1024*1024, points:20000, records:50000, segments:1000, pois:2000,
  tokens:400000, depth:32, timeoutMs:15000,
});
const need = (ok, message) => { if (!ok) throw Error(message); };
// XML's S production is narrower than JavaScript whitespace.
const xmlTrim = text => text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,'');
export const safeLocalName = value => String(value).normalize('NFKC')
  .replace(/[<>&"'\\/\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'')
  .trim().slice(0,100) || 'Local route';
const number = (value, low, high, label) => {
  need(typeof value === 'number' && Number.isFinite(value) && value>=low && value<=high,`Invalid ${label}.`);
  return value;
};
const decimal = text => {
  need(typeof text==='string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(xmlTrim(text)),'Invalid GPX decimal.');
  return Number(text);
};
function timestamp(text) {
  need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(text),
    'Unsupported timestamp: use ISO UTC (Z), at most millisecond precision.');
  const ms=Date.parse(text);
  need(Number.isFinite(ms) && new Date(ms).toISOString().slice(0,19)===text.slice(0,19),'Corrupt timestamp.');
  return ms;
}
function finish(points, samples, extra) {
  need(points.length>=2 && points.length<=importLimits.points,'Expected 2–20,000 geometry points.');
  let lastTime=null;
  for (const s of samples) {
    if (s.timeMs!==null) {
      need(lastTime===null || s.timeMs>lastTime,'Corrupt timestamps: samples must strictly increase.');
      lastTime=s.timeMs;
    }
  }
  const timed=samples.filter(s=>s.timeMs!==null).length;
  const notices=[...extra.notices];
  if (timed && timed!==samples.length) notices.push('Partial timestamps: missing times remain null; recorded replay alignment unavailable.');
  if (points.some(p=>p.elevationM===null)) notices.push('Missing elevation: outline only; no flat elevation or estimates invented.');
  if (points.some(p=>p.breakBefore)) notices.push('Segment/timer/coordinate gaps preserved. Continuous profile, distance playback and estimates unavailable.');
  return {version:1, points, samples, ...extra, notices};
}

// Strict XML subset, streaming tokens rather than an unbounded DOM. Reject
// unsupported syntax, namespace ambiguity and declarations before interpreting
// geometry. This is intentionally not an HTML or general XML parser.
function xml(text, visit) {
  need(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text),'Invalid XML characters.');
  need(!/<!DOCTYPE|<!ENTITY/i.test(text),'XML DTD/entities are unsupported.');
  const decode=s=>s.replace(/&([^;]*);|&/g,(all,entity)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (Object.hasOwn(named,entity)) return named[entity];
    need(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity || ''),'Unsupported XML entity.');
    const n=entity[1]==='x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    need(n===9 || n===10 || n===13 || n>=32 && n<=0x10ffff &&
      !(n>=0xd800 && n<=0xdfff) && n!==0xfffe && n!==0xffff,'Invalid XML entity.');
    return String.fromCodePoint(n);
  });
  let pos=0, tokens=0, roots=0;
  const stack=[];
  while (pos<text.length) {
    need(++tokens<=importLimits.tokens,'XML token limit exceeded.');
    if (text.startsWith('<!--',pos)) {
      const end=text.indexOf('-->',pos+4);
      const body=text.slice(pos+4,end);
      need(end>=0 && !body.includes('--') && !body.endsWith('-'),'Malformed XML comment.');
      pos=end+3; continue;
    }
    if (text.startsWith('<?',pos)) {
      const end=text.indexOf('?>',pos);
      need(pos===0 && end>=0 && /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])[Uu][Tt][Ff]-8\2)?[ \t\r\n]*\?>$/.test(text.slice(pos,end+2)),
        'Unsupported XML processing instruction/declaration.');
      pos=end+2; continue;
    }
    if (text[pos]!=='<') {
      let end=text.indexOf('<',pos); if (end<0) end=text.length;
      const raw=text.slice(pos,end);
      need(!raw.includes(']]>'),'Malformed XML text.');
      // Outside the root, character references are not XML Misc, even when
      // they decode to a space. Validate raw bytes' decoded characters first.
      if (!stack.length) need(/^[ \t\r\n]*$/.test(raw),'Text outside XML root.');
      else visit('text',stack.at(-1),decode(raw));
      pos=end; continue;
    }
    const close=/^<\/([A-Za-z_][\w.:-]*)[ \t\r\n]*>/.exec(text.slice(pos));
    if (close) {
      const e=stack.pop(); need(e?.qname===close[1],'Mismatched XML closing tag.');
      visit('end',e); pos+=close[0].length; continue;
    }
    const open=/^<([A-Za-z_][\w.:-]*)/.exec(text.slice(pos));
    need(open,'Unsupported or malformed XML markup.');
    pos+=open[0].length;
    const attrs=Object.create(null); let empty=false;
    while (true) {
      const tail=text.slice(pos), end=/^[ \t\r\n]*(\/?)>/.exec(tail);
      if (end) { empty=Boolean(end[1]); pos+=end[0].length; break; }
      const a=/^[ \t\r\n]+([A-Za-z_][\w.:-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/.exec(tail);
      need(a && !Object.hasOwn(attrs,a[1]),'Malformed/duplicate XML attribute.');
      need(Object.keys(attrs).length<40,'XML attribute limit exceeded.');
      attrs[a[1]]=decode(a[2]??a[3]); pos+=a[0].length;
    }
    const parent=stack.at(-1), ns={...(parent?.ns || {}),xml:'http://www.w3.org/XML/1998/namespace'};
    for (const [k,v] of Object.entries(attrs)) {
      if (k==='xmlns') ns['']=v;
      else if (k.startsWith('xmlns:')) {
        need(k!=='xmlns:xmlns' && (k!=='xmlns:xml' || v==='http://www.w3.org/XML/1998/namespace') &&
          /^[A-Za-z_][\w.-]*$/.test(k.slice(6)) && v.length>0,'Invalid XML namespace declaration.');
        ns[k.slice(6)]=v;
      }
      if(k==='xmlns' || k.startsWith('xmlns:'))
        need(v!=='http://www.w3.org/2000/xmlns/' &&
          (v!=='http://www.w3.org/XML/1998/namespace' || k==='xmlns:xml'),'Reserved XML namespace.');
    }
    const resolve=q=>{
      const parts=q.split(':'); need(parts.length<=2 && parts.every(p=>/^[A-Za-z_][\w.-]*$/.test(p)),'Invalid XML QName.');
      const prefix=parts.length===2 ? parts[0] : '';
      need(!prefix || Object.hasOwn(ns,prefix),'Unbound XML namespace.');
      return {local:parts.at(-1),uri:ns[prefix]||''};
    };
    const expanded=new Set();
    for (const k of Object.keys(attrs).filter(k=>k!=='xmlns' && !k.startsWith('xmlns:'))) {
      const a=resolve(k), key=`${k.includes(':') ? a.uri : ''}:${a.local}`;
      need(!expanded.has(key),'Duplicate expanded XML attribute.'); expanded.add(key);
    }
    const e={qname:open[1],...resolve(open[1]),attrs,ns,parent};
    if (!parent) need(++roots===1,'Multiple XML roots.');
    need(stack.length<importLimits.depth,'XML depth limit exceeded.');
    visit('start',e);
    if (empty) visit('end',e); else stack.push(e);
  }
  need(!stack.length && roots===1,'Truncated/empty XML.');
}

export function parseGPX(bytes) {
  let text;
  try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { throw Error('GPX must be UTF-8.'); }
  const ns='http://www.topografix.com/GPX/1/1', points=[], samples=[], notices=[];
  let segments=0, tracks=0, routes=0, pois=0, active=null, name='', nextBreak=false;
  const geometry=new Set(['gpx','trk','trkseg','trkpt','rte','rtept','ele','time']);
  const sensors={hr:['heartRateBpm',0,255],cad:['cadenceRpm',0,255],power:['powerW',0,65534],
    watts:['powerW',0,65534],speed:['speedMps',0,200],atemp:['temperatureC',-100,100]};
  xml(text,(event,e,value)=>{
    if (event==='start') {
      e.text='';
      need(!e.parent || !['ele','time','name',...Object.keys(sensors)].includes(e.parent.local),
        'Nested XML scalar unsupported.');
      if (!e.parent) need(e.local==='gpx' && e.uri===ns && e.attrs.version==='1.1','Only GPX 1.1 is supported.');
      if (geometry.has(e.local)) need(e.uri===ns,'Foreign geometry/time namespace unsupported.');
      const parent=e.parent?.local;
      if (e.uri===ns && ['trk','rte'].includes(e.local)) {
        need(parent==='gpx','Nested GPX routes/tracks unsupported.');
        if (e.local==='trk') tracks++; else routes++;
        need(!(tracks && routes),'Mixed track and route geometry unsupported.');
      }
      if (e.uri===ns && (e.local==='trkseg' || e.local==='rte')) {
        need(e.local==='rte' || parent==='trk','Misplaced GPX segment.');
        need(++segments<=importLimits.segments,'Segment limit exceeded.'); nextBreak=points.length>0;
      }
      if (e.uri===ns && ['trkpt','rtept'].includes(e.local)) {
        need(!active && parent===(e.local==='trkpt' ? 'trkseg' : 'rte'),'Misplaced GPX point.');
        need(points.length<importLimits.points,'Geometry point limit exceeded.');
        active={lat:number(decimal(e.attrs.lat),-90,90,'latitude'),
          lon:number(decimal(e.attrs.lon),-180,180,'longitude'),elevationM:null,breakBefore:nextBreak};
        nextBreak=false; e.point=active; e.sample={pointIndex:points.length,timeMs:null};
        e.fields=new Set();
      }
      if (e.uri===ns && e.local==='wpt') need(++pois<=importLimits.pois,'Waypoint limit exceeded.');
      if (active && (e.local==='ele' || e.local==='time')) need(e.parent?.point===active,'Nested/ambiguous point elevation or time.');
    } else if (event==='text') {
      // Only short scalar leaves are retained; all other original metadata stays
      // in bytes. Numeric/name payloads cannot cause a second unbounded string.
      if (['ele','time','name',...Object.keys(sensors)].includes(e.local)) {
        need(e.text.length+value.length<=512,'GPX scalar limit exceeded.'); e.text+=value;
      }
    } else {
      if (e.parent?.point && ['ele','time'].includes(e.local)) {
        const p=e.parent; need(!p.fields.has(e.local),'Duplicate GPX point field.'); p.fields.add(e.local);
        if (e.local==='ele') p.point.elevationM=number(decimal(e.text),-500,9000,'elevation');
        else p.sample.timeMs=timestamp(xmlTrim(e.text));
      }
      const sensor=sensors[e.local];
      if (active && sensor) {
        let p=e.parent; while (p && !p.point) p=p.parent;
        need(p && e.uri==='http://www.garmin.com/xmlschemas/TrackPointExtension/v1','Unsupported telemetry namespace.');
        const [key,low,high]=sensor;
        need(!Object.hasOwn(p.sample,key),'Duplicate GPX telemetry.');
        p.sample[key]=number(decimal(e.text),low,high,'telemetry');
      }
      if (e.uri===ns && e.local==='name' && ['trk','rte'].includes(e.parent?.local) && !name) name=safeLocalName(e.text);
      if (e.point) { points.push(e.point); samples.push(e.sample); active=null; }
    }
  });
  need(tracks+routes>0,'No supported GPX geometry.');
  notices.push('GPX metadata/waypoints and unrecognized extensions are retained only in original bytes, not interpreted as facilities or telemetry.');
  return finish(points,samples,{format:'GPX',kind:samples.some(s=>s.timeMs!==null || Object.keys(s).length>2) ? 'recording' : 'route',
    name,segments,notices});
}

export function fitCRC(bytes) {
  let crc=0;
  for (const b of bytes) {
    crc^=b;
    for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1) ? 0xa001 : 0);
  }
  return crc;
}
export function parseFIT(bytes) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), length=bytes.length;
  need(length>=14 && [12,14].includes(bytes[0]) &&
    String.fromCharCode(...bytes.slice(8,12))==='.FIT','Invalid FIT header.');
  need([1,2].includes(bytes[1]>>>4),'Unsupported FIT protocol.');
  const start=bytes[0], end=start+v.getUint32(4,true);
  need(end+2===length,'FIT truncation, chained files or trailing bytes unsupported.');
  need(start!==14 || v.getUint16(12,true)===0 || fitCRC(bytes.slice(0,12))===v.getUint16(12,true),'FIT header CRC mismatch.');
  need(fitCRC(bytes)===0,'FIT CRC mismatch.');
  let pos=start, count=0, fileType=null, lastStamp=null, pendingBreak=false, segments=1, pois=0;
  const defs=new Map(), points=[], samples=[], ignored=new Set(), notices=[];
  const take=n=>{need(pos+n<=end,'Truncated FIT message.'); const at=pos; pos+=n; return at;};
  // FIT base-type byte includes the endian flag; reserved bits/numbers are
  // invalid even on fields/messages whose semantic value we do not interpret.
  const baseWidths=new Map([[0x00,1],[0x01,1],[0x02,1],[0x83,2],[0x84,2],
    [0x85,4],[0x86,4],[0x07,1],[0x88,4],[0x89,8],[0x0a,1],[0x8b,2],
    [0x8c,4],[0x0d,1],[0x8e,8],[0x8f,8],[0x90,8]]);
  // Only decode profile fields with exact scalar type/width. Other fields are
  // bounded/skipped and disclosed, never guessed using host coercion.
  const fields={
    0:{0:[0,1,'fileType']},
    20:{0:[5,4,'lat'],1:[5,4,'lon'],2:[4,2,'altitude'],3:[2,1,'heartRateBpm'],
      4:[2,1,'cadenceRpm'],5:[6,4,'distance'],6:[4,2,'speed'],7:[4,2,'powerW'],
      13:[1,1,'temperatureC'],73:[6,4,'enhancedSpeed'],78:[6,4,'enhancedAltitude'],253:[6,4,'timestamp']},
    21:{0:[0,1,'event'],1:[0,1,'eventType'],253:[6,4,'timestamp']},
  };
  while (pos<end) {
    need(++count<=importLimits.records,'FIT record limit exceeded.');
    const header=bytes[take(1)];
    need(!(header&0x80),'Compressed FIT timestamp messages unsupported; re-export uncompressed FIT or GPX.');
    need(!(header&0x30),'FIT developer/reserved message fields unsupported.');
    const local=header&15;
    if (header&0x40) {
      const at=take(5), little=bytes[at+1]===0;
      need(bytes[at]===0 && bytes[at+1]<=1,'Invalid FIT definition architecture.');
      const global=v.getUint16(at+2,little), n=bytes[at+4], items=[], ids=new Set();
      need(n>0 && n<=64,'FIT field count unsupported.');
      for (let i=0;i<n;i++) {
        const a=take(3), id=bytes[a], size=bytes[a+1], type=bytes[a+2];
        need(size>0 && !ids.has(id),'Invalid/duplicate FIT field.');
        need(baseWidths.has(type) && size%baseWidths.get(type)===0,'Invalid FIT field base type or width.');
        ids.add(id); items.push({id,size,type});
      }
      defs.set(local,{global,little,items}); continue;
    }
    const def=defs.get(local); need(def,'Undefined FIT local message.');
    const data={};
    for (const f of def.items) {
      const at=take(f.size), spec=fields[def.global]?.[f.id];
      if (!spec) { ignored.add('fields'); continue; }
      const [type,size,key]=spec;
      need(f.type===(type>=3 ? type|0x80 : type) && f.size===size,'Unsupported FIT field type/array.');
      let value;
      if (type===5) value=v.getInt32(at,def.little);
      else if (type===1) value=v.getInt8(at);
      else if (size===4) value=v.getUint32(at,def.little);
      else if (size===2) value=v.getUint16(at,def.little);
      else value=bytes[at];
      const invalid=type===5 ? 0x7fffffff : type===1 ? 0x7f : size===4 ? 0xffffffff : size===2 ? 0xffff : 0xff;
      data[key]=value===invalid ? null : value;
    }
    if (def.global===0) {
      need(fileType===null && [4,6].includes(data.fileType),'FIT requires one activity or course file_id.'); fileType=data.fileType;
    } else if (def.global===21) {
      if (data.event===0 && data.eventType!==0) pendingBreak=true;
    } else if (def.global===20) {
      need(samples.length<importLimits.records,'FIT sample limit exceeded.');
      const s={pointIndex:null,timeMs:data.timestamp==null ? null : (data.timestamp+631065600)*1000};
      if (data.timestamp!=null) {
        need(lastStamp===null || data.timestamp>lastStamp,'Corrupt FIT timestamps.'); lastStamp=data.timestamp;
      }
      for (const key of ['heartRateBpm','cadenceRpm','powerW','temperatureC']) if (Object.hasOwn(data,key)) s[key]=data[key];
      const speed=data.enhancedSpeed??data.speed;
      if (speed!=null) s.speedMps=number(speed/1000,0,200,'FIT speed');
      if (data.distance!=null) s.deviceDistanceM=data.distance/100;
      if (data.lat==null || data.lon==null) pendingBreak=true;
      else {
        need(points.length<importLimits.points,'Geometry point limit exceeded.');
        const altitude=data.enhancedAltitude??data.altitude;
        s.pointIndex=points.length;
        if (pendingBreak && points.length) need(++segments<=importLimits.segments,'Segment limit exceeded.');
        points.push({lat:number(data.lat*180/2**31,-90,90,'FIT latitude'),
          lon:number(data.lon*180/2**31,-180,180,'FIT longitude'),
          elevationM:altitude==null ? null : number(altitude/5-500,-500,9000,'FIT elevation'),
          breakBefore:pendingBreak && points.length>0});
        pendingBreak=false;
      }
      samples.push(s);
    } else {
      if (def.global===32) need(++pois<=importLimits.pois,'FIT course point limit exceeded.');
      ignored.add('messages');
    }
  }
  need(fileType!==null,'Missing FIT file_id.');
  if (ignored.size) notices.push('Uninterpreted FIT metadata/fields are retained only in original bytes; no facility, sport or lap assumptions made.');
  return finish(points,samples,{format:'FIT',kind:fileType===4 ? 'recording' : 'route',name:'',segments,notices});
}
export function parseLocalBytes(buffer) {
  const bytes=new Uint8Array(buffer);
  need(bytes.length>0 && bytes.length<=importLimits.bytes,'File limit: 4 MiB; empty files unsupported.');
  return bytes.length>=12 && String.fromCharCode(...bytes.slice(8,12))==='.FIT' ? parseFIT(bytes) : parseGPX(bytes);
}
