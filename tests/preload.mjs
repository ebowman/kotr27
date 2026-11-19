// Optional real-engine integration: download the pinned public mapbox-gl.js
// and run MAPBOX_GL_215=/path/to/mapbox-gl.js node --test tests/preload.mjs.
// No account/config, real basemap or authenticated tile requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { crc32, deflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { browser, until } from './browser.mjs';

// Solid 256px RGB PNG, valid both as imagery and a constant Mapbox DEM.
const u32 = n => {const b=Buffer.alloc(4); b.writeUInt32BE(n); return b;};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([u32(data.length),body,u32(crc32(body))]);
}
const row = Buffer.concat([Buffer.alloc(1),Buffer.alloc(256*3,Buffer.from([1,154,40]))]);
const tile = Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
  chunk('IHDR',Buffer.from('00000100000001000802000000','hex')),
  chunk('IDAT',deflateSync(Buffer.concat(Array(256).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
const instrument = `
window.hints = []; window.visits = [];
mapboxgl.Map = class extends mapboxgl.Map {
  constructor(options) {
    super({...options,testMode:true,style:{version:8,sources:{sat:{type:'raster',
      tiles:[location.origin+'/sat/{z}/{x}/{y}'],tileSize:256,maxzoom:18}},
      layers:[{id:'sat',type:'raster',source:'sat'}]},transformRequest(url,type){
        if(type==='Tile') (window.batch?.tiles || visits).push({url,t:performance.now()});
        return {url};
      }});
  }
  addSource(id,src) {
    if(id==='dem') {
      src={...src,tiles:[location.origin+'/dem/{z}/{x}/{y}']};
      delete src.url;
    }
    return super.addSource(id,src);
  }
  jumpTo(options,...args) {
    if(!options.preloadOnly) return super.jumpTo(options,...args);
    const pose=()=>JSON.stringify([this.getCenter(),this.getZoom(),this.getPitch(),this.getBearing()]);
    const before=pose();
    window.batch={t:performance.now(),tiles:[],ready:this.areTilesLoaded()};
    try {return super.jumpTo(options,...args);}
    finally { batch.still=before===pose(); hints.push(batch); window.batch=null; }
  }
};`;

test('real 2.15 fetches upcoming imagery and elevation before visible use',
  {skip:!process.env.MAPBOX_GL_215,timeout:60000}, async t => {
    const sdk = await readFile(process.env.MAPBOX_GL_215);
    assert.equal(createHash('sha256').update(sdk).digest('hex'),
      '302ee91531bc123693caa52eb74f71a2fb9ff61311f54d59ec3c04325dc5b2f7');
    const server = createServer(async (req,res) => {
      const path = req.url;
      if (/^\/(sat|dem)\//.test(path)) {
        await sleep(20);
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=3600'}).end(tile);
      } else if (path === '/sdk.js') res.end(Buffer.concat([sdk,Buffer.from('\n'+instrument)]));
      else if (path === '/sdk.css') res.writeHead(200,{'Content-Type':'text/css'}).end();
      else if (path === '/js/config.js') res.end('window.KOTR_CONFIG={}');
      else if (path === '/' || /^\/assets\/(flyover\.js|terrain\.js|semonzo\.gpx|ascent\.svg|grappa-relief\.webp)$/.test(path)) {
        let body = await readFile(new URL('..'+(path==='/'?'/index.html':path),import.meta.url));
        if (path.endsWith('terrain.js')) body = body.toString().replace('https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl','/sdk');
        res.end(body);
      } else res.writeHead(404).end();
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    t.after(() => {server.closeAllConnections();server.close();});
    const {cmd,js,exceptions} = await browser(t);
    await cmd('Network.enable');
    await cmd('Network.setBlockedURLs',{urls:['https://*']});
    await cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    await until(()=>js(`!!document.querySelector('.terrain')`));
    await js(`performance.setResourceTimingBufferSize(5000); speed.value='4'; play.click()`);
    await sleep(12000);
    const {hints,visits,network,total} = await js(`play.click(); ({hints,visits,total:+seek.max,network:performance.getEntriesByType('resource')
      .filter(e=>e.transferSize>0).map(e=>({url:e.name,t:e.startTime}))})`);
    const largest = Math.max(...hints.map(h=>h.tiles.length));
    t.diagnostic(`${hints.length} hints in 12 s at 4x, ${Math.round(total*4/90*2.5)} m horizon; max ${largest} SDK tile selections/hint`);
    assert.ok(largest <= 64,'phone-sized fixture should only cover one viewport per hint');
    assert.ok(hints.length >= 2 && hints.length <= 9);
    hints.forEach((h,i) => {
      assert.ok(h.ready && h.still);
      if (i) assert.ok(h.t-hints[i-1].t >= 1499);
    });
    for (const kind of ['sat','dem']) {
      const leads=new Map();
      for (const h of hints) for (const {url} of h.tiles) {
        if (!new URL(url).pathname.startsWith('/'+kind+'/')) continue;
        const net = network.find(n=>n.url===url);
        if (!net || net.t<h.t || visits.some(v=>v.url===url && v.t<net.t)) continue;
        const use=visits.find(v=>v.url===url && v.t>net.t);
        if (use) leads.set(url,use.t-net.t);
      }
      assert.ok(leads.size, `expected newly fetched future ${kind} tiles`);
      t.diagnostic(`${kind}: ${leads.size} future matches, max network lead ${Math.round(Math.max(...leads.values()))} ms`);
    }
    assert.deepEqual(exceptions,[]);
  });
