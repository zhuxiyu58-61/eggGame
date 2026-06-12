// 视觉升级验证：游戏视角 + 接管相机的风景照（能看到天空/地平线）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageerror]', err.message));
page.on('console', msg => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text());
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));

// 游戏机位（默认第三人称）
const gameShots = [
    { name: 'vis_01_noon',     phase: 0.50, x: 0,  z: 14,  comment: '正午 村中心' },
    { name: 'vis_02_sunset',   phase: 0.74, x: 0,  z: 14,  comment: '日落' },
    { name: 'vis_03_night',    phase: 0.02, x: 0,  z: 14,  comment: '深夜' },
    { name: 'vis_05_lake_day', phase: 0.45, x: 48, z: -28, comment: '白天湖边' },
];
// 风景机位（接管相机，能看到天空）
const heroShots = [
    { name: 'hero_noon',   phase: 0.50,  cam: [0, 3, 30],    look: [0, 8, -40],    comment: '正午村庄全景' },
    { name: 'hero_sunset', phase: 0.745, cam: [20, 2.5, 0],  look: [-75, 12, -22], comment: '日落朝向太阳' },
    { name: 'hero_night',  phase: 0.02,  cam: [0, 2, 20],    look: [-10, 45, -60], comment: '夜晚仰望星月' },
];

for (const s of gameShots) {
    await page.evaluate((phase, sx, sz) => {
        const g = window.__game;
        g.dayPhase = phase;
        g.dayDuration = 1e9;
        if (g._restoreCam) { g._updateCamera = g._restoreCam; g._restoreCam = null; }
        g.player.position.set(sx, 0.6, sz);
        g.velocity = { x: 0, z: 0 };
        g.playerVy = 0;
    }, s.phase, s.x, s.z);
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: `${OUT}\\${s.name}.png` });
    console.log(`[${s.name}] ${s.comment}`);
}

for (const s of heroShots) {
    await page.evaluate((phase, cam, look) => {
        const g = window.__game;
        g.dayPhase = phase;
        g.dayDuration = 1e9;
        if (!g._restoreCam) g._restoreCam = g._updateCamera;
        g._updateCamera = function () {
            this.camera.position.set(cam[0], cam[1], cam[2]);
            this.camera.lookAt(look[0], look[1], look[2]);
        };
    }, s.phase, s.cam, s.look);
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: `${OUT}\\${s.name}.png` });
    console.log(`[${s.name}] ${s.comment}`);
}

await browser.close();
console.log('Done.');
