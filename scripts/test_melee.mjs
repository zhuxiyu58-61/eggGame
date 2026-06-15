import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11'] });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.monsters && window.__game.monsters.length, { timeout: 15000 });

const r = await pg.evaluate(() => {
    const g = window.__game;
    g.player.position.set(0, 0.6, 8);
    const m = g.monsters.find(x => x.state === 'alive') || g.monsters[0];
    m.state = 'alive'; m.group.visible = true; m.group.position.set(1.0, 0.15, 8); // 距离 1.0m，在 1.5 内
    const dist = Math.hypot(m.group.position.x - g.player.position.x, m.group.position.z - g.player.position.z);
    const hp0 = m.hp;
    g._attackCooldown = 0;
    g._doMeleeAttack();   // 第一下
    const hp1 = m.hp;
    g._attackCooldown = 0; g._doMeleeAttack();
    g._attackCooldown = 0; g._doMeleeAttack();
    const hp2 = m.hp, state = m.state;
    return { dist: +dist.toFixed(2), hp0, hp1, hp2, state };
});
console.log(`怪距 ${r.dist}m | 初始HP ${r.hp0} → 一下后 ${r.hp1} → 三下后 ${r.hp2} | 状态 ${r.state}`);
console.log(r.hp1 < r.hp0 ? '✅ J 攻击有效(扣血)' : '❌ J 攻击无效(没扣血)');
await b.close();
