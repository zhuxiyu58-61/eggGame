import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11'] });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8081/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.mountains && window.__game.mountains.length, { timeout: 15000 });

const r = await pg.evaluate(() => {
    const g = window.__game;
    const PR = 0.6;
    const tests = [];
    // 取 4 座山，从山脚外侧朝山心走，每帧贴坡落地+碰撞，看能爬多高、停在哪
    for (const m of g.mountains.slice(0, 4)) {
        const L = Math.hypot(m.cx, m.cz);
        const dirx = -m.cx / L, dirz = -m.cz / L;               // 朝山心方向
        let sx = m.cx - dirx * (m.rBase + 5), sz = m.cz - dirz * (m.rBase + 5);
        g.player.position.set(sx, PR, sz);
        let maxY = -9;
        for (let f = 0; f < 120; f++) {
            g.player.position.x += dirx * 0.25;
            g.player.position.z += dirz * 0.25;
            // 复刻玩家落地逻辑
            let groundY = PR + g._terrainH(g.player.position.x, g.player.position.z)
                            + g._mountainSlopeH(g.player.position.x, g.player.position.z);
            if (g.player.position.y < groundY) g.player.position.y = groundY;
            g._resolveObstacleCollisions();
            if (g.player.position.y > maxY) maxY = g.player.position.y;
        }
        const stopDist = Math.hypot(g.player.position.x - m.cx, g.player.position.z - m.cz);
        tests.push({
            h: +m.h.toFixed(1),
            cap: +m.cap.toFixed(1),
            peakTop: +(m.h * 0.8).toFixed(1),
            climbedTo: +maxY.toFixed(1),         // 爬到的最高站立高度
            stopDist: +stopDist.toFixed(1),      // 最终离山心多远
            rCap: +(m.rBase * 0.55).toFixed(1),  // 挡峰柱半径
        });
    }
    return { mountains: g.mountains.length, tests };
});
console.log('可踩山数量:', r.mountains);
r.tests.forEach((t, i) => {
    const climbedOK = t.climbedTo > t.cap * 0.6;          // 确实爬上了半山
    const cappedOK = t.climbedTo <= t.cap + PRpad();      // 没翻过 cap（含一个身位余量）
    const blockedOK = t.stopDist >= t.rCap - 0.5;         // 被挡在柱外，没进山心
    console.log(`  #${i} 山高${t.h} cap${t.cap} 峰顶${t.peakTop} | 爬到${t.climbedTo} 停${t.stopDist}m(柱半径${t.rCap}) | 爬上=${climbedOK} 未超cap=${cappedOK} 被挡=${blockedOK}`);
});
function PRpad() { return 0.6 + 0.6; }
await b.close();
