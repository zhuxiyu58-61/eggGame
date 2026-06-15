import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = 'D:\\IdeProject\\egg-game\\.claude\\worktrees\\egg-next\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8087/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.magicBird, { timeout: 15000 });

// 魔法阵 + 大鸟降落：开窗，相机对准阵，等鸟落（软渲染慢，多等）
await pg.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    g.extractPhase = 'closed'; g.extractPhaseTimer = 0.01;
    g.player.position.set(25, 0.6, 42);
    g._restoreCam = g._updateCamera;
    g._updateCamera = function () { this.camera.position.set(25, 5, 50); this.camera.lookAt(25, 2.5, 35); };
});
// 软渲染慢，直接把鸟设为已降落看清
await new Promise(r => setTimeout(r, 2000));
await pg.evaluate(() => { const g = window.__game; g._birdState = 'landed'; });
await new Promise(r => setTimeout(r, 1500));
const st = await pg.evaluate(() => window.__game._birdState);
console.log('bird:', st);
await pg.screenshot({ path: `${OUT}\\shot_bird_pad.png`, clip: { x: 360, y: 70, width: 580, height: 560 } });

// 受击：第三人称看蛋，触发掉血看红屏 + -N
await pg.evaluate(() => {
    const g = window.__game;
    g._updateCamera = g._restoreCam;   // 恢复跟随
    g.player.position.set(0, 0.6, 8);
    g._invincible = 0; g._hurtPlayer(2, 1, 0.3);
});
await new Promise(r => setTimeout(r, 60));
await pg.screenshot({ path: `${OUT}\\shot_hurt.png` });
console.log('Done.');
await b.close();
