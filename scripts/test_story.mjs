// 区域故事线验证：小雪精灵 / 老乌龟 / 绿洲复活
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8084/';
const OUT = 'D:\\IdeProject\\egg-game-story\\scripts\\out';
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

async function tp(x, z, dwell = 1100) {
    await page.evaluate((sx, sz) => { const g = window.__game; g.player.position.set(sx, 0.6, sz); g.velocity = { x: 0, z: 0 }; g.playerVy = 0; }, x, z);
    await new Promise(r => setTimeout(r, dwell));
}
const peek = () => page.evaluate(() => {
    const g = window.__game;
    return {
        storyNpcs: g.storyNpcs?.length ?? -1,
        spriteSmile: g._snowSpriteMouth ? +(g._snowSpriteMouth.rotation.z).toFixed(2) : null,
        oasisRevived: !!g._oasisRevived,
        questCount: g.questCount,
    };
});

console.log('初始:', JSON.stringify(await peek()));

// 小雪精灵（含难过气泡）
await tp(-30, -85, 1600);
await page.screenshot({ path: `${OUT}\\story_snow_sprite.png` });
console.log('见小雪精灵:', JSON.stringify(await peek()));

// 收火种 → 精灵变开心（嘴 rotation.z→π）
await tp(-30, -88, 1400);
console.log('收火种后:', JSON.stringify(await peek()));
await tp(-30, -85, 1400);
await page.screenshot({ path: `${OUT}\\story_snow_sprite_happy.png` });

// 老乌龟
await tp(40, -29, 1600);
await page.screenshot({ path: `${OUT}\\story_turtle.png` });
console.log('见老乌龟:', JSON.stringify(await peek()));
// 收月光石
await tp(38, -32, 1200);
console.log('收月光石后:', JSON.stringify(await peek()));

// 绿洲复活：先看珠子，再收，再看复活
await tp(-30, 112, 1200);
await page.screenshot({ path: `${OUT}\\story_oasis_before.png` });
await tp(-28.5, 121, 1200);   // 收清泉之珠
await tp(-30, 110, 3500);     // 站旁边等渐显
await page.screenshot({ path: `${OUT}\\story_oasis_after.png` });
console.log('收泉珠后:', JSON.stringify(await peek()));

await browser.close();
console.log('Done.');
