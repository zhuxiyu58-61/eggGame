import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.bodyMesh, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));
// 第三人称看蛋，触发受击
await pg.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    g.player.position.set(0, 0.6, 8);
    g._invincible = 0;
    g._hurtPlayer(2, 1, 0.3);
});
await new Promise(r => setTimeout(r, 50));
const info = await pg.evaluate(() => {
    const g = window.__game;
    const ov = g._dmgOverlay;
    const rect = ov ? ov.getBoundingClientRect() : null;
    const cs = g.renderer.domElement;
    return {
        overlayComputedOpacity: ov ? getComputedStyle(ov).opacity : 'none',
        overlayRect: rect ? `${rect.width}x${rect.height}` : 'none',
        overlayZ: ov ? getComputedStyle(ov).zIndex : null,
        canvasZ: getComputedStyle(cs).zIndex,
        dmgNum: (g._dmgNumbers || []).length,
        hp: g.playerHP,
    };
});
console.log(JSON.stringify(info));
// 把 overlay 钉成静态(取消动画、固定 0.85)排除截图滞后干扰
await pg.evaluate(() => {
    const ov = window.__game._dmgOverlay;
    ov.getAnimations().forEach(a => a.cancel());
    ov.style.opacity = '0.85';
});
await new Promise(r => setTimeout(r, 100));
await pg.screenshot({ path: `${OUT}\\dmgvis_static.png` });
console.log('static shot saved');
await b.close();
