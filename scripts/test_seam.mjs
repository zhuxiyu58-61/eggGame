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
async function hero(name, cam, look){
  await p.evaluate((c,l)=>{const g=window.__game; g.dayPhase=0.5; g.dayDuration=1e9;
    if(!g._restoreCam) g._restoreCam=g._updateCamera;
    g._updateCamera=function(){ this.camera.position.set(c[0],c[1],c[2]); this.camera.lookAt(l[0],l[1],l[2]); };
  }, cam, look);
  await new Promise(r=>setTimeout(r,1400));
  await p.screenshot({path:`${OUT}\\${name}.png`});
  console.log('shot',name);
}
// 雪地入口接缝（从草地一侧贴地望向雪原）
await hero('seam_snow', [0, 6, -38], [0, 1, -75]);
// 沙地入口接缝（从草地一侧望向沙漠）
await hero('seam_desert', [0, 6, 60], [0, 1, 100]);
await b.close(); console.log('done');
