// 收集主线验证：逐个收集火种/泉珠/月光石 → 回钟楼点亮
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8082/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => { const g = window.__game; g.dayPhase = 0.5; g.dayDuration = 1e9; });

async function tp(x, z) {
    await page.evaluate((sx, sz) => {
        const g = window.__game;
        g.player.position.set(sx, 0.6, sz);
        g.velocity = { x: 0, z: 0 }; g.playerVy = 0;
    }, x, z);
    await new Promise(r => setTimeout(r, 900));
}
const count = () => page.evaluate(() => window.__game.questCount);
const done = () => page.evaluate(() => !!window.__game._questDone);
const hud = () => page.evaluate(() => window.__game._questChip?.textContent || '');

// 收集前：截一张带光柱的火种
await tp(-30, -82);
await page.screenshot({ path: `${OUT}\\quest_beam_fireseed.png` });
console.log('[beam] 火种光柱  count=' + await count());

// 逐个收集
await tp(-30, -88); console.log('收火种 count=' + await count());
await tp(-28.5, 121); console.log('收泉珠 count=' + await count());
await tp(38, -32);  console.log('收月光石 count=' + await count() + '  HUD=' + await hud());

// 回钟楼点亮
await tp(7, 7);
await new Promise(r => setTimeout(r, 1500));
const isDone = await done();
console.log('钟楼点亮? _questDone=' + isDone + '  HUD=' + await hud());
await page.screenshot({ path: `${OUT}\\quest_belltower_lit.png` });

await browser.close();
console.log('Done.');
