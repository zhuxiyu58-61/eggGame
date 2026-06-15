import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:'new',args:['--enable-webgl','--use-angle=d3d11','--window-size=1280,720'],defaultViewport:{width:1280,height:720}});
const p=await b.newPage(); p.on('pageerror',e=>console.log('[err]',e.message));
const URL='http://localhost:8090/';
async function start(){ await p.waitForSelector('#start-btn',{timeout:10000}); await p.click('#start-btn'); await new Promise(r=>setTimeout(r,2600)); }
async function tp(x,z){ await p.evaluate((sx,sz)=>{const g=window.__game;g.player.position.set(sx,0.6,sz);g.velocity={x:0,z:0};g.playerVy=0;},x,z); await new Promise(r=>setTimeout(r,700)); }

// 干净起步：清存档
await p.goto(URL,{waitUntil:'networkidle2',timeout:30000});
await p.evaluate(()=>localStorage.removeItem('eggGameProgress'));
await p.reload({waitUntil:'networkidle2'}); await start();

// 收 1 颗星 + 1 件心愿之物(火种 -30,-88)
await p.evaluate(()=>{const g=window.__game; const s=g.collectStars[0]; if(s){g.player.position.set(s.mesh.position.x,0.6,s.mesh.position.z);}});
await new Promise(r=>setTimeout(r,800));
await tp(-30,-88);
const after=await p.evaluate(()=>({stars:window.__game.starsCollected,quest:window.__game.questCount,ls:localStorage.getItem('eggGameProgress')}));
console.log('收集后:', JSON.stringify(after));

// 刷新 → 进度应续上
await p.reload({waitUntil:'networkidle2'}); await start();
const reload=await p.evaluate(()=>({stars:window.__game.starsCollected,quest:window.__game.questCount,starsSpawned:window.__game.collectStars.length,questCollected:window.__game.questItems.filter(i=>i.collected).map(i=>i.key)}));
console.log('刷新后:', JSON.stringify(reload));

// 收齐剩余 2 件 → 去钟楼 → 胜利画面
await tp(-28.5,121); await tp(38,-32);
await tp(7,7); await new Promise(r=>setTimeout(r,1500));
const win=await p.evaluate(()=>({questDone:window.__game._questDone,winEl:!!window.__game._winEl,ls:localStorage.getItem('eggGameProgress')}));
console.log('通关:', JSON.stringify(win));
await p.screenshot({path:'D:\\IdeProject\\egg-game\\scripts\\out\\win_screen.png'});

// 再刷新 → 钟楼应仍亮、questDone 持久
await p.reload({waitUntil:'networkidle2'}); await start();
const after2=await p.evaluate(()=>({questDone:window.__game._questDone,quest:window.__game.questCount}));
console.log('通关后再刷新:', JSON.stringify(after2));
await b.close(); console.log('done');
