// 冰雪区视觉检查
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

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));

const shots = [
    { name: 'snow_01_enter',  phase: 0.45, x: 0,   z: -58,  comment: '雪原入口（游戏机位）' },
    { name: 'snow_02_mid',    phase: 0.45, x: 0,   z: -80,  comment: '雪原中部（游戏机位）' },
    { name: 'snow_03_pond',   phase: 0.45, x: -30, z: -78,  comment: '冰湖（游戏机位）' },
    { name: 'snow_04_igloo',  phase: 0.45, x: 30,  z: -72,  comment: '冰屋（游戏机位）' },
];
const heroShots = [
    { name: 'snow_hero_wide',  phase: 0.45, cam: [0, 4, -55],  look: [0, 3, -100],  comment: '雪原全景' },
    { name: 'snow_hero_pond',  phase: 0.45, cam: [-18, 3, -76], look: [-38, 0, -98], comment: '冰湖近景' },
];

for (const s of shots) {
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
