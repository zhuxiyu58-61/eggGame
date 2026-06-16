// 测量点击「开始3D冒险」到世界构建完成的耗时分解
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.EGG_URL || 'http://localhost:8099/';

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const perfLines = [];
page.on('console', msg => {
    const t = msg.text();
    if (t.startsWith('[PERF]')) { perfLines.push(t); console.log(t); }
});
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluateOnNewDocument(() => { window.__PERF__ = true; });
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('#start-btn', { timeout: 10000 });

await page.click('#start-btn');
// 等构造函数结束（设置了 __ctorMs）——这就是点击后 UI 冻结的真实时长
await page.waitForFunction(() => typeof window.__ctorMs === 'number', { timeout: 60000 });
const ctorMs = await page.evaluate(() => window.__ctorMs);
console.log(`[ctor freeze] ${ctorMs.toFixed(0)}ms (软件渲染，真机 GPU 更快)`);

// 等首帧之后的异步预热打点
await new Promise(r => setTimeout(r, 4000));

await browser.close();
