// Opt-in: use the normally provisioned localhost app and a fresh Chrome
// profile. Reload in that same profile for the warm pass; do not mock tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {browser} from './browser.mjs';

test('real cold and warm rides reach a visible summit and retain the controls',
  {skip:!process.env.LIVE_RIDE_URL,timeout:480000},async t=>{
    const url=new URL(process.env.LIVE_RIDE_URL);
    assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && !url.search && !url.username && !url.password);
    const {cmd,js,exceptions}=await browser(t);
    await cmd('Page.enable');
    await cmd('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false});
    async function wait(condition,ms=30000) {
      const end=Date.now()+ms;
      while(Date.now()<end) { if(await js(condition)) return; await sleep(100); }
      assert.fail(`${condition}: ${await js(`document.querySelector('#message')?.textContent`)}`);
    }
    for (const pass of ['cold','warm']) {
      await js('window.previousRide=true');
      if(pass==='warm') await cmd('Page.reload',{ignoreCache:false});
      else await cmd('Page.navigate',{url:url.href});
      await wait(`!window.previousRide && document.readyState==='complete' &&
        document.querySelector('#deck')?.hidden===false && +seek.value===0`);
      await js(`map.scrollIntoView({block:'center'});play.click()`);
      const start=Date.now(),ridge={visible:0,total:0};
      let s,bin=-1,lastDistance=-1,lastMotion=Date.now(),longestHold=0;
      do {
        await sleep(230);
        s=await js(`(()=>{
          const dot=map.querySelector('.rider-beacon'),b=dot?.getBoundingClientRect();
          return {d:+seek.value,max:+seek.max,mode:mode.textContent,msg:message.textContent,
            visible:!!b && document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===dot &&
              getComputedStyle(dot).opacity==='1' && map.getAttribute('aria-busy')==='false',
            disabled:play.disabled}
        })()`);
        assert.ok(!s.disabled && Date.now()-start<220000,JSON.stringify({pass,...s}));
        if(s.d!==lastDistance) {lastDistance=s.d;lastMotion=Date.now();}
        else if(s.d>0 && s.d<s.max) longestHold=Math.max(longestHold,Date.now()-lastMotion);
        if(Math.floor(s.d/5000)>bin) {
          bin=Math.floor(s.d/5000);
          console.info(`${pass}: ${s.d} m, ${s.mode}, visible=${s.visible}`);
        }
        if(s.d>=4000 && s.d<7000) {
          ridge.total++;
          if(s.visible && s.mode==='Cinematic flyover') ridge.visible++;
        }
      } while(!(s.mode==='Summit' && s.visible && s.d===s.max && !s.msg.startsWith('Loading')));
      t.diagnostic(`${pass}: ${s.d} m, visible summit in ${Date.now()-start} ms; visible 3D ridge ${ridge.visible}/${ridge.total}; longest sampled hold after motion ${longestHold} ms`);
      assert.ok(longestHold<5000,`stalled after motion: ${longestHold} ms`);
      assert.ok(ridge.total>0 && ridge.visible/ridge.total>.9,JSON.stringify(ridge));
      const clip=await js(`(()=>{const b=map.getBoundingClientRect();
        return {x:b.x+scrollX+16,y:b.y+scrollY+28,width:b.width-32,height:b.height-56,scale:1}})()`);
      const {data}=await cmd('Page.captureScreenshot',{format:'png',clip});
      const {result}=await cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
        const bmp=await createImageBitmap(await(await fetch('data:image/png;base64,${data}')).blob());
        const ctx=new OffscreenCanvas(bmp.width,bmp.height).getContext('2d');ctx.drawImage(bmp,0,0);
        const a=ctx.getImageData(0,0,bmp.width,bmp.height).data, bins=new Map();let orange=0;
        for(let i=0;i<a.length;i+=4){const [r,g,b]=a.subarray(i,i+3);
          if(r>230 && Math.abs(g-147)<18 && Math.abs(b-46)<18)orange++;
          const bin=(r>>4)*256+(g>>4)*16+(b>>4);bins.set(bin,(bins.get(bin)||0)+1)}
        return {colors:bins.size,dominant:Math.max(...bins.values())/(a.length/4),orange}
      })()`});
      const pixels=result.value;
      assert.ok(pixels.colors>40 && pixels.dominant<.5 && pixels.orange>40,JSON.stringify(pixels));
      t.diagnostic(`${pass} summit pixels: ${JSON.stringify(pixels)}`);
      await js('play.click()');
      await wait(`+seek.value>0 && +seek.value<1000 && play.textContent==='Pause'`);
      await js(`play.click();seek.value=5200;seek.dispatchEvent(new Event('input'))`);
      await wait(`+seek.value===5200 && mode.textContent==='Paused' && map.getAttribute('aria-busy')==='false'`);
      await js('reset.click()');
      await wait(`+seek.value===0 && mode.textContent==='Route overview' && map.getAttribute('aria-busy')==='false'`);
    }
    assert.deepEqual(exceptions,[]);
  });
