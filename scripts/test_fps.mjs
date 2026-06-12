// 简易帧率采样：开局站定 5s + 自动走动 10s，统计平均/p95 frame time
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080/';

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

await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const loop = () => {
        const now = performance.now();
        window.__frames.push(now - last);
        last = now;
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
});

// 站定 5 秒
await new Promise(r => setTimeout(r, 5000));
// 模拟走动 10 秒（按住 W，途中转向）
await page.keyboard.down('w');
for (let i = 0; i < 5; i++) {
    await page.keyboard.down('d');
    await new Promise(r => setTimeout(r, 1000));
    await page.keyboard.up('d');
    await new Promise(r => setTimeout(r, 1000));
}
await page.keyboard.up('w');

const frames = await page.evaluate(() => window.__frames);
const valid = frames.filter(f => f > 0.1).sort((a, b) => a - b);
const avg = valid.reduce((s, f) => s + f, 0) / valid.length;
const p95 = valid[Math.floor(valid.length * 0.95)];
const p99 = valid[Math.floor(valid.length * 0.99)];
console.log(`frames=${valid.length}  avg=${avg.toFixed(2)}ms (${(1000 / avg).toFixed(0)}fps)  p95=${p95.toFixed(2)}ms  p99=${p99.toFixed(2)}ms`);

await browser.close();
