import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8087/';
const OUT = 'D:\\IdeProject\\egg-game\\.claude\\worktrees\\egg-next\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn'); await page.click('#start-btn');
await page.waitForFunction(() => window.__game && window.__game.magicBird, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));

// 1) 关键字段
const cfg = await page.evaluate(() => {
    const g = window.__game;
    return { winGoal: g.extractWinGoal, standNeed: g.extractStandNeed, banked: g.bankedTotal, birdState: g._birdState, hasRunes: !!g.extractRunes };
});
console.log('config:', JSON.stringify(cfg));

// 2) 强制开窗口 → 大鸟到达，截图魔法阵+鸟
await page.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    g.extractPhase = 'closed'; g.extractPhaseTimer = 0.01;   // 立刻开窗
    g.player.position.set(25, 0.6, 41);                      // 站魔法阵旁
    g._restoreCam = g._restoreCam || g._updateCamera;
    g._updateCamera = function () { this.camera.position.set(25, 6, 48); this.camera.lookAt(25, 2, 35); };
});
await new Promise(r => setTimeout(r, 3500));   // 让鸟飞到（arriving ~3s）
const s1 = await page.evaluate(() => ({ phase: window.__game.extractPhase, bird: window.__game._birdState }));
console.log('开窗后:', JSON.stringify(s1));
await page.screenshot({ path: `${OUT}\\extract_bird_landed.png`, clip: { x: 340, y: 60, width: 600, height: 560 } });

// 3) 站进阵里撤离（先清掉守门怪，传送到中心，跑 6 秒站满 5s）
await page.evaluate(() => {
    const g = window.__game;
    g.monsters.forEach(m => { m.state = 'ko'; m.group.visible = false; m.respawnT = 999; });
    g.player.position.set(25, 0.6, 35);
    g.carriedValue = 12000; g._renderTreasureChip();
});
await new Promise(r => setTimeout(r, 6000));
const s2 = await page.evaluate(() => ({ banked: window.__game.bankedTotal, carried: window.__game.carriedValue, bird: window.__game._birdState }));
console.log('撤离后:', JSON.stringify(s2));

// 4) 受击反馈：扣血看 -N 数字 + 红屏 overlay
await page.evaluate(() => {
    const g = window.__game;
    g._invincible = 0;
    g._hurtPlayer(2, 1, 0);
});
await new Promise(r => setTimeout(r, 250));
const hurt = await page.evaluate(() => ({
    dmgNumbers: (window.__game._dmgNumbers || []).length,
    overlay: !!window.__game._dmgOverlay,
    hurtFlashT: window.__game._hurtFlashT,
    hp: window.__game.playerHP,
}));
console.log('受击:', JSON.stringify(hurt));

await browser.close();
console.log('Done.');
