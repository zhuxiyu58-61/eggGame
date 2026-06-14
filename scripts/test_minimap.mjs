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
await new Promise(r => setTimeout(r, 2000));

// 全屏（看小地图在角落）
await page.evaluate(() => { const g = window.__game; g.dayPhase = 0.5; g.dayDuration = 1e9; g.player.position.set(0, 0.6, 8); });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}\\minimap_full.png` });

// 放雪区边缘看雪区在地图上半部
await page.evaluate(() => { const g = window.__game; g.player.position.set(0, 0.6, -50); });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}\\minimap_snow.png` });

// 裁出小地图角落特写
await page.screenshot({ path: `${OUT}\\minimap_corner.png`, clip: { x: 1280 - 190, y: 720 - 190, width: 185, height: 185 } });

// 回中心再裁一张特写
await page.evaluate(() => { const g = window.__game; g.player.position.set(0, 0.6, 8); });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}\\minimap_center_corner.png`, clip: { x: 1280 - 190, y: 720 - 190, width: 185, height: 185 } });

console.log('Done.');
await browser.close();
