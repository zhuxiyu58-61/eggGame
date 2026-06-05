// 测帧时间脚本——驱动 Chrome 加载游戏，记录 30 秒内每帧的 frame time
// 目的：定位"开局走着卡、走一段后顺滑"的具体卡帧时长和位置
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8081/';
const RECORD_SECONDS = 30;

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--enable-features=Vulkan',
        '--use-angle=d3d11',
        '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
// 收集 console 报错
page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
        console.log(`[browser ${msg.type()}]`, msg.text().slice(0, 200));
    }
});
page.on('pageerror', err => console.log('[pageerror]', err.message));

console.log(`Loading ${URL}...`);
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
console.log(`Loaded in ${Date.now() - t0}ms`);

// 等待捏脸面板出现并点"开始 3D 冒险"，绕过去直接进游戏
await page.waitForSelector('#start-btn', { timeout: 10000 });
console.log('Customize panel ready, clicking start...');
await page.click('#start-btn');

// 给 _warmup() 留点时间跑完
await new Promise(r => setTimeout(r, 1500));

// 注入帧时间记录器
await page.evaluate((seconds) => {
    window.__perfData = { frames: [], stalls: [] };
    let last = performance.now();
    const startAt = last;
    const endAt = last + seconds * 1000;

    function tick() {
        const now = performance.now();
        const dt = now - last;
        last = now;
        window.__perfData.frames.push(dt);
        if (dt > 50) window.__perfData.stalls.push({ at: Math.round(now - startAt), dt: Math.round(dt) });
        if (now < endAt) requestAnimationFrame(tick);
        else window.__perfDone = true;
    }
    requestAnimationFrame(tick);
}, RECORD_SECONDS);

// 模拟按 W 走 20 秒
console.log(`Simulating walking forward for ${RECORD_SECONDS}s...`);
await page.keyboard.down('w');
await new Promise(r => setTimeout(r, RECORD_SECONDS * 1000));
await page.keyboard.up('w');

// 等记录器报完
await page.waitForFunction(() => window.__perfDone === true, { timeout: 5000 });

const data = await page.evaluate(() => window.__perfData);

// 分析
const frames = data.frames;
const sorted = [...frames].sort((a, b) => a - b);
const avg = frames.reduce((s, x) => s + x, 0) / frames.length;
const p50 = sorted[Math.floor(sorted.length * 0.5)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];
const p99 = sorted[Math.floor(sorted.length * 0.99)];
const max = sorted[sorted.length - 1];

// 按 5 秒分桶看 avg 是否随时间下降
const bucketSize = Math.floor(frames.length / 6);
const buckets = [];
for (let i = 0; i < 6; i++) {
    const slice = frames.slice(i * bucketSize, (i + 1) * bucketSize);
    const a = slice.reduce((s, x) => s + x, 0) / slice.length;
    buckets.push(a);
}

console.log('\n=== 帧时间统计（ms，越小越好；60fps=16.7） ===');
console.log(`总帧数: ${frames.length}, 平均FPS: ${(1000 / avg).toFixed(1)}`);
console.log(`avg=${avg.toFixed(1)} p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} p99=${p99.toFixed(1)} max=${max.toFixed(1)}`);
console.log('\n=== 每 5 秒平均帧时间 ===');
buckets.forEach((b, i) => console.log(`${i * 5}-${(i + 1) * 5}s: avg ${b.toFixed(1)}ms (FPS ${(1000 / b).toFixed(0)})`));
console.log('\n=== 长卡帧（>50ms）===');
if (data.stalls.length === 0) {
    console.log('无');
} else {
    data.stalls.slice(0, 20).forEach(s => console.log(`  ${s.at}ms 时刻: 卡了 ${s.dt}ms`));
    if (data.stalls.length > 20) console.log(`  ...还有 ${data.stalls.length - 20} 次`);
}

await browser.close();
