// Original synthetic, nonpersonal fixtures. No downloaded activity files.
import { fitCRC } from '../js/local-route-parser.mjs';
export function syntheticGPX({recording=false,missing=false,multi=false,route=false,count=40}={}) {
  const tag=route?'rtept':'trkpt';
  const point=i=>`<${tag} lat="${45+i*.0001}" lon="11.1234567">${missing&&i===1?'':`<ele>${100+i%100}</ele>`}`+
    (recording?`<time>${new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}</time><extensions>`+
      `<gpxtpx:TrackPointExtension><gpxtpx:hr>${120+i%20}</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>`:'')+`</${tag}>`;
  const pts=Array.from({length:count},(_,i)=>(multi&&i===2?'</trkseg><trkseg>':'')+point(i)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" `+
    `xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1">`+
    (route?`<rte><name>Synthetic private sentinel</name>${pts}</rte>`:
      `<trk><name>Synthetic private sentinel</name><trkseg>${pts}</trkseg></trk>`)+`</gpx>`;
}
export function syntheticFIT({recording=false,missing=false,gap=false,bigEndian=false,header14=false,count=40,
  unknownField=null,unknownMessage=false}={}) {
  const chunks=[], little=!bigEndian;
  const def=(local,global,fields)=>{
    const b=Buffer.alloc(6+3*fields.length);b[0]=0x40|local;b[2]=little?0:1;
    little?b.writeUInt16LE(global,3):b.writeUInt16BE(global,3);b[5]=fields.length;
    fields.forEach((f,i)=>b.set(f,6+i*3));chunks.push(b);
  };
  def(0,0,[[0,1,0]]);chunks.push(Buffer.from([0,recording?4:6]));
  const fields=[[0,4,0x85],[1,4,0x85],[2,2,0x84],...(recording?[[253,4,0x86],[3,1,2],[4,1,2],[7,2,0x84]]:[])];
  if(unknownField && !unknownMessage)fields.push([99,unknownField.size,unknownField.type]);
  def(1,20,fields);
  for(let i=0;i<count;i++) {
    const b=Buffer.alloc((recording?19:11)+(unknownField && !unknownMessage ? unknownField.size : 0));b[0]=1;
    const put=(n,at,size,signed=false)=>b[`write${signed?'Int':'UInt'}${size}${little?'LE':'BE'}`](n,at);
    put(gap&&i===2?0x7fffffff:Math.round((45+i*.0001)*2**31/180),1,32,true);
    put(Math.round(11.1234567*2**31/180),5,32,true);
    put(missing&&i===1?65535:3000+i*5,9,16);
    if(recording) {put(1100000000+i,11,32);b[15]=130;b[16]=i===2?255:80;put(200+i,17,16);}
    chunks.push(b);
  }
  if(unknownField && unknownMessage) {
    def(2,250,[[42,unknownField.size,unknownField.type]]);
    chunks.push(Buffer.concat([Buffer.from([2]),Buffer.alloc(unknownField.size)]));
  }
  const payload=Buffer.concat(chunks),header=Buffer.alloc(header14?14:12);
  header[0]=header.length;header[1]=0x10;header.writeUInt16LE(100,2);header.writeUInt32LE(payload.length,4);header.write('.FIT',8);
  if(header14)header.writeUInt16LE(fitCRC(header.subarray(0,12)),12);
  const data=Buffer.concat([header,payload]),crc=Buffer.alloc(2);crc.writeUInt16LE(fitCRC(data));
  return Buffer.concat([data,crc]);
}
