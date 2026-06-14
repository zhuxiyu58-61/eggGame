// 雨/雪粒子外观检查
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080/';
const OUT = 'D:\\IdeProject\\egg-game\\scripts\\out';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=1280,720'],
    defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('#start-btn', { timeout: 10000 });
await page.click('#start-btn');
await new Promise(r => setTimeout(r, 2500));

async function shoot(weather, name, phase = 0.5) {
    await page.evaluate((w, ph) => {
        const g = window.__game;
        g.dayPhase = ph; g.dayDuration = 1e9;
        g.weather = w; g.weatherTimer = 9999;
        g.rain.visible = (w === 'rain');
        g.snow.visible = (w === 'snow');
        g.player.position.set(0, 0.6, 8);
        g.velocity = { x: 0, z: 0 }; g.playerVy = 0;
    }, weather, phase);
    // 让粒子动几帧
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: `${OUT}\\${name}.png` });
    console.log(`[${name}]`);
}

await shoot('rain', 'weather_rain_day', 0.5);
await shoot('rain', 'weather_rain_dusk', 0.74);
await shoot('snow', 'weather_snow_day', 0.5);

// 特写：固定相机贴近，看粒子形状（黄昏暗底更清楚）
async function closeup(weather, name) {
    await page.evaluate((w) => {
        const g = window.__game;
        g.dayPhase = 0.7; g.dayDuration = 1e9;
        g.weather = w; g.weatherTimer = 9999;
        g.rain.visible = (w === 'rain'); g.snow.visible = (w === 'snow');
        if (!g._restoreCam) g._restoreCam = g._updateCamera;
        g._updateCamera = function () {
            this.camera.position.set(2, 2, 6);
            this.camera.lookAt(0, 6, -6);
        };
    }, weather);
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: `${OUT}\\${name}.png`, clip: { x: 340, y: 120, width: 600, height: 480 } });
    console.log(`[${name}]`);
}
await closeup('rain', 'weather_rain_closeup');
await closeup('snow', 'weather_snow_closeup');

await browser.close();
console.log('Done.');
