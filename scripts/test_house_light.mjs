// 夜晚进屋自动开灯验证
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8083/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));

// house0 = 第一间小房子 (-42,-28)；index 找它的灯
async function setPhase(ph) { await page.evaluate(p => { const g = window.__game; g.dayPhase = p; g.dayDuration = 1e9; }, ph); }
async function tp(x, z) {
    await page.evaluate((sx, sz) => { const g = window.__game; g.player.position.set(sx, 0.6, sz); g.velocity = { x: 0, z: 0 }; g.playerVy = 0; }, x, z);
}
const lamp0 = () => page.evaluate(() => +(window.__game.houses[0].lamp?.intensity ?? -1).toFixed(2));
const dayness = () => page.evaluate(() => +(window.__game._lastDayness ?? -1).toFixed(2));

// 1) 夜晚 + 站屋外 → 灯应灭
await setPhase(0.0); await tp(-42, -10); await new Promise(r => setTimeout(r, 1500));
console.log(`夜·屋外  dayness=${await dayness()}  lamp=${await lamp0()}  (期望≈0)`);

// 2) 夜晚 + 进屋 → 灯应渐亮
await tp(-42, -28); await new Promise(r => setTimeout(r, 1800));
console.log(`夜·屋内  dayness=${await dayness()}  lamp=${await lamp0()}  (期望→1.5)`);
await page.screenshot({ path: `${OUT}\\house_night_lit.png` });

// 3) 夜晚 + 出屋 → 灯应渐灭
await tp(-42, -10); await new Promise(r => setTimeout(r, 2000));
console.log(`夜·走出  dayness=${await dayness()}  lamp=${await lamp0()}  (期望→0)`);

// 4) 白天 + 进屋 → 灯保持灭
await setPhase(0.5); await tp(-42, -28); await new Promise(r => setTimeout(r, 1800));
console.log(`昼·屋内  dayness=${await dayness()}  lamp=${await lamp0()}  (期望≈0)`);
await page.screenshot({ path: `${OUT}\\house_day_inside.png` });

await browser.close();
console.log('Done.');
