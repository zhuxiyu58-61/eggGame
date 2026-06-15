import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11'] });
const pg = await b.newPage();
pg.on('pageerror', e => console.log('[pageerror]', e.message));
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await pg.waitForSelector('#start-btn'); await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.monsters && window.__game.monsters.length, { timeout: 15000 });

// 把一只 alive 怪挪到蛋正旁边，蛋站着不动，靠真实 tick 让怪来打
await pg.evaluate(() => {
    const g = window.__game;
    g.player.position.set(0, 0.6, 8);
    g._invincible = 0;
    const m = g.monsters.find(x => x.state === 'alive') || g.monsters[0];
    m.state = 'alive'; m.group.visible = true;
    m.group.position.set(0.5, 0.15, 8.5);   // 紧贴玩家
    m.home.set(0, 0, 8);
    window.__hpStart = g.playerHP;
});
// 观察 4 秒，记录 HP 变化 + 是否触发过受击
const log = [];
for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 600));
    const s = await pg.evaluate(() => {
        const g = window.__game;
        const m = g.monsters.find(x => x.state === 'alive');
        return {
            hp: g.playerHP,
            mDist: m ? +Math.hypot(m.group.position.x - g.player.position.x, m.group.position.z - g.player.position.z).toFixed(2) : null,
            mState: m ? m.state : null,
            inHouse: g.isInsideHouse,
            invinc: +(g._invincible || 0).toFixed(2),
            hurtFlash: +(g._hurtFlashT || 0).toFixed(2),
            overlay: !!g._dmgOverlay,
        };
    });
    log.push(s);
}
log.forEach((s, i) => console.log(`${i}: hp=${s.hp} 怪距=${s.mDist} 怪态=${s.mState} 屋内=${s.inHouse} 无敌=${s.invinc} 闪红=${s.hurtFlash} overlay=${s.overlay}`));
console.log('HP 从 5 掉到', log[log.length - 1].hp);
await b.close();
