// 把蛋传送到不同位置，截图看相机视角
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8081/';
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

const shots = [
    { name: '01_outside_far',   x:  50, z: 30, comment: '房子南面 10m 外（俯瞰）' },
    { name: '02_at_door',       x:  50, z: 25, comment: '门口外侧' },
    { name: '03_in_doorway',    x:  50, z: 22, comment: '正穿过门洞' },
    { name: '04_inside_front',  x:  50, z: 20, comment: '屋内中前部' },
    { name: '05_inside_back',   x:  50, z: 17, comment: '屋内中后部' },
    { name: '06_inside_corner', x:  47, z: 17, comment: '屋内角落' },
];

for (const s of shots) {
    await page.evaluate((sx, sz) => {
        if (window.__game && window.__game.player) {
            window.__game.player.position.set(sx, 0.6, sz);
            window.__game.velocity = { x: 0, z: 0 };
            window.__game.playerVy = 0;
        }
    }, s.x, s.z);
    // 给相机 lerp 留时间过渡
    await new Promise(r => setTimeout(r, 800));
    const file = `${OUT}\\${s.name}.png`;
    await page.screenshot({ path: file });
    console.log(`[${s.name}] ${s.comment} → ${file}`);
}

await browser.close();
console.log('Done. 截图在 scripts/out/');
