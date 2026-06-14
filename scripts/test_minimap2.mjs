import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
const CLIP = { x: 1280 - 200, y: 720 - 200, width: 196, height: 196 };
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
await new Promise(r => setTimeout(r, 1800));

async function shot(name, setup) {
    await page.evaluate(setup);
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}\\${name}.png`, clip: CLIP });
    console.log(`[${name}]`);
}

// 在范围内·关闭
await shot('mm_extract_closed', () => {
    const g = window.__game; g.dayPhase = 0.5; g.dayDuration = 1e9;
    g.extractPhase = 'closed';
    g.player.position.set(0, 0.6, 8);
});
// 在范围内·开启
await shot('mm_extract_open', () => {
    const g = window.__game; g.extractPhase = 'open';
    g.player.position.set(0, 0.6, 8);
});
// 离很远·越界（看边缘箭头+指引线）
await shot('mm_extract_far', () => {
    const g = window.__game; g.extractPhase = 'open';
    g.player.position.set(-60, 0.6, -60);
});
console.log('Done.');
await browser.close();
