// 搜打撤验证：金箱/咬人箱/怪物种类/玩家血条/刷新/距离掉落
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageerror]', err.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));

// 1) 统计变体 + 怪物种类分布
const stats = await page.evaluate(() => {
    const g = window.__game;
    g.dayPhase = 0.5; g.dayDuration = 1e9;
    const chest = { golden: 0, mimic: 0, normal: 0, total: g.chests.length };
    g.chests.forEach(c => { if (c.golden) chest.golden++; else if (c.mimic) chest.mimic++; else chest.normal++; });
    const mon = {};
    g.monsters.forEach(m => { mon[m.type] = (mon[m.type] || 0) + 1; });
    // 距离掉落分布：近/远各抽 2000 次看平均价值
    const sample = (dist) => {
        let sum = 0, n = 2000;
        for (let i = 0; i < n; i++) { const it = g._rollLoot(dist); sum += it.value; }
        return Math.round(sum / n);
    };
    return { chest, mon, avgNear: sample(15), avgMid: sample(40), avgFar: sample(70) };
});
console.log('宝箱变体:', JSON.stringify(stats.chest));
console.log('怪物种类:', JSON.stringify(stats.mon));
console.log(`掉落均值 近${stats.avgNear} / 中${stats.avgMid} / 远${stats.avgFar}`);

// 2) 强制把一只箱设为金箱、一只设为咬人箱，传送过去触发，截图
async function shoot(name, setup) {
    await page.evaluate(setup);
    await new Promise(r => setTimeout(r, 1400));
    await page.screenshot({ path: `${OUT}\\${name}.png` });
    console.log(`[${name}]`);
}

// 金箱特写
await shoot('loot_golden', () => {
    const g = window.__game;
    const c = g.chests.find(x => x.state === 'closed') || g.chests[0];
    c.golden = true; c.mimic = false; g._rollChestVariant(c); c.golden = true; g._rollChestVariant(c);
    // 直接强制金箱外观
    c.body.material.color.setHex(0xffcf40); c.lid.material.color.setHex(0xffe070);
    c.golden = true;
    g._restoreCam = g._restoreCam || g._updateCamera;
    g._updateCamera = function () { this.camera.position.set(c.x + 3, 2.2, c.z + 4); this.camera.lookAt(c.x, 1, c.z); };
});

// 怪物种类合影：传送到能看到多只怪的位置
await shoot('loot_monsters', () => {
    const g = window.__game;
    // 把几只不同怪挪到一起拍合影
    const types = ['normal', 'fast', 'tank'];
    let i = 0;
    g.monsters.forEach(m => { if (types.includes(m.type) && i < 3) { m.group.position.set(-3 + i * 3, 0, -6); m.home.set(-3 + i * 3, 0, -6); i++; } });
    g._updateCamera = function () { this.camera.position.set(0, 3, 2); this.camera.lookAt(0, 1, -6); };
});

// 玩家血条：扣两滴血看头顶条
await shoot('loot_player_hp', () => {
    const g = window.__game;
    g.playerHP = 3; g._renderPlayerHP();
    g._updateCamera = function () { const p = g.player.position; this.camera.position.set(p.x, p.y + 2, p.z + 5); this.camera.lookAt(p.x, p.y + 1, p.z); };
});

await browser.close();
console.log('Done.');
