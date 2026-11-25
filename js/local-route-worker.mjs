import { parseLocalBytes, safeLocalName } from './local-route-parser.mjs';
import { analyzeRoute, horizontalDistanceM } from './route-analysis.mjs';

// Worker receives bytes, never a URL. Hash is private identity, never navigation.
self.onmessage=async({data:{buffer,name,id}})=>{
  try {
    const decoded=parseLocalBytes(buffer);
    let length=0;
    for(let i=1;i<decoded.points.length;i++) {
      const step=horizontalDistanceM(decoded.points[i-1],decoded.points[i]);
      if(!decoded.points[i].breakBefore && step<=500)length+=step;
    }
    if(length>500000)throw Error('Local geometry exceeds 500 km of supported intervals; split at source. Nothing truncated.');
    const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))]
      .map(b=>b.toString(16).padStart(2,'0')).join('');
    const revisionId=`local-${id.slice(5)}`;
    const analysis=analyzeRoute({routeId:id,revisionId,geometrySha256:sha,points:decoded.points});
    self.postMessage({record:{id,revisionId,name:safeLocalName(decoded.name||name),decoded,analysis,buffer}},
      [buffer]);
  } catch (error) {
    // Parser messages are fixed copy, never source XML or metadata.
    self.postMessage({error:error.message});
  }
};
