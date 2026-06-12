// 模拟蛋自己走进房子，看 isInsideHouse 切换时机 + 截图
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2000));

// 先把蛋传到门口外面
await page.evaluate(() => {
    window.__game.player.position.set(50, 0.6, 28);
    window.__game.velocity = { x: 0, z: 0 };
});
await new Promise(r => setTimeout(r, 600));

// 步行向北（按 W）+ 每 200ms 记一次位置/inside/相机
const log = [];
await page.evaluate(() => {
    window.__samples = [];
    window.__sampler = setInterval(() => {
        const g = window.__game;
        if (!g || !g.player) return;
        window.__samples.push({
            t: Date.now(),
            x: +g.player.position.x.toFixed(2),
            z: +g.player.position.z.toFixed(2),
            inside: !!g.isInsideHouse,
            camY: +g.camera.position.y.toFixed(2),
            camZ: +g.camera.position.z.toFixed(2),
            offY: +g._camOff.y.toFixed(2),
            offZ: +g._camOff.z.toFixed(2),
        });
    }, 200);
});

await page.keyboard.down('w');
// 走 4 秒
for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const shot = `${OUT}\\walk_${i + 1}s.png`;
    await page.screenshot({ path: shot });
}
await page.keyboard.up('w');

// 拉数据
const samples = await page.evaluate(() => {
    clearInterval(window.__sampler);
    return window.__samples;
});

console.log('time\tx\tz\tinside\tcamY\tcamZ\toffY\toffZ');
samples.forEach(s => {
    console.log(`+${((s.t - samples[0].t) / 1000).toFixed(1)}s\t${s.x}\t${s.z}\t${s.inside}\t${s.camY}\t${s.camZ}\t${s.offY}\t${s.offZ}`);
});

await browser.close();
