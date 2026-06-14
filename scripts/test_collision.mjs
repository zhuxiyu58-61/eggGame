import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn'); await page.click('#start-btn');
await page.waitForFunction(() => window.__game && window.__game.obstacles, { timeout: 15000 });

const r = await page.evaluate(() => {
    const g = window.__game;
    const props = g.obstacles.filter(o => {
        const w = o.max.x - o.min.x;
        return w > 0.5 && w < 1.4 && o.max.y > 1.5;
    });
    const tests = [];
    for (const o of props.slice(0, 6)) {
        const cx = (o.min.x + o.max.x) / 2, cz = (o.min.z + o.max.z) / 2;
        // 从盒子左侧 3m 外出发，每帧朝 +x 走 0.25m，共 40 帧（模拟走路撞树）
        g.player.position.set(o.min.x - 3, 0.6, cz);
        for (let f = 0; f < 40; f++) {
            g.player.position.x += 0.25;
            g._resolveObstacleCollisions();
        }
        const px = g.player.position.x;
        // 期望：被挡在盒子左面之前，没有穿到右侧
        const passedThrough = px > o.max.x;       // 穿过去了=失败
        const blocked = px <= o.min.x + 0.05;     // 卡在左面前=成功
        tests.push({ minX: +o.min.x.toFixed(2), maxX: +o.max.x.toFixed(2), finalX: +px.toFixed(2), passedThrough, blocked });
    }
    return { propCount: props.length, tests };
});
console.log('细小道具碰撞体数量:', r.propCount);
let ok = 0;
r.tests.forEach((t, i) => {
    console.log(`  #${i} box[${t.minX}~${t.maxX}] 走到 x=${t.finalX} 挡住=${t.blocked} 穿过=${t.passedThrough}`);
    if (t.blocked && !t.passedThrough) ok++;
});
console.log(`挡住 ${ok}/${r.tests.length}`);
await browser.close();
