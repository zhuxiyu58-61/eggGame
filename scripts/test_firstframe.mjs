import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.EGG_URL || 'http://localhost:8080/';
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720', '--ignore-gpu-blocklist'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { const t = m.text(); if (t.startsWith('[PERF]') || t.startsWith('[FRAME]')) console.log(t); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.evaluateOnNewDocument(() => {
    window.__PERF__ = true;
    // 逐帧计时：抓异常大的首帧/合成帧
    window.__frameLog = [];
    let last = 0;
    const loop = () => { const n = performance.now(); if (last) window.__frameLog.push(+(n - last).toFixed(1)); last = n; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
});
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('#start-btn', { timeout: 10000 });

const result = await page.evaluate(async () => {
    const t0 = performance.now();
    window.__frameLog.length = 0;
    document.getElementById('start-btn').click();
    await new Promise(res => {
        const check = () => { if (window.__game && (window.__game._frames || 0) >= 8) res(); else requestAnimationFrame(check); };
        check();
    });
    return { total: +(performance.now() - t0).toFixed(0), ctor: +(window.__ctorMs || 0).toFixed(0), frames: window.__frameLog.slice(0, 12) };
});
console.log(`[click→8 frames] ${result.total}ms  (ctor freeze ${result.ctor}ms)`);
console.log(`[frame gaps ms] ${result.frames.join(', ')}`);

await new Promise(r => setTimeout(r, 5000));
await browser.close();
