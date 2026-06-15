import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11'] });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.monsters && window.__game.monsters.length, { timeout: 15000 });

await pg.evaluate(() => {
    const g = window.__game;
    g.player.position.set(0, 0.6, 8);
    g._invincible = 0;
    g.carriedValue = 9999; g._renderTreasureChip();
    window.__downSeen = false;
    const orig = g._playerDown.bind(g);
    g._playerDown = function () { window.__downSeen = true; window.__carriedAtDown = g.carriedValue; return orig(); };
    const m = g.monsters.find(x => x.state === 'alive') || g.monsters[0];
    m.state = 'alive'; m.group.visible = true; m.group.position.set(0.4, 0.15, 8.2); m.home.set(0, 0, 8);
});
// 观察到倒下为止（HP 全掉光）
let res = null;
for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 600));
    res = await pg.evaluate(() => ({
        hp: window.__game.playerHP, carried: window.__game.carriedValue,
        downSeen: window.__downSeen, px: +window.__game.player.position.x.toFixed(1), pz: +window.__game.player.position.z.toFixed(1),
    }));
    if (res.downSeen) break;
}
console.log('倒下触发:', res.downSeen, '| 倒下后 HP=', res.hp, '(应满血) | 携带=', res.carried, '(应清零) | 复活点≈', res.px + ',' + res.pz, '(广场应≈0,6)');
await b.close();
