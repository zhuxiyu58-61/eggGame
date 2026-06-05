// ★ 这里管"小蛋长什么样"：身体颜色、眼睛颜色、头顶装饰
// ★ 捏脸场景和游戏场景共用这里的画法和存档

import { gameConfig } from './config';

const STORAGE_KEY = 'eggGameStyle';

export const DEFAULT_STYLE = {
    bodyColor: gameConfig.playerColor,
    eyeColor: '#2c2c54',
    accessory: 'none',
};

// 6 种身体颜色（粉/蓝/黄/绿/紫/橙）
export const BODY_COLOR_OPTIONS = [
    { color: '#ff69b4', label: '粉' },
    { color: '#7bc4ff', label: '蓝' },
    { color: '#ffe066', label: '黄' },
    { color: '#7ed5a8', label: '绿' },
    { color: '#c8a8ff', label: '紫' },
    { color: '#ffa07a', label: '橙' },
];

// 3 种眼睛颜色（深紫黑/棕/蓝）
export const EYE_COLOR_OPTIONS = [
    { color: '#2c2c54', label: '深紫' },
    { color: '#5a3d1f', label: '棕色' },
    { color: '#1565c0', label: '蓝色' },
];

// 4 种头顶装饰
export const ACCESSORY_OPTIONS = [
    { id: 'none',  label: '无' },
    { id: 'bow',   label: '蝴蝶结' },
    { id: 'leaf',  label: '小芽' },
    { id: 'crown', label: '皇冠' },
];

export function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

export function loadStyle() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return { ...DEFAULT_STYLE, ...JSON.parse(raw) };
    } catch (e) {}
    return { ...DEFAULT_STYLE };
}

export function saveStyle(style) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
    } catch (e) {}
}

// 头顶装饰画在头顶上方（canvas 多留出 0.5r 高度）
function drawAccessory(g, accessory, cx, cy, r) {
    if (accessory === 'bow') {
        const ax = cx, ay = cy - r * 1.1;
        g.fillStyle(0xff3a78, 1);
        g.fillTriangle(ax - r * 0.22, ay - r * 0.18, ax - r * 0.22, ay + r * 0.16, ax, ay);
        g.fillTriangle(ax + r * 0.22, ay - r * 0.18, ax + r * 0.22, ay + r * 0.16, ax, ay);
        g.lineStyle(2, 0x8a1a40, 1);
        g.strokeTriangle(ax - r * 0.22, ay - r * 0.18, ax - r * 0.22, ay + r * 0.16, ax, ay);
        g.strokeTriangle(ax + r * 0.22, ay - r * 0.18, ax + r * 0.22, ay + r * 0.16, ax, ay);
        g.fillStyle(0xff3a78, 1);
        g.fillCircle(ax, ay, r * 0.09);
        g.lineStyle(2, 0x8a1a40, 1);
        g.strokeCircle(ax, ay, r * 0.09);
    } else if (accessory === 'leaf') {
        const ax = cx, ay = cy - r * 1.0;
        g.lineStyle(3, 0x4a8a3a, 1);
        g.beginPath();
        g.moveTo(ax, ay + r * 0.05);
        g.lineTo(ax, ay - r * 0.25);
        g.strokePath();
        g.fillStyle(0x86d96a, 1);
        g.fillEllipse(ax - r * 0.14, ay - r * 0.10, r * 0.22, r * 0.30);
        g.fillEllipse(ax + r * 0.14, ay - r * 0.10, r * 0.22, r * 0.30);
        g.lineStyle(2, 0x4a8a3a, 1);
        g.strokeEllipse(ax - r * 0.14, ay - r * 0.10, r * 0.22, r * 0.30);
        g.strokeEllipse(ax + r * 0.14, ay - r * 0.10, r * 0.22, r * 0.30);
    } else if (accessory === 'crown') {
        const ax = cx, ay = cy - r * 1.0;
        g.fillStyle(0xffd700, 1);
        g.fillRect(ax - r * 0.40, ay + r * 0.08, r * 0.80, r * 0.14);
        g.fillTriangle(ax - r * 0.40, ay + r * 0.08, ax - r * 0.18, ay + r * 0.08, ax - r * 0.29, ay - r * 0.22);
        g.fillTriangle(ax - r * 0.12, ay + r * 0.08, ax + r * 0.12, ay + r * 0.08, ax, ay - r * 0.32);
        g.fillTriangle(ax + r * 0.18, ay + r * 0.08, ax + r * 0.40, ay + r * 0.08, ax + r * 0.29, ay - r * 0.22);
        g.lineStyle(2, 0xa07a00, 1);
        g.strokeRect(ax - r * 0.40, ay + r * 0.08, r * 0.80, r * 0.14);
        g.fillStyle(0xff3a78, 1);
        g.fillCircle(ax, ay + r * 0.15, r * 0.05);
        g.fillStyle(0x86d96a, 1);
        g.fillCircle(ax - r * 0.22, ay + r * 0.15, r * 0.04);
        g.fillCircle(ax + r * 0.22, ay + r * 0.15, r * 0.04);
    }
}

