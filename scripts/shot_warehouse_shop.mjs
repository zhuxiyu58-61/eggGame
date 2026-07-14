import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1000,700'],
});
const pg = await b.newPage();
await pg.setViewport({ width: 1000, height: 700 });
const press = (code) => pg.evaluate((c) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
}, code);
await pg.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 15000 });
await pg.click('#start-btn');
await pg.waitForFunction(() => window.__game && window.__game.player, { timeout: 15000 });
 await pg.waitForFunction(() => !document.getElementById('egg-loading'), { timeout: 60000 });
await pg.evaluate(() => {
    const g = window.__game;
    g._recordGem({ name: '普通宝石', emoji: '⚪', value: 500 });
    g._recordGem({ name: '稀有宝石', emoji: '🔵', value: 5000 });
    g._recordGem({ name: '稀有宝石', emoji: '🔵', value: 5000 });
    g._recordGem({ name: '史诗宝石', emoji: '🟣', value: 15000 });
    g._recordGem({ name: '传说宝石', emoji: '⭐', value: 50000 });
    g._addToInventory('🐟'); g._addToInventory('🐠'); g._addToInventory('🍢'); g._addToInventory('🥾');
    g.carriedValue = 32500; g._renderTreasureChip();
    g.starsCollected = 7;
});
await press('KeyI');
await new Promise(r => setTimeout(r, 400));
await pg.screenshot({ path: 'scripts/shot_bag.png' });
await press('KeyI');
await new Promise(r => setTimeout(r, 200));
await pg.evaluate(() => { const g = window.__game; g.player.position.set(g._shopPos.x, g.player.position.y, g._shopPos.z - 2); });
await press('KeyB');
await new Promise(r => setTimeout(r, 300));
await pg.evaluate(() => document.getElementById('shop-tab-sell').click());
await new Promise(r => setTimeout(r, 200));
await pg.screenshot({ path: 'scripts/shot_shop_sell.png' });
console.log('done');
await b.close();
