import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.EGG_URL || 'http://localhost:8099/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
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
await page.waitForFunction(() => window.__game && window.__game.monsters, { timeout: 15000 });
await new Promise(r => setTimeout(r, 1200));

// 把玩家挪到很远 → 怪不进 aggro，待在老家原地，正午定格
await page.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    g.player.position.set(0, 0.6, 300);
    // 生一个咬人箱怪用于拍照
    g._mimicShot = g._addMonster(-30, -30, 'mimic');
    // 相机交给手动控制
    g._frozenCam = true;
    g._updateCamera = function () {
        const c = g._camTarget; if (!c) return;
        g.camera.position.set(c.cx, c.cy, c.cz);
        g.camera.lookAt(c.tx, c.ty, c.tz);
    };
});

async function shot(name, getTarget) {
    await page.evaluate((nm) => {
        const g = window.__game;
        g._camTarget = window.__shotTargets[nm];
    }, name);
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}\\char_${name}.png` });
    console.log('shot', name);
}

// 预存各拍摄目标（相机在被摄物 -z 正前方，略高）
await page.evaluate(() => {
    const g = window.__game;
    const front = (mx, my, mz, dist, h, ty) => ({ cx: mx, cy: my + h, cz: mz - dist, tx: mx, ty: my + ty, tz: mz });
    const mon = (t) => { const m = g.monsters.find(x => x.type === t && x.state === 'alive'); return m ? m.group.position : null; };
    const T = {};
    const p = g.player.position; T.player = front(p.x, 0, p.z, 2.8, 1.0, 0.9);
    const dist = { normal: 1.8, fast: 2.2, tank: 2.6, mimic: 2.0 };
    for (const t of ['normal', 'fast', 'tank', 'mimic']) {
        const pos = mon(t);
        if (pos) T[t] = front(pos.x, 0, pos.z, dist[t], 0.7, 0.6);
    }
    window.__shotTargets = T;
});

for (const n of ['player', 'normal', 'fast', 'tank', 'mimic']) await shot(n);

await browser.close();
console.log('Done. -> scripts/out/char_*.png');