function drawNormalFace(g, eyeColor, cx, cy, r) {
    g.fillStyle(0xff5a8a, 0.55);
    g.fillEllipse(cx - r * 0.55, cy + r * 0.18, r * 0.36, r * 0.22);
    g.fillEllipse(cx + r * 0.55, cy + r * 0.18, r * 0.36, r * 0.22);
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(cx - r * 0.32, cy - r * 0.12, r * 0.46, r * 0.56);
    g.fillEllipse(cx + r * 0.32, cy - r * 0.12, r * 0.46, r * 0.56);
    g.fillStyle(eyeColor, 1);
    g.fillEllipse(cx - r * 0.30, cy - r * 0.05, r * 0.26, r * 0.36);
    g.fillEllipse(cx + r * 0.34, cy - r * 0.05, r * 0.26, r * 0.36);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - r * 0.36, cy - r * 0.18, r * 0.08);
    g.fillCircle(cx + r * 0.28, cy - r * 0.18, r * 0.08);
    g.fillCircle(cx - r * 0.22, cy + r * 0.02, r * 0.04);
    g.fillCircle(cx + r * 0.40, cy + r * 0.02, r * 0.04);
    g.lineStyle(3, 0x2c2c54, 1);
    g.beginPath();
    g.arc(cx, cy + r * 0.28, r * 0.20, 0, Math.PI, false);
    g.strokePath();
    g.fillStyle(0xff5a8a, 0.7);
    g.fillCircle(cx - r * 0.22, cy + r * 0.30, r * 0.04);
    g.fillCircle(cx + r * 0.22, cy + r * 0.30, r * 0.04);
}

function drawSurpriseFace(g, eyeColor, cx, cy, r) {
    g.fillStyle(0xff5a8a, 0.55);
    g.fillEllipse(cx - r * 0.55, cy + r * 0.18, r * 0.36, r * 0.22);
    g.fillEllipse(cx + r * 0.55, cy + r * 0.18, r * 0.36, r * 0.22);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - r * 0.32, cy - r * 0.08, r * 0.28);
    g.fillCircle(cx + r * 0.32, cy - r * 0.08, r * 0.28);
    g.fillStyle(eyeColor, 1);
    g.fillCircle(cx - r * 0.32, cy - r * 0.05, r * 0.10);
    g.fillCircle(cx + r * 0.32, cy - r * 0.05, r * 0.10);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - r * 0.36, cy - r * 0.12, r * 0.05);
    g.fillCircle(cx + r * 0.28, cy - r * 0.12, r * 0.05);
    g.fillStyle(0x2c2c54, 1);
    g.fillEllipse(cx, cy + r * 0.34, r * 0.18, r * 0.22);
    g.fillStyle(0xff5a8a, 0.85);
    g.fillEllipse(cx, cy + r * 0.36, r * 0.11, r * 0.15);
}

function drawHappyFace(g, eyeColor, cx, cy, r) {
    g.fillStyle(0xff3a78, 0.75);
    g.fillEllipse(cx - r * 0.55, cy + r * 0.18, r * 0.42, r * 0.26);
    g.fillEllipse(cx + r * 0.55, cy + r * 0.18, r * 0.42, r * 0.26);
    g.lineStyle(4, eyeColor, 1);
    g.beginPath();
    g.arc(cx - r * 0.32, cy - r * 0.05, r * 0.22, Math.PI, Math.PI * 2, false);
    g.strokePath();
    g.beginPath();
    g.arc(cx + r * 0.32, cy - r * 0.05, r * 0.22, Math.PI, Math.PI * 2, false);
    g.strokePath();
    g.lineStyle(3, 0x2c2c54, 1);
    g.beginPath();
    g.arc(cx, cy + r * 0.26, r * 0.28, 0, Math.PI, false);
    g.strokePath();
    g.fillStyle(0xff5a8a, 0.85);
    g.fillEllipse(cx, cy + r * 0.40, r * 0.22, r * 0.10);
}

// canvas 2r×2.5r：上面 0.5r 留给装饰，下面 2r 是头身
// 物理圆需要对应 setCircle(r, 0, r*0.5)
function drawEggWithStyle(scene, key, style, r, expression) {
    if (scene.textures.exists(key)) scene.textures.remove(key);

    const canvasW = r * 2;
    const canvasH = r * 2.5;
    const cx = r;
    const cy = r * 1.5;
    const bodyColor = hexToInt(style.bodyColor);
    const eyeColor = hexToInt(style.eyeColor);

    const g = scene.add.graphics();

    g.fillStyle(bodyColor, 1);
    g.fillCircle(cx, cy, r);

    g.fillStyle(0xffffff, 0.35);
    g.fillEllipse(cx - r * 0.25, cy - r * 0.55, r * 0.55, r * 0.30);

    g.lineStyle(3, 0xffffff, 1);
    g.strokeCircle(cx, cy, r);

    if (expression === 'surprise') drawSurpriseFace(g, eyeColor, cx, cy, r);
    else if (expression === 'happy') drawHappyFace(g, eyeColor, cx, cy, r);
    else drawNormalFace(g, eyeColor, cx, cy, r);

    drawAccessory(g, style.accessory, cx, cy, r);

    g.generateTexture(key, canvasW, canvasH);
    g.destroy();
}

export function drawCuteEgg(scene, key, style, r) {
    drawEggWithStyle(scene, key, style, r, 'normal');
}

export function drawSurprisedEgg(scene, key, style, r) {
    drawEggWithStyle(scene, key, style, r, 'surprise');
}

export function drawHappyEgg(scene, key, style, r) {
    drawEggWithStyle(scene, key, style, r, 'happy');
}
