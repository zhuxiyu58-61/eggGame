import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11'],
});
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('c:' + m.text().slice(0, 140)); });

const press = (code) => pg.evaluate((c) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
}, code);

try {
    await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 15000 });
    await pg.click('#start-btn');
    await pg.waitForFunction(() => window.__game && window.__game.player, { timeout: 15000 });

    // 造两颗宝石进 gemBag（模拟开箱拾取）
    await pg.evaluate(() => {
        const g = window.__game;
        g._recordGem({ name: '稀有宝石', emoji: '🔵', value: 5000 });
        g._recordGem({ name: '稀有宝石', emoji: '🔵', value: 5000 });
        g._recordGem({ name: '传说宝石', emoji: '⭐', value: 50000 });
        // 塞几个可卖道具进背包
        g._addToInventory('🐟'); g._addToInventory('🐟'); g._addToInventory('🥾');
        g.carriedValue = 12000; g._renderTreasureChip();
    });

    // 1) 打开仓库（I 键）
    await press('KeyI');
    await new Promise(r => setTimeout(r, 300));
    const bag = await pg.evaluate(() => {
        const el = document.getElementById('bag-overlay');
        if (!el) return null;
        const t = el.innerText;
        return {
            hasGem: t.includes('稀有宝石') && t.includes('传说宝石'),
            hasGemCount: t.includes('×2'),
            hasItem: t.includes('小鱼') || t.includes('破鞋'),
            hasCarried: t.includes('12,000'),
        };
    });

    // 关仓库
    await press('KeyI');
    await new Promise(r => setTimeout(r, 200));
    const bagClosed = await pg.evaluate(() => !document.getElementById('bag-overlay'));

    // 2) 打开商店：把玩家挪到商店旁再按 B
    await pg.evaluate(() => {
        const g = window.__game;
        g.player.position.set(g._shopPos.x, g.player.position.y, g._shopPos.z - 2);
    });
    await press('KeyB');
    await new Promise(r => setTimeout(r, 300));
    const shopBuy = await pg.evaluate(() => {
        const el = document.getElementById('shop-overlay');
        return el ? { open: true, hasBuyTab: !!el.querySelector('#shop-tab-buy'), hasSellTab: !!el.querySelector('#shop-tab-sell') } : { open: false };
    });

    // 切到卖页并卖一条鱼
    let sellResult = null;
    if (shopBuy.open) {
        await pg.evaluate(() => document.getElementById('shop-tab-sell').click());
        await new Promise(r => setTimeout(r, 200));
        const goldBefore = await pg.evaluate(() => window.__game.carriedValue);
        const invBefore = await pg.evaluate(() => window.__game.inventory.filter(e => e === '🐟').length);
        // 点第一个卖出按钮
        await pg.evaluate(() => {
            const btns = document.querySelectorAll('#shop-list button');
            if (btns[0]) btns[0].click();
        });
        await new Promise(r => setTimeout(r, 200));
        const goldAfter = await pg.evaluate(() => window.__game.carriedValue);
        const invAfter = await pg.evaluate(() => window.__game.inventory.filter(e => e === '🐟').length);
        sellResult = { goldBefore, goldAfter, invBefore, invAfter, gained: goldAfter - goldBefore };
    }

    console.log('=== 仓库 ===', JSON.stringify(bag));
    console.log('仓库关闭:', bagClosed);
    console.log('=== 商店 ===', JSON.stringify(shopBuy));
    console.log('=== 卖出 ===', JSON.stringify(sellResult));
    console.log('报错:', errs.length ? errs.slice(0, 4).join(' | ') : '无');
} catch (e) {
    console.log('测试异常:', e.message);
    console.log('报错:', errs.slice(0, 4).join(' | '));
}
await b.close();
