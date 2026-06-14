// 区域感受 + 扩图验证：传送到沙漠/冰雪/家，截图看冷热表现 + 地图全景
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8081/';
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
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));

// 游戏机位传送：在区里停留 dwell ms 让色调淡入 + 吐白气/汗珠/气泡冒出来
async function teleportShot(name, x, z, phase, comment, dwell = 3000) {
    await page.evaluate((sx, sz, ph) => {
        const g = window.__game;
        g.dayPhase = ph;
        g.dayDuration = 1e9;
        if (g._restoreCam) { g._updateCamera = g._restoreCam; g._restoreCam = null; }
        g.player.position.set(sx, 0.6, sz);
        g.velocity = { x: 0, z: 0 };
        g.playerVy = 0;
    }, x, z, phase);
    await new Promise(r => setTimeout(r, dwell));
    await page.screenshot({ path: `${OUT}\\${name}.png` });
    const region = await page.evaluate(() => window.__game._currentRegion);
    console.log(`[${name}] ${comment}  region=${region}`);
}

// 高空俯视全景，看扩图后的整体布局
async function heroShot(name, cam, look, phase, comment) {
    await page.evaluate((c, l, ph) => {
        const g = window.__game;
        g.dayPhase = ph; g.dayDuration = 1e9;
        if (!g._restoreCam) g._restoreCam = g._updateCamera;
        g._updateCamera = function () {
            this.camera.position.set(c[0], c[1], c[2]);
            this.camera.lookAt(l[0], l[1], l[2]);
        };
    }, cam, look, phase);
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: `${OUT}\\${name}.png` });
    console.log(`[${name}] ${comment}`);
}

// 1) 冰雪区——冷感（吐白气+打哆嗦+冷蓝晕影+气泡）
await teleportShot('region_snow', -10, -92, 0.5, '冰雪区冷感');
// 2) 沙漠区——热感（汗珠+蔫+暖橙热浪+气泡）
await teleportShot('region_desert', 0, 118, 0.5, '沙漠区热感');
// 3) 沙漠绿洲近景
await teleportShot('region_oasis', -30, 116, 0.5, '干涸绿洲');
// 4) 家——无特效
await teleportShot('region_home', 0, 6, 0.5, '村庄舒适区', 1500);

// 5) 全景俯视（扩图后）
await heroShot('map_overview', [0, 120, 175], [0, 0, 0], 0.5, '扩图全景俯视');
// 6) 沙漠斜俯视
await heroShot('map_desert_wide', [0, 35, 60], [0, 2, 120], 0.5, '沙漠区斜俯瞰');

await browser.close();
console.log('Done.');
