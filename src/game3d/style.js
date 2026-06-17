// 小女孩造型数据 + localStorage 存档（与渲染引擎解耦，3D / 预览共用）
// 主角是个进入「蛋世界」的小女孩：可换 发色 / 发型 / 裙子颜色 / 肤色 / 头饰

const STORAGE_KEY = 'eggGameStyle';

export const DEFAULT_STYLE = {
    hairColor: '#6b4226',   // 棕
    hairStyle: 'twin',      // 双马尾
    dressColor: '#ff69b4',  // 粉
    skin: '#ffe0c2',        // 白皙
    headwear: 'none',
    eyeColor: '#3a2a22',    // 深棕（不在界面里调，固定一个好看的）
};

// 发色
export const HAIR_COLOR_OPTIONS = [
    { color: '#2b2b33', label: '黑' },
    { color: '#6b4226', label: '棕' },
    { color: '#e8c45a', label: '金' },
    { color: '#9a3b2e', label: '栗红' },
    { color: '#ff9ec4', label: '粉' },
    { color: '#8fb6ff', label: '蓝' },
];

// 发型
export const HAIR_STYLE_OPTIONS = [
    { id: 'twin',   label: '双马尾' },
    { id: 'bun',    label: '丸子头' },
    { id: 'braids', label: '麻花辫' },
    { id: 'short',  label: '短发' },
];

// 裙子 / 衣服颜色
export const DRESS_COLOR_OPTIONS = [
    { color: '#ff69b4', label: '粉' },
    { color: '#ff5a6a', label: '红' },
    { color: '#5aa9ff', label: '蓝' },
    { color: '#ffd24a', label: '黄' },
    { color: '#6fd39a', label: '绿' },
    { color: '#b98cff', label: '紫' },
];

// 肤色
export const SKIN_OPTIONS = [
    { color: '#ffe6cf', label: '白皙' },
    { color: '#f3c9a0', label: '自然' },
    { color: '#d29a6a', label: '小麦' },
];

// 头饰
export const HEADWEAR_OPTIONS = [
    { id: 'none',   label: '无' },
    { id: 'bow',    label: '蝴蝶结' },
    { id: 'flower', label: '小花' },
    { id: 'crown',  label: '皇冠' },
];

export function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

export function loadStyle() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const old = JSON.parse(raw);
            // 旧蛋头存档迁移：bodyColor→dressColor，accessory→headwear（leaf→flower）
            if (old.bodyColor && !old.dressColor) old.dressColor = old.bodyColor;
            if (old.accessory && !old.headwear) {
                old.headwear = old.accessory === 'leaf' ? 'flower' : old.accessory;
            }
            return { ...DEFAULT_STYLE, ...old };
        }
    } catch (e) {}
    return { ...DEFAULT_STYLE };
}

export function saveStyle(style) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
    } catch (e) {}
}
