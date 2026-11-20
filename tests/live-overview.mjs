// Optical test of the actual app against a normally provisioned localhost
// candidate. No SDK patches, intercepted requests, token inspection or logs.
// LIVE_OVERVIEW_URL=http://localhost:8000/ node --test tests/live-overview.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {browser} from './browser.mjs';

test('live satellite imagery and orange route survive Play/reset and seek/reset',
  {skip:!process.env.LIVE_OVERVIEW_URL,timeout:120000},async t=>{
    const url=new URL(process.env.LIVE_OVERVIEW_URL);
    assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && !url.search && !url.username && !url.password);
    const {js,cmd,exceptions}=await browser(t);
    await cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await cmd('Page.navigate',{url:url.href});
    async function wait(condition) {
      for(let i=0;i<320;i++) {if(await js(condition)) return; await sleep(100);}
      assert.fail(`Timed out: ${condition}; ${await js('message.textContent')}`);
    }
    for (const phase of ['cold','Play → reset','5200 m → reset']) {
      if(phase!=='cold') {
        await js(phase==='Play → reset' ? 'play.click()' : `seek.value=5200;seek.dispatchEvent(new Event('input'))`);
        await wait(`!play.disabled && map.getAttribute('aria-busy')==='false' &&
          (mode.textContent==='Paused' || +seek.value>0)`);
        await js('reset.click()');
      }
      await wait(`document.querySelector('#map')?.getAttribute('aria-busy')==='false' && mode.textContent==='Route overview'`);
      // Interior only: no logo, attribution, captions or other page artwork.
      const clip=await js(`map.scrollIntoView({block:'center'}); (()=>{
        const b=map.getBoundingClientRect();
        return {x:b.x+scrollX+16,y:b.y+scrollY+28,width:b.width-32,height:b.height-56,scale:1};
      })()`);
      const {data}=await cmd('Page.captureScreenshot',{format:'png',clip});
      const {result,exceptionDetails}=await cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,
        expression:`(async()=>{
          const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,${data}')).blob());
          const canvas=new OffscreenCanvas(bitmap.width,bitmap.height), ctx=canvas.getContext('2d');
          ctx.drawImage(bitmap,0,0);
          const px=ctx.getImageData(0,0,bitmap.width,bitmap.height).data, bins=new Map(),rows=new Set();
          let orange=0;
          for(let i=0;i<px.length;i+=4){
            const [r,g,b]=px.subarray(i,i+3);
            if(r>230 && Math.abs(g-147)<18 && Math.abs(b-46)<18) {
              orange++;rows.add(Math.floor(i/4/bitmap.width));continue;
            }
            const bin=(r>>4)*256+(g>>4)*16+(b>>4);
            bins.set(bin,(bins.get(bin)||0)+1);
          }
          return {colors:bins.size,dominant:Math.max(...bins.values())/(px.length/4),orange,rows:rows.size};
        })()`});
      assert.ok(!exceptionDetails,'screenshot decode failed');
      const p=result.value;
      t.diagnostic(`${phase}: ${JSON.stringify(p)}`);
      assert.ok(p.orange>100 && p.rows>40 && p.colors>40 && p.dominant<.5,'missing route or textured imagery');
    }
    assert.deepEqual(exceptions,[]);
  });
