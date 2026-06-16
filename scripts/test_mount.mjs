import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.EGG_URL || 'http://localhost:8099/';
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text()); });
await page.evaluateOnNewDocument(() => { window.__SKIP_WARMUP__ = true; });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn'); await page.click('#start-btn');
await page.waitForFunction(() => window.__game && window.__game.magicBird, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));

// 1) 关门状态：栅栏应升起 + 力场屏障可见
await page.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    g.extractPhase = 'closed'; g.extractPhaseTimer = 30;
});
await new Promise(r => setTimeout(r, 600));
const closed = await page.evaluate(() => {
    const g = window.__game;
    return { fenceY: +g.extractFence.position.y.toFixed(2), barrier: +g._fenceBarrier.material.opacity.toFixed(2) };
});
console.log('关门:', JSON.stringify(closed), closed.fenceY > -0.3 && closed.barrier > 0.05 ? 'OK(栅栏升起)' : 'FAIL');

// 2) 开窗 → 大鸟到达落地 → 栅栏应落下
await page.evaluate(() => {
    const g = window.__game;
    g.extractPhase = 'closed'; g.extractPhaseTimer = 0.01;
    g.monsters.forEach(m => { m.state = 'ko'; m.group.visible = false; m.respawnT = 999; });
});
await page.waitForFunction(() => window.__game._birdState === 'landed', { timeout: 8000 });
await new Promise(r => setTimeout(r, 700));
const open = await page.evaluate(() => {
    const g = window.__game;
    return { phase: g.extractPhase, bird: g._birdState, fenceY: +g.extractFence.position.y.toFixed(2) };
});
console.log('开门:', JSON.stringify(open), open.fenceY < -0.4 ? 'OK(栅栏落下)' : 'FAIL');

// 3) 走到大鸟旁 → _canMount + 按钮显示
await page.evaluate(() => {
    const g = window.__game;
    g.carriedValue = 12000; g._renderTreasureChip();
    g.player.position.set(25, 0.6, 35.5);
});
await new Promise(r => setTimeout(r, 400));
const near = await page.evaluate(() => {
    const g = window.__game;
    const btn = document.getElementById('mount-bird-btn');
    return { canMount: g._canMount, btnVisible: btn && btn.style.display === 'block' };
});
console.log('靠近:', JSON.stringify(near), near.canMount && near.btnVisible ? 'OK(按钮弹出)' : 'FAIL');

// 4) 骑上大鸟 → 起飞结算
const before = await page.evaluate(() => window.__game.bankedTotal);
await page.evaluate(() => window.__game._mountBird());
const mounting = await page.evaluate(() => window.__game._extractMounted);
console.log('骑上:', mounting ? 'OK(mounted)' : 'FAIL');
let done = false;
for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ m: window.__game._extractMounted, b: window.__game._birdState, t: +window.__game._birdT.toFixed(2) }));
    if (!st.m && st.b === 'away') { done = true; break; }
    if (i % 5 === 0) console.log(`  ...飞行中 t=${st.t} state=${st.b}`);
    await new Promise(r => setTimeout(r, 500));
}
console.log('降落:', done ? 'OK' : 'FAIL(超时)');
const after = await page.evaluate(() => {
    const g = window.__game;
    return { banked: g.bankedTotal, carried: g.carriedValue, phase: g.extractPhase, py: +g.player.position.y.toFixed(2) };
});
console.log('结算:', JSON.stringify(after), (after.banked - before === 12000 && after.carried === 0 && after.phase === 'closed') ? 'OK(入库+回到地面)' : 'FAIL');

await browser.close();
console.log('Done.');
