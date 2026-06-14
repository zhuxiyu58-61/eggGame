import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn'); await page.click('#start-btn');
await page.waitForFunction(() => window.__game && window.__game.player, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));

// 深夜 + 相机仰望天空 + 关掉随机自动刷，手动控制
await page.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.0; g.dayDuration = 1e9;   // 午夜
    g.player.position.set(0, 0.6, 8);
    g._meteorTimer = 9999;                    // 不自动刷
    g._restoreCam = g._restoreCam || g._updateCamera;
    g._updateCamera = function () {
        this.camera.position.set(0, 6, 26);
        this.camera.lookAt(0, 30, -10);       // 望向天空
    };
});
await new Promise(r => setTimeout(r, 600));

// 手动刷一颗，连拍 8 帧
await page.evaluate(() => window.__game._spawnMeteor());
for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 180));
    await page.screenshot({ path: `${OUT}\\meteor_${String(i).padStart(2, '0')}.png` });
}
console.log('Done.');
await browser.close();
