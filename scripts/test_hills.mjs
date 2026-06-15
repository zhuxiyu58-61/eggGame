import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless:'new', args:['--enable-webgl','--use-angle=d3d11','--window-size=1280,720'], defaultViewport:{width:1280,height:720}});
const p = await b.newPage();
p.on('pageerror',e=>console.log('[err]',e.message));
await p.goto('http://localhost:8084/',{waitUntil:'networkidle2',timeout:30000});
await p.waitForSelector('#start-btn',{timeout:10000}); await p.click('#start-btn');
await new Promise(r=>setTimeout(r,2500));

async function hero(name, cam, look, ph){
  await p.evaluate((c,l,phase)=>{const g=window.__game; g.dayPhase=phase; g.dayDuration=1e9;
    if(!g._restoreCam) g._restoreCam=g._updateCamera;
    g._updateCamera=function(){ this.camera.position.set(c[0],c[1],c[2]); this.camera.lookAt(l[0],l[1],l[2]); };
  }, cam, look, ph);
  await new Promise(r=>setTimeout(r,1400));
  await p.screenshot({path:`${OUT}\\${name}.png`});
  console.log('shot',name);
}
// 朝北看雪山
await hero('hills_north_snow', [0, 18, -60], [0, 8, -140], 0.5);
// 朝南看沙丘
await hero('hills_south_dune', [0, 16, 70], [0, 6, 150], 0.5);
// 朝东看绿林山
await hero('hills_east_green', [70, 16, 0], [150, 8, 0], 0.5);
// 高空全景看整圈
await hero('hills_ring', [0, 90, 150], [0, 0, -20], 0.5);
await b.close(); console.log('done');
