import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT='D:\\IdeProject\\egg-game\\scripts\\out';
if(!fs.existsSync(OUT)) fs.mkdirSync(OUT,{recursive:true});
const b=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:'new',args:['--enable-webgl','--use-angle=d3d11','--window-size=1280,720'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('[err]',e.message));
await p.goto('http://localhost:8088/',{waitUntil:'networkidle2',timeout:30000});
await p.waitForSelector('#start-btn',{timeout:10000}); await p.click('#start-btn');
await new Promise(r=>setTimeout(r,2500));
async function hero(name,cam,look,ph){
  await p.evaluate((c,l,phase)=>{const g=window.__game; g.dayPhase=phase; g.dayDuration=1e9;
    if(!g._restoreCam) g._restoreCam=g._updateCamera;
    g._updateCamera=function(){this.camera.position.set(c[0],c[1],c[2]); this.camera.lookAt(l[0],l[1],l[2]);};
  },cam,look,ph);
  await new Promise(r=>setTimeout(r,1300));
  await p.screenshot({path:`${OUT}\\${name}.png`}); console.log('shot',name);
}
// 橙橙家(-42,-28) idx0 白天:门口盆栽/地垫/花箱/彩旗/柴火堆
await hero('house0_day',[-42,3.2,-15],[-42,2.6,-28],0.5);
// 小蓝家(50,20) idx1 白天:水桶+蓝色调
await hero('house1_day',[50,3.2,33],[50,2.6,20],0.5);
// 橙橙家 黄昏:看门边挂灯+窗发光
await hero('house0_dusk',[-42,3.2,-15],[-42,2.6,-28],0.78);
await b.close(); console.log('done');
