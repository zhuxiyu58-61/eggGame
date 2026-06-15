import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--enable-webgl', '--use-angle=d3d11', '--window-size=900,1300'], defaultViewport: { width: 900, height: 1300, hasTouch: true, isMobile: true } });
const p = await b.newPage();
p.on('pageerror', e => console.log('[err]', e.message));
await p.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 }); });
await p.goto('http://localhost:8092/', { waitUntil: 'networkidle2', timeout: 30000 });
await p.waitForSelector('#start-btn', { timeout: 10000 }); await p.click('#start-btn');
await new Promise(r => setTimeout(r, 2600));

const hasUI = await p.evaluate(() => !!window.__game._touchUI);
console.log('触屏 UI 创建:', hasUI);

// 工具:在 _touchUI 上派发触摸事件
await p.evaluate(() => {
    window.__fire = (type, id, x, y) => {
        const ui = window.__game._touchUI;
        const t = new Touch({ identifier: id, target: ui, clientX: x, clientY: y });
        ui.dispatchEvent(new TouchEvent(type, { changedTouches: [t], touches: [t], bubbles: true, cancelable: true }));
    };
});

// 摇杆:左下按下,往上推=前进
const before = await p.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
await p.evaluate(() => { window.__fire('touchstart', 1, 150, 1100); window.__fire('touchmove', 1, 150, 1010); });
const tm = await p.evaluate(() => ({ ...window.__game.touchMove }));
await new Promise(r => setTimeout(r, 900));
const after = await p.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
await p.evaluate(() => window.__fire('touchend', 1, 150, 1010));
const moved = Math.hypot(after.x - before.x, after.z - before.z);
console.log('摇杆 touchMove:', JSON.stringify(tm), '玩家移动距离:', moved.toFixed(2));

// 视角:右半屏拖拽 → yaw 变
const yaw0 = await p.evaluate(() => window.__game.cameraYaw);
await p.evaluate(() => { window.__fire('touchstart', 2, 700, 600); window.__fire('touchmove', 2, 820, 600); window.__fire('touchend', 2, 820, 600); });
const yaw1 = await p.evaluate(() => window.__game.cameraYaw);
console.log('视角 yaw 变化:', (yaw1 - yaw0).toFixed(3));

// 跳:点跳按钮 → playerVy 上冲 或 离地
await p.evaluate(() => { const ui = window.__game._touchUI; const btns = [...ui.children].filter(c => c.textContent.includes('跳')); const btn = btns[0]; const t = new Touch({ identifier: 9, target: btn, clientX: 0, clientY: 0 }); btn.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [t], bubbles: true, cancelable: true })); });
await new Promise(r => setTimeout(r, 120));
const jumped = await p.evaluate(() => ({ vy: window.__game.playerVy, onGround: window.__game.onGround, space: !!window.__game.keys['Space'] }));
console.log('跳跃:', JSON.stringify(jumped));

await p.screenshot({ path: 'D:\\IdeProject\\egg-game\\scripts\\out\\touch_ui.png' });
await b.close(); console.log('done');
