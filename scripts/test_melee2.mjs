import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });
const pg = await b.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.monsters && window.__game.monsters.length, { timeout: 15000 });

const r = await pg.evaluate(() => {
    const g = window.__game;
    g.player.position.set(0, 0.6, 8);
    const m = g.monsters.find(x => x.state === 'alive') || g.monsters[0];
    m.state = 'alive'; m.group.visible = true; m.group.position.set(1.5, 0.15, 8);
    const before = m.group.position.x;
    const distBefore = Math.hypot(m.group.position.x - 0, m.group.position.z - 8);
    g._attackCooldown = 0;
    g._doMeleeAttack();
    const distAfter = Math.hypot(m.group.position.x - 0, m.group.position.z - 8);
    return {
        rangeHit: distBefore < 2.2,
        knockback: +(distAfter - distBefore).toFixed(2),
        swingFx: (g._meleeFx || []).length,
        hitNums: (g._dmgNumbers || []).length,
        mHp: m.hp,
    };
});
console.log(JSON.stringify(r));
console.log('错误:', errs.length ? errs.join(' | ') : '无');
await b.close();
