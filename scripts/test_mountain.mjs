import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11'] });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.obstacles, { timeout: 15000 });

const r = await pg.evaluate(() => {
    const g = window.__game;
    // 远景山的碰撞盒：在半径 120+ 处、且较高(max.y>5)
    const mts = g.obstacles.filter(o => {
        const cx = (o.min.x + o.max.x) / 2, cz = (o.min.z + o.max.z) / 2;
        return Math.hypot(cx, cz) > 115 && o.max.y > 5;
    });
    const tests = [];
    for (const o of mts.slice(0, 4)) {
        const cx = (o.min.x + o.max.x) / 2, cz = (o.min.z + o.max.z) / 2;
        const boxR = (o.max.x - o.min.x) / 2;
        // 从山外朝山心走，每帧 0.3m，看停在离心多远
        const dirx = -cx / Math.hypot(cx, cz), dirz = -cz / Math.hypot(cx, cz);
        let sx = cx - dirx * (boxR + 6), sz = cz - dirz * (boxR + 6);
        g.player.position.set(sx, 0.6, sz);
        for (let f = 0; f < 60; f++) {
            g.player.position.x += dirx * 0.3; g.player.position.z += dirz * 0.3;
            g._resolveObstacleCollisions();
        }
        const stopDist = Math.hypot(g.player.position.x - cx, g.player.position.z - cz);
        tests.push({ boxR: +boxR.toFixed(1), stopDist: +stopDist.toFixed(1), blocked: stopDist > boxR - 1 });
    }
    return { mountainObstacles: mts.length, tests };
});
console.log('远景山碰撞盒数量:', r.mountainObstacles);
r.tests.forEach((t, i) => console.log(`  #${i} 盒半径${t.boxR} 停在离心${t.stopDist}m 被挡=${t.blocked}`));
await b.close();
