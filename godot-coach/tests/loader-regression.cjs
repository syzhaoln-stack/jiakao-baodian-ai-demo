const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/zhaos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs');
const path=require('path');
const assert=require('assert').strict;
const root=path.resolve(__dirname,'../..');
let browser;

async function scenario(mode) {
  const page=await browser.newPage({viewport:{width:1000,height:720}});
  const requests=[];
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    const file=path.basename(url.pathname);
    requests.push(url.href);
    const raw=url.hostname==='raw.githubusercontent.com';
    const cdn=url.hostname==='cdn.jsdelivr.net';
    const remote=raw||cdn;
    if(raw && file.endsWith('.js')) await new Promise(r=>setTimeout(r,500));
    if(mode==='fallback' && raw && (file.endsWith('.js')||file.endsWith('.gz'))) return route.abort();
    if(mode==='failure' && file.endsWith('.gz')) return route.fulfill({status:503,body:'Unavailable'});
    if(url.hostname==='driving.test' || remote) {
      let filename;
      if(url.pathname==='/simulator/' || file==='index.html') filename=path.join(root,'simulator/index.html');
      else if(file==='favicon.svg') filename=path.join(root,'favicon.svg');
      else if(/^(engine-[0-9a-f]{12}\.(js|wasm\.gz)|training-[0-9a-f]{12}\.pck|index\.[a-z.]+)$/.test(file)) filename=path.join(root,'simulator',file);
      else return route.fulfill({status:404,body:'Missing fixture'});
      const contentType=file.endsWith('.js')?(raw?'text/plain':'text/javascript'):(file.endsWith('.gz')?'application/gzip':(filename.endsWith('.html')?'text/html':'application/octet-stream'));
      return route.fulfill({status:200,body:fs.readFileSync(filename),headers:{'Content-Type':contentType,'Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'}});
    }
    return route.abort();
  });
  await page.goto('https://driving.test/simulator/',{waitUntil:'domcontentloaded'});
  assert(await page.locator('#start').isDisabled(),'Start must stay disabled while engine script is loading');
  await page.locator('#start').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('start').disabled);
  await page.locator('#start').click();
  if(mode==='failure') {
    await page.waitForFunction(()=>!document.getElementById('error').classList.contains('hidden'),null,{timeout:8000});
    assert.match(await page.locator('#error').innerText(),/下载失败/);
    assert.equal(await page.locator('#start').innerText(),'重新加载页面');
  } else {
    await page.waitForFunction(()=>window.__drivingState,null,{timeout:45000});
    assert.equal(await page.evaluate(()=>window.__drivingState.speed),0);
    assert(requests.some(u=>u.includes('raw.githubusercontent.com')&&u.endsWith('.pck')),'Pack must use raw mirror');
    assert(requests.some(u=>u.endsWith('.wasm.gz')),'Compressed WASM must be requested');
    assert(!requests.some(u=>u.endsWith('/index.wasm')),'Modern browser should never download original 39 MB WASM');
    if(mode==='fallback') assert(requests.some(u=>u.includes('cdn.jsdelivr.net')&&u.endsWith('.wasm.gz')),'CDN fallback must supply compressed WASM');
    else assert.equal(errors.length,0,errors.join('\n'));
  }
  console.log(JSON.stringify({scenario:mode,requests:requests.filter(u=>/engine-|training-/.test(u)),errors}));
  await page.close();
}

(async()=>{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  await scenario('raw');
  await scenario('fallback');
  await scenario('failure');
  await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
