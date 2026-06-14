import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn'); await page.click('#start-btn');
await page.waitForFunction(() => window.__game && window.__game.monsters && window.__game.monsters.length, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));

async function shoot(name, setup) {
    await page.evaluate(setup);
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: `${OUT}\\${name}.png`, clip: { x: 240, y: 60, width: 800, height: 600 } });
    console.log(`[${name}]`);
}

// 三种怪并排（normal紫 / fast粉带翅 / tank大绿）
await shoot('loot2_monsters', () => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    const byType = t => g.monsters.filter(m => m.type === t);
    const lay = (m, x) => { if (m) { m.state = 'alive'; m.group.visible = true; m.group.position.set(x, 0, -7); m.home.set(x, 0, -7); } };
    lay(byType('normal')[0], -3); lay(byType('fast')[0], 0); lay(byType('tank')[0], 3);
    g.player.position.set(0, 0.6, 2);
    g._restoreCam = g._restoreCam || g._updateCamera;
    g._updateCamera = function () { this.camera.position.set(0, 2.2, 6); this.camera.lookAt(0, 1, -7); };
});

// 玩家头顶血条（扣到3滴，正面拉远）
await shoot('loot2_player_hp', () => {
    const g = window.__game;
    g.playerHP = 3; g._renderPlayerHP();
    const p = g.player.position;
    g._updateCamera = function () { this.camera.position.set(p.x, p.y + 1.6, p.z + 6.5); this.camera.lookAt(p.x, p.y + 1.0, p.z); };
});

await browser.close(); console.log('Done.');
