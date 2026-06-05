// 小蛋造型数据 + localStorage 存档（与渲染引擎解耦，3D 版直接复用）

const STORAGE_KEY = 'eggGameStyle';

export const DEFAULT_STYLE = {
    bodyColor: '#ff69b4',
    eyeColor: '#2c2c54',
    accessory: 'none',
};

export const BODY_COLOR_OPTIONS = [
    { color: '#ff69b4', label: '粉' },
    { color: '#7bc4ff', label: '蓝' },
    { color: '#ffe066', label: '黄' },
    { color: '#7ed5a8', label: '绿' },
    { color: '#c8a8ff', label: '紫' },
    { color: '#ffa07a', label: '橙' },
];

export const EYE_COLOR_OPTIONS = [
    { color: '#2c2c54', label: '深紫' },
    { color: '#5a3d1f', label: '棕色' },
    { color: '#1565c0', label: '蓝色' },
];

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
