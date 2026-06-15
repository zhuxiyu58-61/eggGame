import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { loadStyle, hexToInt } from './style';

// 怪物种类：普通紫幽灵 / 快速小怪 / 笨重大怪 / 假宝箱变的咬人怪
const MONSTER_TYPES = {
    normal: { r: 0.40, color: 0x8050a0, hp: 3, speed: 3.5, dmg: 1, knock: 6,  aggro: 10, drop: 0,    label: '幽灵' },
    fast:   { r: 0.27, color: 0xff6488, hp: 2, speed: 5.6, dmg: 1, knock: 4,  aggro: 13, drop: 0,    label: '飞蝠' },
    tank:   { r: 0.62, color: 0x4a7a44, hp: 6, speed: 2.0, dmg: 2, knock: 10, aggro: 9,  drop: 0,    label: '巨怪' },
    mimic:  { r: 0.42, color: 0x8a5a2e, hp: 2, speed: 4.8, dmg: 1, knock: 7,  aggro: 16, drop: 6000, label: '咬人箱' },
};

// 卡通描边：反向法线 + 略放大；颜色 = 物体自身色压暗（不再用统一深紫，避免突兀）
const OUTLINE_THICK = 0.035;
function darkenHex(hex, factor = 0.45) {
    const r = Math.round(((hex >> 16) & 0xff) * factor);
    const g = Math.round(((hex >> 8) & 0xff) * factor);
    const b = Math.round((hex & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
}
function addOutline(mesh, thickness = OUTLINE_THICK, sourceColor = null) {
    let color;
    if (sourceColor != null) {
        color = darkenHex(sourceColor, 0.38);
    } else if (mesh.material && mesh.material.color) {
        color = darkenHex(mesh.material.color.getHex(), 0.38);
    } else {
        color = 0x222233;
    }
    const outline = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
    );
    outline.scale.set(1 + thickness, 1 + thickness, 1 + thickness);
    mesh.add(outline);
}

// ===== 纹理生成器（CanvasTexture，零外部素材依赖）=====
function makeGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8fcf8f';
    ctx.fillRect(0, 0, 512, 512);
    // 大块明暗起伏（柔和大斑，打底层次）
    for (let i = 0; i < 26; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        const r = 30 + Math.random() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const tone = Math.random() > 0.5 ? '125,190,125' : '155,215,150';
        g.addColorStop(0, `rgba(${tone},0.35)`);
        g.addColorStop(1, `rgba(${tone},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 深绿斑块
    ctx.fillStyle = '#6cb56c';
    for (let i = 0; i < 320; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        const r = 4 + Math.random() * 14;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 亮绿点
    ctx.fillStyle = '#aae5aa';
    for (let i = 0; i < 260; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        const r = 3 + Math.random() * 6;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 草叶短笔触（顺势小竖线，远看是茸茸质感）
    ctx.strokeStyle = 'rgba(90,150,90,0.5)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 420; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        const len = 3 + Math.random() * 5;
        const lean = (Math.random() - 0.5) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + lean, y - len);
        ctx.stroke();
    }
    // 野花碎点（黄/白/粉）
    const flowerColors = ['#ffd966', '#ffffff', '#ffb6c1'];
    for (let i = 0; i < 160; i++) {
        ctx.fillStyle = flowerColors[i % 3];
        const x = Math.random() * 512, y = Math.random() * 512;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(22, 22);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// 三阶赛璐璐光影 ramp：暗部/中间调/亮部，所有 MeshToonMaterial 共享
function makeToonRampTexture() {
    const data = new Uint8Array([
        128, 128, 128, 255,   // 暗部 50%
        198, 198, 198, 255,   // 中间调 78%
        255, 255, 255, 255,   // 亮部
    ]);
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
}

// 雪地：冷白底 + 蓝灰起伏阴影 + 风吹雪痕 + 细碎亮晶
function makeSnowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f2f6fc';
    ctx.fillRect(0, 0, 512, 512);
    // 蓝灰柔和起伏（雪面的明暗，像被风堆出来的）
    for (let i = 0; i < 34; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        const r = 25 + Math.random() * 55;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const tone = Math.random() > 0.5 ? '198,212,232' : '255,255,255';
        g.addColorStop(0, `rgba(${tone},0.30)`);
        g.addColorStop(1, `rgba(${tone},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 风吹雪痕（淡淡的长弧线）
    ctx.strokeStyle = 'rgba(210,222,240,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        const len = 30 + Math.random() * 70;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + len / 2, y - 4 - Math.random() * 6, x + len, y);
        ctx.stroke();
    }
    // 细碎亮晶点
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 110; i++) {
        const x = Math.random() * 512, y = Math.random() * 512;
        ctx.fillRect(x, y, 1.3, 1.3);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 5.5);  // 160x60 的雪原，保持纹理接近方形
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// 冰面：浅青底 + 放射白裂纹 + 半透明白斑 + 深处暗蓝
function makeIceTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const base = ctx.createRadialGradient(128, 128, 10, 128, 128, 150);
    base.addColorStop(0, '#cdeefa');
    base.addColorStop(0.6, '#aadcee');
    base.addColorStop(1, '#8cc4dd');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    // 深处暗蓝团（冰下的湖水）
    for (let i = 0; i < 8; i++) {
        const x = 40 + Math.random() * 176, y = 40 + Math.random() * 176;
        const r = 15 + Math.random() * 30;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(70,120,165,0.30)');
        g.addColorStop(1, 'rgba(70,120,165,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 白裂纹：从随机点放射出折线
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 9; i++) {
        let x = 30 + Math.random() * 196, y = 30 + Math.random() * 196;
        let ang = Math.random() * Math.PI * 2;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const segs = 4 + Math.floor(Math.random() * 4);
        for (let s = 0; s < segs; s++) {
            ang += (Math.random() - 0.5) * 1.2;
            const len = 12 + Math.random() * 22;
            x += Math.cos(ang) * len; y += Math.sin(ang) * len;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
        // 分叉细纹
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
        ctx.stroke();
    }
    // 半透明白斑（雪粘在冰上）
    for (let i = 0; i < 12; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const r = 8 + Math.random() * 18;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(245,250,255,0.55)');
        g.addColorStop(1, 'rgba(245,250,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// 雪花贴图：柔和圆芯 + 六角淡芒（贴在 Points 上，消除方块感）
function makeSnowflakeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    // 柔和圆芯
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0,   'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    // 六角淡芒
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(32, 32);
        ctx.lineTo(32 + Math.cos(a) * 26, 32 + Math.sin(a) * 26);
        ctx.stroke();
    }
    return new THREE.CanvasTexture(canvas);
}

// 湖面碎波光：细小白色短横线，平铺后缓慢流动 + additive 叠加
function makeLakeGlintTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 38; i++) {
        const x = Math.random() * 128, y = Math.random() * 128;
        const w = 3 + Math.random() * 8;
        const a = 0.25 + Math.random() * 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = 1 + Math.random();
        ctx.beginPath();
        ctx.moveTo(x - w / 2, y);
        ctx.lineTo(x + w / 2, y);
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
}

function makeCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0,   'rgba(255,255,255,0.95)');
    g.addColorStop(0.55,'rgba(255,255,255,0.45)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

function makeBubbleTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 112;
    const ctx = canvas.getContext('2d');
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(12, 18, 360, 72, 18); ctx.fill();
    } else {
        ctx.fillRect(12, 18, 360, 72);
    }
    // 羊皮纸底（亮度低于 bloom 阈值 0.72，避免被发光晕染糊掉文字）
    const bubbleBg = '#b8ad94';
    ctx.fillStyle = bubbleBg;
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(8, 14, 360, 68, 18); ctx.fill();
    } else {
        ctx.fillRect(8, 14, 360, 68);
    }
    // 边框
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 4;
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(8, 14, 360, 68, 18); ctx.stroke();
    } else {
        ctx.strokeRect(8, 14, 360, 68);
    }
    // 气泡小尖（下边中间）
    ctx.fillStyle = bubbleBg;
    ctx.beginPath();
    ctx.moveTo(178, 82);
    ctx.lineTo(192, 102);
    ctx.lineTo(206, 82);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(178, 82);
    ctx.lineTo(192, 102);
    ctx.lineTo(206, 82);
    ctx.stroke();
    // 文字（深色 + 粗体，羊皮纸底上对比足够）
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 28px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 192, 48);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function makeSignTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 288; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    // 木牌底
    ctx.fillStyle = '#c89868';
    ctx.fillRect(0, 0, 288, 96);
    // 木纹
    ctx.strokeStyle = '#a67a4a';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
        const y = 14 + i * 22;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(288, y + 4); ctx.stroke();
    }
    // 边框
    ctx.strokeStyle = '#5a3a1a';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 282, 90);
    // 字
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 38px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 144, 48);
    ctx.fillText(text, 144, 48);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function makeButterflyTexture(colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    // 4 翅膀
    const wings = [[20,22,15,17,-0.3],[44,22,15,17,0.3],[22,42,11,13,0.4],[42,42,11,13,-0.4]];
    wings.forEach(([cx,cy,rx,ry,rot]) => {
        ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot);
        ctx.beginPath(); ctx.ellipse(0,0,rx,ry,0,0,Math.PI*2);
        ctx.fill(); ctx.stroke(); ctx.restore();
    });
    // 身体
    ctx.fillStyle = '#2c2c54';
    ctx.fillRect(30, 16, 4, 34);
    // 触角
    ctx.strokeStyle = '#2c2c54';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(32,16); ctx.lineTo(28,8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(32,16); ctx.lineTo(36,8); ctx.stroke();
    return new THREE.CanvasTexture(canvas);
}

const PLAYER_RADIUS = 0.6;
const GRAVITY = 28;
const JUMP_SPEED = 11;
const MOVE_SPEED = 8;
const ACCEL = 32;   // 加速度（按键后渐入满速，不再瞬时启停）
const DECEL = 40;   // 减速度（松键渐出，不再瞬时刹停）

export class Game3D {
    constructor(container, { onOpenCustomize } = {}) {
        if (typeof window !== 'undefined') window.__game = this; // 调试用：控制台/测试可以 window.__game.player.position.set(...)
        this.container = container;
        this.onOpenCustomize = onOpenCustomize;
        this.style = loadStyle();
        this.keys = {};
        this.dying = false;
        this.won = false;
        this.playerVy = 0;
        this.onGround = true;
        this.obstacles = [];
        this.spikes = [];
        this.goals = [];

        const _ctor0 = performance.now();
        this._initThree();
        this._buildWorld();
        this._buildPlayer();
        this._setupInput();
        this._setupStatusUI();

        this._onResize = this._onResize.bind(this);
        window.addEventListener('resize', this._onResize);

        // 预编译所有 shader（消除游戏中途首次触发某材质的编译掉帧）+ 上传所有 texture
        this._warmup();
        if (typeof window !== 'undefined') window.__ctorMs = performance.now() - _ctor0;

        this.clock = new THREE.Clock();
        this._tick = this._tick.bind(this);
        this.animId = requestAnimationFrame(this._tick);
    }

    _warmup() {
        // 1) 预生成每类"动态粒子"各一颗（强制其 shader 进入编译队列）
        const dummies = [];
        const addDummy = (mesh) => {
            mesh.position.set(0, -100, 0);  // 远离视野
            this.scene.add(mesh);
            dummies.push(mesh);
        };
        // 落地粒子
        addDummy(new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 6, 4),
            new THREE.MeshBasicMaterial({ color: 0xa8e3a8, transparent: true, opacity: 0.8 })
        ));
        // 烟囱烟
        addDummy(new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xe8e8ec, transparent: true, opacity: 0.7, depthWrite: false })
        ));
        // 烟花/拾取星（MeshStandardMaterial + emissive）
        addDummy(new THREE.Mesh(
            new THREE.OctahedronGeometry(0.22),
            new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.5 })
        ));
        // 脚印（CircleGeometry transparent）
        const fp = new THREE.Mesh(
            new THREE.CircleGeometry(0.18, 12),
            new THREE.MeshBasicMaterial({ color: 0x4a8a3a, transparent: true, opacity: 0.4, depthWrite: false })
        );
        fp.rotation.x = -Math.PI / 2;
        addDummy(fp);
        // 流星头/尾
        addDummy(new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 12, 10),
            new THREE.MeshStandardMaterial({ color: 0xfff5a0, emissive: 0xfff099, emissiveIntensity: 3, transparent: true })
        ));

        // 2) 预编译所有 shader：renderer.compile() 遍历整个场景编译每个材质（与相机角度无关，
        //    一次即覆盖全部），消除游戏中途首次触发某粒子/材质时的编译掉帧。
        //    不在这里做合成渲染——那一帧（bloom 多趟 + Reflector 湖面二次渲染 + 阴影贴图）在
        //    弱 GPU/高 DPI 上要几百 ms 甚至数秒，且会冻结在捏脸界面。把它交给游戏循环第一帧：
        //    玩家直接看到世界出现，而不是黑屏等待。（旧实现跑 8 次更是 8 倍冻结。）
        const origPos = this.camera.position.clone();
        const origRot = this.camera.rotation.clone();
        this.camera.position.set(0, 12, 18);
        this.camera.lookAt(0, 0, 0);
        this.renderer.compile(this.scene, this.camera);
        this.camera.position.copy(origPos);
        this.camera.rotation.copy(origRot);

        // 3) 上传所有 CanvasTexture
        this.scene.traverse(obj => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => {
                    if (m.map && m.map.isTexture) this.renderer.initTexture(m.map);
                });
            }
        });

        // 4) 清掉 dummies
        dummies.forEach(d => {
            this.scene.remove(d);
            d.geometry.dispose();
            d.material.dispose();
        });
    }

    _initThree() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));  // Retina 屏限到 1.5，省 2-4 倍片元
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog('#d8ecf5', 70, 230);  // 扩图后远雾推远，远山仍若隐若现

        // 所有 MeshToonMaterial 自动挂三阶 ramp（真赛璐璐分层光影）
        // 包一层 scene.add：后续无论谁创建的物体，进场景时统一打补丁
        this._toonRamp = makeToonRampTexture();
        const patchToon = (obj) => {
            if (!obj || !obj.traverse) return;
            obj.traverse(o => {
                const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
                mats.forEach(m => {
                    if (m.isMeshToonMaterial && !m.gradientMap) {
                        m.gradientMap = this._toonRamp;
                        m.needsUpdate = true;
                    }
                });
            });
        };
        const origSceneAdd = this.scene.add.bind(this.scene);
        this.scene.add = (...objs) => {
            objs.forEach(patchToon);
            return origSceneAdd(...objs);
        };
        this._patchToon = patchToon;  // 周期兜底：挂到已入场景物体上的新材质

        // 动态天空穹顶（shader 渐变 + 太阳/月亮大气晕，随昼夜插值）
        this._createSkyDome();

        this.camera = new THREE.PerspectiveCamera(
            72, window.innerWidth / window.innerHeight, 0.1, 280  // 扩图后远裁剪面 200→280，远山不被切
        );
        this.cameraTarget = new THREE.Vector3();
        this.velocity = { x: 0, z: 0 };

        // 软环境光（保存引用，昼夜循环会改强度）
        this.ambient = new THREE.AmbientLight(0xffffff, 0.45);
        this.scene.add(this.ambient);
        // 主光（暖太阳，投影；位置随昼夜循环旋转）
        this.sun = new THREE.DirectionalLight(0xfff1d4, 0.95);
        this.sun.position.set(22, 32, 18);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);  // 2048→1024：贴图减小 4 倍，渲染快很多
        const s = 40;                              // 阴影范围也缩小，关注玩家周围
        this.sun.shadow.camera.left = -s;
        this.sun.shadow.camera.right = s;
        this.sun.shadow.camera.top = s;
        this.sun.shadow.camera.bottom = -s;
        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 100;
        this.sun.shadow.bias = -0.0005;
        // 阴影贴图不每帧重渲，隔几帧刷一次（太阳移动慢、卡通游戏看不出延迟），省一大笔
        this.sun.shadow.autoUpdate = false;
        this.sun.shadow.needsUpdate = true;
        this.scene.add(this.sun);
        // 反光（蓝天→草地）
        this.hemi = new THREE.HemisphereLight(0xbde0ff, 0x5a8a3a, 0.35);
        this.scene.add(this.hemi);
        // 冷色补光：永远在太阳对面，背光面不死黑、轮廓更立体；夜里它就是月光
        this.fillLight = new THREE.DirectionalLight(0x9db8ff, 0.25);
        this.fillLight.position.set(-22, 24, -18);
        this.scene.add(this.fillLight);

        // 昼夜循环状态
        this.dayPhase = 0.32;     // 开局时间：上午（0=半夜，0.25=日出，0.5=正午，0.75=日落）
        this.dayDuration = 600;   // 白天≈5分钟(相位0.25~0.75占一半→dayDuration/2)，夜里加速保持约1分钟
        this._tmpColor = new THREE.Color();
        this._timeChip = document.getElementById('game-time');

        // 天上的太阳球+月亮球（视觉本体，跟着 dayPhase 走）
        this.sunMesh = new THREE.Mesh(
            new THREE.SphereGeometry(2.4, 24, 18),
            new THREE.MeshBasicMaterial({ color: 0xfff099, fog: false })
        );
        this.scene.add(this.sunMesh);
        this.sunGlow = new THREE.Mesh(
            new THREE.SphereGeometry(3.3, 20, 16),
            new THREE.MeshBasicMaterial({ color: 0xffd966, fog: false, transparent: true, opacity: 0.35 })
        );
        this.scene.add(this.sunGlow);

        this.moonMesh = new THREE.Mesh(
            new THREE.SphereGeometry(1.7, 22, 16),
            new THREE.MeshBasicMaterial({ color: 0xe8eef5, fog: false })
        );
        this.scene.add(this.moonMesh);
        this.moonGlow = new THREE.Mesh(
            new THREE.SphereGeometry(2.4, 18, 14),
            new THREE.MeshBasicMaterial({ color: 0xa8c8e8, fog: false, transparent: true, opacity: 0.28 })
        );
        this.scene.add(this.moonGlow);

        // ===== 后处理：bloom（终点星会真发光）=====
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        // bloom 半分辨率（视觉差异很小，性能省一半）
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
            0.85,  // strength
            0.5,   // radius
            0.82   // threshold（收紧：白天的白云/亮天不晕染，夜里灯火和星星照常发光）
        );
        this.composer.addPass(this.bloomPass);
        // 色彩分级：饱和度提升 + 轻 S 曲线 + 阴影偏冷/高光偏暖 + 暗角（一个全屏 pass，开销极小）
        this.gradePass = new ShaderPass({
            uniforms: {
                tDiffuse: { value: null },
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D tDiffuse;
                varying vec2 vUv;
                void main() {
                    vec4 tex = texture2D(tDiffuse, vUv);
                    vec3 col = tex.rgb;
                    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
                    // 饱和度 +14%
                    col = mix(vec3(l), col, 1.14);
                    // 轻 S 曲线（只对 0..1 区间塑形，HDR 高光不动）
                    vec3 cc = clamp(col, 0.0, 1.0);
                    col = mix(col, cc * cc * (3.0 - 2.0 * cc), 0.16);
                    // split tone：阴影偏冷蓝、高光偏暖（电影感的关键一笔，量要小）
                    float w = smoothstep(0.0, 0.9, l);
                    col += (1.0 - w) * vec3(-0.010, 0.002, 0.022)
                         +        w  * vec3( 0.020, 0.009, -0.012);
                    // 柔和暗角
                    vec2 q = vUv - 0.5;
                    col *= 1.0 - dot(q, q) * 0.45;
                    gl_FragColor = vec4(max(col, 0.0), tex.a);
                }
            `,
        });
        this.composer.addPass(this.gradePass);
        this.composer.addPass(new OutputPass());
    }

    _createSkyDome() {
        this._skyUniforms = {
            uTopDay:   { value: new THREE.Color('#3f93dd') },
            uHorDay:   { value: new THREE.Color('#c2e3f2') },
            uTopSet:   { value: new THREE.Color('#5a5a96') },
            uHorSet:   { value: new THREE.Color('#ff9e62') },
            uTopNight: { value: new THREE.Color('#10173a') },
            uHorNight: { value: new THREE.Color('#283458') },
            uSunDir:   { value: new THREE.Vector3(0, 1, 0) },
            uDayness:  { value: 1 },
            uSetness:  { value: 0 },
        };
        const skyMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            uniforms: this._skyUniforms,
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    vDir = position;  // 球心永远在相机上，物体坐标即视线方向
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uTopDay, uHorDay, uTopSet, uHorSet, uTopNight, uHorNight;
                uniform vec3 uSunDir;
                uniform float uDayness, uSetness;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    // 1=地平线, 0=天顶
                    float t = pow(1.0 - clamp(d.y, 0.0, 1.0), 1.5);
                    vec3 top = mix(uTopNight, uTopDay, uDayness);
                    vec3 hor = mix(uHorNight, uHorDay, uDayness);
                    top = mix(top, uTopSet, uSetness * 0.8);
                    hor = mix(hor, uHorSet, uSetness);
                    vec3 col = mix(top, hor, t);
                    float sd = max(dot(d, uSunDir), 0.0);
                    // 日出/日落：太阳侧整片暖晕（贴地平线最浓）
                    col += uSetness * vec3(1.0, 0.42, 0.14) * pow(sd, 3.0) * (0.25 + 0.75 * t) * 0.55;
                    // 白天：太阳周围柔光
                    col += uDayness * vec3(1.0, 0.92, 0.72) * pow(sd, 22.0) * 0.4;
                    // 夜晚：月亮（太阳反方向）周围冷晕
                    float md = max(dot(d, -uSunDir), 0.0);
                    col += (1.0 - uDayness) * vec3(0.45, 0.58, 0.85) * pow(md, 16.0) * 0.22;
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
        });
        this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 20), skyMat);
        this.skyDome.frustumCulled = false;
        this.scene.add(this.skyDome);
    }

    _buildWorld() {
        // 大地面：草地噪声纹理（扩图 220→320，repeat 同步 22→32 保持草密度）
        const grassTex = makeGrassTexture();
        grassTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        grassTex.repeat.set(32, 32);
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(320, 320),
            new THREE.MeshToonMaterial({ map: grassTex })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // 中央广场（暖沙色）
        const plaza = new THREE.Mesh(
            new THREE.CircleGeometry(5, 32),
            new THREE.MeshToonMaterial({ color: 0xffe4b5 })
        );
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = 0.02;
        plaza.receiveShadow = true;
        this.scene.add(plaza);

        // 三条放射状的路：每条独立材质，记录在 this.paths 里方便通关后单独染色
        this.paths = {};
        const pathDefs = [
            { sx: 6,  sz: 48, x: 0,   z: -28, name: '北方金星' },
            { sx: 48, sz: 6,  x: 28,  z: 0,   name: '东方粉星' },
            { sx: 48, sz: 6,  x: -28, z: 0,   name: '西方蓝星' },
        ];
        pathDefs.forEach(p => {
            const path = new THREE.Mesh(
                new THREE.PlaneGeometry(p.sx, p.sz),
                new THREE.MeshToonMaterial({ color: 0xc9ecb0 })
            );
            path.rotation.x = -Math.PI / 2;
            path.position.set(p.x, 0.015, p.z);
            path.receiveShadow = true;
            this.scene.add(path);
            this.paths[p.name] = path;
        });

        // 远景装饰：一圈小山
        this._addDistantHills();

        // 散落小石头/小花/灌木 + 卡通小树 + 蝴蝶 + 云 + 鸟群 + 星空 + 天气 + 草叶
        this.flowers = [];
        this.landParticles = [];
        this.footprints = [];
        this.lastFootprintPos = new THREE.Vector3();
        this.footprintCooldown = 0;
        this.animDecor = [];   // 风车/秋千这类要每帧动的固定装饰
        this._sleepPhase = 0;
        this._sleepCooldown = 0;
        this._sleepJumped = false;
        this._scatterDecorations();
        this._scatterTrees();
        this._createWindGrass();
        this._createButterflies();
        this._createSkyClouds();
        this._initBirdFlock();
        this._createStars();
        this._initWeather();

        // 4 间小房子 + 村屋 + 风车 + 秋千 + 湖 + 闪电 + NPC + 烟+萤火虫+兔+波纹+长椅
        this.smokeParticles = [];
        this.smokeTimers = [];
        this.fireflies = [];
        this.bunnies = [];
        this.ripples = [];
        this._rippleTimer = 0;
        this._buildHouses();
        this._buildWindmill(-58, -22);
        this._buildSwing(-30, 36);
        this._buildLake(48, -42);
        this._initLightning();
        this._buildNPCs();
        this._initAudio();
        this._initSmoke();
        this._initFireflies();
        this._createDayMotes();
        this._buildBunnies();
        this._buildBenches();
        this._buildLampposts();
        this._buildCollectibleStars();
        this._scatterMushrooms();
        this._buildHotAirBalloon();
        this._buildSnowmen();
        this._buildFence();
        this._buildHolidayLights();
        this._buildFountain();
        this._buildBellTower();
        this._buildChickens();
        this._initFireworks();
        this._initBats();
        this._buildBeach();
        this._buildStreamAndBridge();
        this._initWind();
        this._addRooftopCat();
        this._buildSnowBiome();
        this._buildDesertBiome();
        this._blendBiomeEdges();
        this._buildSnowSprite();
        this._buildLakeTurtle();
        this._buildFishingBoat();
        this._buildLighthouse();
        this._initGreetQuest();
        this._initRainbow();
        this._initSwimming();
        this._initShootingStars();
        this._buildGiantWindmill();
        // ===== 隐藏彩蛋 =====
        this._initKonami();
        this._addIglooPenguin();
        this._addBridgeTreasure();
        this._initFountainWish();
        this._addBackyardGold();
        // ===== 互动 & 季节 =====
        this._initWatering();
        this._initFishing();
        this._initSeasons();
        // ===== 新彩蛋 =====
        this._addTreeHiddenEmoji();
        this._addLighthouseNote();
        // ===== BGM / 背包 / 成就 / 搜打撤 + 宝物 =====
        this._initBGM();
        this._initInventory();
        this._initAchievements();
        this._buildExtractionPad();
        this._initExtraction();
        this._buildChests();
        this._buildMonsters();
        // ===== 区域感受系统（冷/热/清凉 + 进区故事旁白）=====
        this._initRegionFeel();
        // ===== 收集主线：火种/泉珠/月光石 → 点亮钟楼 =====
        this._initQuest();
    }

    _buildHouses() {
        this.houses = [];
        this.beds = [];
        this.candles = [];
        // 4 间可进入的大房子，门朝 +Z（南）
        const cfgs = [
            { x: -42, z: -28, body: 0xfae0a0, roof: 0xc8453a, sign: '橙橙家' },
            { x: 50,  z:  20, body: 0xd4d4f0, roof: 0x6890c8, sign: '小蓝家' },
            { x: -55, z:  35, body: 0xfcd7c0, roof: 0xb8743a, sign: '紫薇家' },
            { x: 35,  z: -52, body: 0xe6f0c8, roof: 0x6caa6c, sign: '小黄家' },
        ];
        cfgs.forEach((c, i) => this._addHouse(c.x, c.z, c.body, c.roof, c.sign, i));
        this._buildVillageHall();
    }

    _addHouse(x, z, bodyColor, roofColor, signText, idx = 0) {
        const group = new THREE.Group();
        const W = 8.0, H = 5.0, D = 8.0;  // 面积 30→64，2 倍多
        const wallT = 0.25;
        const doorW = 2.2, doorH = 3.0;
        const fadeables = [];  // 进屋后变透明的墙体/屋顶集合

        // 室内地板（深色木）
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(W, D),
            new THREE.MeshToonMaterial({ color: 0xc9925c })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.05;
        floor.receiveShadow = true;
        group.add(floor);

        const wallMat = () => new THREE.MeshToonMaterial({ color: bodyColor });

        // 后墙
        const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, wallT), wallMat());
        back.position.set(0, H / 2, -D / 2);
        back.castShadow = true; back.receiveShadow = true;
        addOutline(back, 0.025);
        group.add(back); fadeables.push(back);

        // 左墙
        const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, D), wallMat());
        left.position.set(-W / 2, H / 2, 0);
        left.castShadow = true; left.receiveShadow = true;
        addOutline(left, 0.025);
        group.add(left); fadeables.push(left);

        // 右墙
        const right = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, D), wallMat());
        right.position.set(W / 2, H / 2, 0);
        right.castShadow = true; right.receiveShadow = true;
        addOutline(right, 0.025);
        group.add(right); fadeables.push(right);

        // 前墙 = 左侧段 + 右侧段 + 门上方段，留出门洞
        const frontSideW = (W - doorW) / 2;
        const frontL = new THREE.Mesh(new THREE.BoxGeometry(frontSideW, H, wallT), wallMat());
        frontL.position.set(-W / 2 + frontSideW / 2, H / 2, D / 2);
        frontL.castShadow = true;
        addOutline(frontL, 0.025);
        group.add(frontL); fadeables.push(frontL);

        const frontR = new THREE.Mesh(new THREE.BoxGeometry(frontSideW, H, wallT), wallMat());
        frontR.position.set(W / 2 - frontSideW / 2, H / 2, D / 2);
        frontR.castShadow = true;
        addOutline(frontR, 0.025);
        group.add(frontR); fadeables.push(frontR);

        const frontTopH = H - doorH;
        const frontT = new THREE.Mesh(new THREE.BoxGeometry(doorW, frontTopH, wallT), wallMat());
        frontT.position.set(0, doorH + frontTopH / 2, D / 2);
        frontT.castShadow = true;
        addOutline(frontT, 0.025);
        group.add(frontT); fadeables.push(frontT);

        // 门框（深棕木）
        const frameMat = new THREE.MeshToonMaterial({ color: 0x6a3a1a });
        for (const sx of [-1, 1]) {
            const fr = new THREE.Mesh(new THREE.BoxGeometry(0.1, doorH, wallT + 0.06), frameMat);
            fr.position.set(sx * doorW / 2, doorH / 2, D / 2);
            group.add(fr);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.2, 0.12, wallT + 0.06), frameMat);
        top.position.set(0, doorH, D / 2);
        group.add(top);

        // 门头招牌（加入 fadeables，进屋后跟着墙一起淡，避免挡住相机视野）
        if (signText) {
            const signTex = makeSignTexture(signText);
            const sign = new THREE.Sprite(new THREE.SpriteMaterial({
                map: signTex, depthWrite: false, transparent: true,
            }));
            sign.scale.set(2.0, 0.7, 1);
            sign.position.set(0, doorH + 0.55, D / 2 + 0.12);
            group.add(sign);
            fadeables.push(sign);
        }

        // 屋顶（金字塔锥）
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(W * 0.78, 2.0, 4),
            new THREE.MeshToonMaterial({ color: roofColor })
        );
        roof.position.y = H + 1.0;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        addOutline(roof, 0.04);
        group.add(roof); fadeables.push(roof);

        // 烟囱
        const chimney = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.9, 0.45),
            new THREE.MeshToonMaterial({ color: 0x9a4a3a })
        );
        chimney.position.set(W * 0.28, H + 1.4, -D * 0.22);
        chimney.castShadow = true;
        addOutline(chimney, 0.04);
        group.add(chimney); fadeables.push(chimney);

        // 侧墙发光窗（夜里有光，bloom 抓得到）
        const winMat = new THREE.MeshStandardMaterial({
            color: 0xfff5a0, emissive: 0xfff099, emissiveIntensity: 0.95,
        });
        for (const sx of [-1, 1]) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.7), winMat.clone());
            win.position.set(sx * (W / 2), H * 0.45, 0);
            group.add(win);
            // 十字窗格
            const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.72), frameMat);
            h1.position.set(sx * (W / 2), H * 0.45, 0);
            group.add(h1);
            const v1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.04), frameMat);
            v1.position.set(sx * (W / 2), H * 0.45, 0);
            group.add(v1);
        }

        // 室内暖灯（默认灭；夜里进到这间屋才自动点亮，见 _updateHouseTransparency）
        const lamp = new THREE.PointLight(0xffd599, 0, 16, 1.1);
        lamp.position.set(0, H - 1.0, 0);
        group.add(lamp);
        this._lastHouseLamp = lamp;  // 临时存一下，给下面 houses.push 收进 house 对象

        // ===== 室内家具 =====
        const woodTop = 0xc89868, woodLeg = 0xa67a4a;
        // 桌子（带 4 条腿）
        const tableTop = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.12, 0.8),
            new THREE.MeshToonMaterial({ color: woodTop })
        );
        tableTop.position.set(-W / 2 + 1.3, 1.0, -D / 2 + 1.6);
        tableTop.castShadow = true;
        addOutline(tableTop, 0.03);
        group.add(tableTop);
        for (const lx of [-0.6, 0.6]) for (const lz of [-0.3, 0.3]) {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.06, 0.95, 6),
                new THREE.MeshToonMaterial({ color: woodLeg })
            );
            leg.position.set(-W / 2 + 1.3 + lx, 0.5, -D / 2 + 1.6 + lz);
            group.add(leg);
        }
        // 桌上一个发光烛台
        const candle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.18, 8),
            new THREE.MeshToonMaterial({ color: 0xf5e6c0 })
        );
        candle.position.set(-W / 2 + 1.3, 1.18, -D / 2 + 1.6);
        group.add(candle);
        const flame = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 6),
            new THREE.MeshStandardMaterial({
                color: 0xffaa44, emissive: 0xffaa44, emissiveIntensity: 2.5,
            })
        );
        flame.position.set(-W / 2 + 1.3, 1.32, -D / 2 + 1.6);
        flame.scale.y = 1.4;
        group.add(flame);
        // 注册烛台供踩灭/点燃用
        this.candles.push({
            worldX: x + (-W / 2 + 1.3),
            worldZ: z + (-D / 2 + 1.6),
            flame,
            lit: true,
            cooldown: 0,
        });

        // 椅子（座+靠背）
        const chairSeat = new THREE.Mesh(
            new THREE.BoxGeometry(0.65, 0.10, 0.65),
            new THREE.MeshToonMaterial({ color: woodLeg })
        );
        chairSeat.position.set(-W / 2 + 1.3, 0.6, -D / 2 + 2.6);
        addOutline(chairSeat, 0.03);
        group.add(chairSeat);
        const chairBack = new THREE.Mesh(
            new THREE.BoxGeometry(0.65, 0.7, 0.10),
            new THREE.MeshToonMaterial({ color: woodLeg })
        );
        chairBack.position.set(-W / 2 + 1.3, 1.0, -D / 2 + 2.92);
        addOutline(chairBack, 0.03);
        group.add(chairBack);

        // 床（木框 + 床垫 + 枕头）
        const bedFrame = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.35, 2.0),
            new THREE.MeshToonMaterial({ color: 0x9a4a3a })
        );
        bedFrame.position.set(W / 2 - 0.85, 0.225, 0);
        bedFrame.castShadow = true;
        addOutline(bedFrame, 0.03);
        group.add(bedFrame);
        const mattress = new THREE.Mesh(
            new THREE.BoxGeometry(1.10, 0.18, 1.90),
            new THREE.MeshToonMaterial({ color: 0xf5e6e0 })
        );
        mattress.position.set(W / 2 - 0.85, 0.48, 0);
        group.add(mattress);
        const pillow = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.14, 0.45),
            new THREE.MeshToonMaterial({ color: 0xffd0d0 })
        );
        pillow.position.set(W / 2 - 0.85, 0.63, -0.7);
        group.add(pillow);
        const blanket = new THREE.Mesh(
            new THREE.BoxGeometry(1.10, 0.06, 1.2),
            new THREE.MeshToonMaterial({ color: 0xc8a8ff })
        );
        blanket.position.set(W / 2 - 0.85, 0.58, 0.3);
        group.add(blanket);
        // 注册床的世界坐标 AABB 供"睡觉"用
        this.beds.push({
            min: new THREE.Vector3(x + W / 2 - 1.4, 0, z - 1.0),
            max: new THREE.Vector3(x + W / 2 - 0.3, 1.2, z + 1.0),
        });

        // 地毯
        const rug = new THREE.Mesh(
            new THREE.CircleGeometry(1.0, 24),
            new THREE.MeshToonMaterial({ color: 0xc04848 })
        );
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0, 0.07, 0);
        group.add(rug);

        // ===== 屋外生活化装饰（每间按 idx 差异化）=====
        this._addHouseLife(group, W, H, D, doorW, doorH, idx);

        group.position.set(x, 0, z);
        this.scene.add(group);

        // ===== 碰撞：6 段薄墙 AABB（门洞留空让蛋走进去）=====
        const t = wallT / 2;
        const walls = [
            { min: new THREE.Vector3(x - W/2,          0, z - D/2 - t), max: new THREE.Vector3(x + W/2,             H,  z - D/2 + t) }, // 后
            { min: new THREE.Vector3(x - W/2 - t,      0, z - D/2),     max: new THREE.Vector3(x - W/2 + t,         H,  z + D/2) },     // 左
            { min: new THREE.Vector3(x + W/2 - t,      0, z - D/2),     max: new THREE.Vector3(x + W/2 + t,         H,  z + D/2) },     // 右
            { min: new THREE.Vector3(x - W/2,          0, z + D/2 - t), max: new THREE.Vector3(x - W/2 + frontSideW, H, z + D/2 + t) }, // 前-左
            { min: new THREE.Vector3(x + W/2 - frontSideW, 0, z + D/2 - t), max: new THREE.Vector3(x + W/2,         H,  z + D/2 + t) }, // 前-右
            { min: new THREE.Vector3(x - doorW/2,    doorH, z + D/2 - t), max: new THREE.Vector3(x + doorW/2,       H,  z + D/2 + t) }, // 门楣
        ];
        walls.forEach(w => this.obstacles.push(w));

        // 记录到 houses 给透明化用
        this.houses.push({
            // inside 检测放宽到外墙边（不再减 wallT）：站门口就算"屋内"
            min: new THREE.Vector3(x - W/2, 0, z - D/2),
            max: new THREE.Vector3(x + W/2, H, z + D/2),
            fadeables,
            currentOpacity: 1,
            lamp: this._lastHouseLamp,   // 夜里进屋自动开的灯
        });
    }

    // 屋外生活化装饰：门口地垫/盆栽/挂灯 + 窗台花箱 + 柴火堆或水桶 + 屋檐小彩旗
    _addHouseLife(group, W, H, D, doorW, doorH, idx) {
        const pal = [
            { fl: [0xff6f8f, 0xffd24a, 0xff9e3d], bn: [0xff6f8f, 0x6fc7ff, 0xffd24a] },
            { fl: [0x6fb3ff, 0xc77bff, 0xffffff], bn: [0x9ed8ff, 0xffd24a, 0xff8fb8] },
            { fl: [0xff8fb8, 0xff6f5a, 0xffd24a], bn: [0xff6f5a, 0x86c074, 0xffd24a] },
            { fl: [0xffd24a, 0xff9e3d, 0x86c074], bn: [0x86c074, 0xffd24a, 0x6fc7ff] },
        ][idx % 4];
        const wood = new THREE.MeshToonMaterial({ color: 0x8a5a32 });
        const leaf = new THREE.MeshToonMaterial({ color: 0x5aa84f });
        const terra = new THREE.MeshToonMaterial({ color: 0xc06a40 });
        const flowerMesh = (c, r = 0.09) =>
            new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), new THREE.MeshToonMaterial({ color: c }));

        // 门口地垫
        const matEl = new THREE.Mesh(
            new THREE.BoxGeometry(1.7, 0.05, 0.95),
            new THREE.MeshToonMaterial({ color: idx % 2 ? 0xb8794a : 0x9c7d52 })
        );
        matEl.position.set(0, 0.06, D / 2 + 0.9);
        group.add(matEl);

        // 门口两侧盆栽（陶盆 + 绿叶 + 几朵花）
        for (const sx of [-1, 1]) {
            const px = sx * (doorW / 2 + 0.6), pz = D / 2 + 0.35;
            const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.46, 10), terra);
            pot.position.set(px, 0.23, pz);
            pot.castShadow = true; addOutline(pot, 0.02);
            group.add(pot);
            const bush = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), leaf);
            bush.position.set(px, 0.62, pz); bush.scale.y = 0.9;
            group.add(bush);
            for (let k = 0; k < 3; k++) {
                const a = (k / 3) * Math.PI * 2 + idx;
                const f = flowerMesh(pal.fl[k % 3]);
                f.position.set(px + Math.cos(a) * 0.24, 0.74 + (k % 2) * 0.06, pz + Math.sin(a) * 0.24);
                group.add(f);
            }
        }

        // 门边挂灯（夜里 bloom 会发光）
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), wood);
        arm.position.set(doorW / 2 + 0.35, doorH - 0.1, D / 2 + 0.1);
        group.add(arm);
        const lantern = new THREE.Mesh(
            new THREE.CylinderGeometry(0.13, 0.16, 0.34, 8),
            new THREE.MeshStandardMaterial({ color: 0xffe7a8, emissive: 0xffcf6a, emissiveIntensity: 0.9 })
        );
        lantern.position.set(doorW / 2 + 0.55, doorH - 0.35, D / 2 + 0.1);
        group.add(lantern);

        // 两扇侧窗下的窗台花箱
        for (const sx of [-1, 1]) {
            const bx = sx * (W / 2 + 0.06);
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 1.0), wood);
            box.position.set(bx, H * 0.45 - 0.5, 0);
            group.add(box);
            for (let k = 0; k < 3; k++) {
                const f = flowerMesh(pal.fl[(k + idx) % 3], 0.1);
                f.position.set(bx, H * 0.45 - 0.32, -0.32 + k * 0.32);
                group.add(f);
            }
        }

        // 左后墙外：柴火堆（偶数房）/ 右后角：水桶（奇数房）
        if (idx % 2 === 0) {
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) {
                const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 8), wood);
                log.rotation.x = Math.PI / 2;
                log.position.set(-W / 2 - 0.45, 0.16 + r * 0.27, -D / 4 + c * 0.3 + r * 0.15);
                group.add(log);
            }
        } else {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.85, 12), wood);
            barrel.position.set(W / 2 + 0.55, 0.42, -D / 2 + 0.8);
            barrel.castShadow = true; addOutline(barrel, 0.02);
            group.add(barrel);
            const hoopMat = new THREE.MeshToonMaterial({ color: 0x55504a });
            for (const hy of [0.16, 0.68]) {
                const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 16), hoopMat);
                hoop.rotation.x = Math.PI / 2;
                hoop.position.set(W / 2 + 0.55, hy, -D / 2 + 0.8);
                group.add(hoop);
            }
        }

        // 屋檐下一串小彩旗（中间下垂）
        const segs = 9;
        for (let s = 0; s < segs; s++) {
            const tt = s / (segs - 1);
            const tx = -W / 2 + 0.4 + (W - 0.8) * tt;
            const sag = Math.sin(tt * Math.PI) * 0.5;
            const flag = new THREE.Mesh(
                new THREE.ConeGeometry(0.13, 0.32, 3),
                new THREE.MeshToonMaterial({ color: pal.bn[s % 3], side: THREE.DoubleSide })
            );
            flag.rotation.x = Math.PI;  // 尖朝下
            flag.position.set(tx, H + 0.35 - sag, D / 2 + 0.12);
            group.add(flag);
        }
    }

    _updateHouseTransparency(dt) {
        if (!this.houses) return;
        const p = this.player.position;
        let anyInside = false;
        let activeDoor = null;
        // 天黑了没？（白天进屋不用开灯，屋里本来就亮）
        const night = (this._lastDayness ?? 1) < 0.32;
        for (const h of this.houses) {
            const inside =
                p.x > h.min.x && p.x < h.max.x &&
                p.z > h.min.z && p.z < h.max.z;
            if (inside) {
                anyInside = true;
                // 门在 +Z 方向墙正中
                activeDoor = { x: (h.min.x + h.max.x) / 2, z: h.max.z };
            }
            // 进门/出门音效
            if (inside !== h.wasInside) {
                this._playChime();
                h.wasInside = inside;
                if (inside) this._unlockAchievement('into_house');
            }
            // 进屋就开灯：夜里全亮、白天也补一点（屋里被墙挡光容易黑，保证看得清）
            if (h.lamp) {
                const lampTarget = inside ? (night ? 6.5 : 2.6) : 0;
                h.lamp.intensity += (lampTarget - h.lamp.intensity) * Math.min(1, 5 * dt);
            }
            const target = inside ? 0.18 : 1.0;
            h.currentOpacity += (target - h.currentOpacity) * Math.min(1, 8 * dt);
            const op = h.currentOpacity;
            for (const mesh of h.fadeables) {
                mesh.material.transparent = op < 0.99;
                mesh.material.opacity = op;
                for (const child of mesh.children) {
                    if (child.material) {
                        child.material.transparent = op < 0.99;
                        child.material.opacity = op;
                    }
                }
            }
        }
        this.isInsideHouse = anyInside;
        this.activeHouseDoor = activeDoor;
        this._updateExitArrow();
    }

    _updateExitArrow() {
        if (!this._exitArrowEl) {
            this._exitArrowEl = document.getElementById('exit-arrow');
            this._exitArrowIcon = this._exitArrowEl?.querySelector('.arrow');
        }
        const el = this._exitArrowEl;
        if (!el) return;
        if (!this.activeHouseDoor) {
            el.classList.remove('visible');
            return;
        }
        const p = this.player.position;
        const dx = this.activeHouseDoor.x - p.x;
        const dz = this.activeHouseDoor.z - p.z;
        // 把世界方向投影到相机坐标（cameraYaw=0 时相机前方 = -Z）
        const yaw = this.cameraYaw || 0;
        const fwdProj  = dx * Math.sin(yaw) + dz * -Math.cos(yaw);
        const rightProj = dx * Math.cos(yaw) + dz *  Math.sin(yaw);
        // screenAngle: 0 = 正前方(↑), π/2 = 右(→), -π/2 = 左(←), π = 身后(↓)
        const screenAngle = Math.atan2(rightProj, fwdProj);
        el.classList.add('visible');
        if (this._exitArrowIcon) {
            this._exitArrowIcon.style.transform = `rotate(${screenAngle}rad)`;
        }
    }

    _playChime() {
        this._tone(660, 0.2, 'sine', 0.05);
        this._tone(880, 0.25, 'sine', 0.04, 0.1);
    }

    _finalizeInsideState() {
        // _updateHouseTransparency 结束时调用——把累计的 anyInside 写到 isInsideHouse
        // 直接在 transparency 函数里设置已经够用
    }

    _checkBeds(dt) {
        if (!this.beds || this.beds.length === 0) return;
        if (this._sleepCooldown > 0) this._sleepCooldown -= dt;

        // 正在睡觉过渡中
        if (this._sleepPhase > 0) {
            this._sleepPhase -= dt;
            const overlay = document.getElementById('sleep-overlay');
            if (overlay) {
                // 1.4..0.7 = 渐黑，0.7 时刻跳时段，0.7..0 = 渐回
                const t = this._sleepPhase;
                let alpha;
                if (t > 0.7) {
                    alpha = (1.4 - t) / 0.7;
                    if (alpha > 1) alpha = 1;
                } else {
                    alpha = t / 0.7;
                }
                overlay.style.opacity = alpha;
                if (t < 0.7 && !this._sleepJumped) {
                    this.dayPhase = (this.dayPhase + 0.5) % 1;
                    this._sleepJumped = true;
                }
                if (this._sleepPhase <= 0) {
                    overlay.style.opacity = 0;
                    this._sleepJumped = false;
                }
            }
            return;
        }

        if (this._sleepCooldown > 0) return;
        const p = this.player.position;
        for (const bed of this.beds) {
            if (p.x > bed.min.x && p.x < bed.max.x &&
                p.z > bed.min.z && p.z < bed.max.z) {
                this._sleepPhase = 1.4;
                this._sleepCooldown = 8;
                this._sleepJumped = false;
                this._tone(220, 1.2, 'sine', 0.04);  // 睡觉哼鸣
                return;
            }
        }
    }

    _initSmoke() {
        // 烟囱位置（与房子 W=8, H=5 同步）
        this.chimneyPoses = [
            { x: -42 + 8 * 0.28, y: 5 + 1.4, z: -28 + -8 * 0.22 },
            { x:  50 + 8 * 0.28, y: 5 + 1.4, z:  20 + -8 * 0.22 },
            { x: -55 + 8 * 0.28, y: 5 + 1.4, z:  35 + -8 * 0.22 },
            { x:  35 + 8 * 0.28, y: 5 + 1.4, z: -52 + -8 * 0.22 },
        ];
        this.smokeTimers = this.chimneyPoses.map(() => Math.random() * 0.8);
    }

    _updateSmoke(dt) {
        if (!this.chimneyPoses) return;
        // 生成
        this.chimneyPoses.forEach((c, i) => {
            this.smokeTimers[i] -= dt;
            if (this.smokeTimers[i] <= 0) {
                this.smokeTimers[i] = 0.8 + Math.random() * 0.4;
                const puff = new THREE.Mesh(
                    new THREE.SphereGeometry(0.18, 8, 6),
                    new THREE.MeshBasicMaterial({
                        color: 0xe8e8ec, transparent: true, opacity: 0.72,
                        depthWrite: false, fog: true,
                    })
                );
                puff.position.set(
                    c.x + (Math.random() - 0.5) * 0.15,
                    c.y + 0.4,
                    c.z + (Math.random() - 0.5) * 0.15
                );
                // 烟受统一风影响
                const windVx = this.wind ? Math.cos(this.wind.dir) * this.wind.strength * 1.5 : 0;
                const windVz = this.wind ? Math.sin(this.wind.dir) * this.wind.strength * 1.5 : 0;
                puff.userData = {
                    vx: (Math.random() - 0.5) * 0.25 + windVx,
                    vz: (Math.random() - 0.5) * 0.15 + windVz,
                    vy: 0.55 + Math.random() * 0.3,
                    life: 3.5,
                    full: 3.5,
                    baseScale: 1 + Math.random() * 0.3,
                };
                this.scene.add(puff);
                this.smokeParticles.push(puff);
            }
        });
        // 更新现有
        this.smokeParticles = this.smokeParticles.filter(p => {
            p.userData.life -= dt;
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                p.geometry.dispose(); p.material.dispose();
                return false;
            }
            p.position.x += p.userData.vx * dt;
            p.position.y += p.userData.vy * dt;
            p.position.z += (p.userData.vz || 0) * dt;
            const k = 1 - p.userData.life / p.userData.full;
            const sc = p.userData.baseScale * (1 + k * 1.5);
            p.scale.setScalar(sc);
            p.material.opacity = 0.72 * (1 - k);
            return true;
        });
    }

    _initFireflies() {
        const count = 28;
        for (let i = 0; i < 28; i++) {
            const body = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 6, 6),
                new THREE.MeshStandardMaterial({
                    color: 0xeaff66, emissive: 0xeaff66, emissiveIntensity: 2.5,
                })
            );
            body.position.set(
                (Math.random() - 0.5) * 110,
                1 + Math.random() * 2.5,
                (Math.random() - 0.5) * 110
            );
            body.userData = {
                home: body.position.clone(),
                phase: Math.random() * Math.PI * 2,
                speed: 0.4 + Math.random() * 0.4,
                radius: 1.5 + Math.random() * 2,
            };
            body.visible = false;
            this.scene.add(body);
            this.fireflies.push(body);
        }
    }

    _updateFireflies(dt) {
        if (!this.fireflies) return;
        const t = performance.now() * 0.001;
        // 夜里出现
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const nightness = Math.max(0, -sh);
        this.fireflies.forEach(f => {
            const d = f.userData;
            f.position.x = d.home.x + Math.sin(t * d.speed + d.phase) * d.radius;
            f.position.y = d.home.y + Math.sin(t * d.speed * 1.7 + d.phase) * 0.4;
            f.position.z = d.home.z + Math.cos(t * d.speed * 1.3 + d.phase) * d.radius;
            const flicker = 0.5 + 0.5 * Math.sin(t * 6 + d.phase * 7);
            f.material.emissiveIntensity = 2.5 * flicker * nightness;
            f.visible = nightness > 0.05;
        });
    }

    // 白天的漂浮光尘/花粉：阳光里慢慢飘的小亮点（夜里淡出，交班给萤火虫）
    _createDayMotes() {
        const count = 90;
        this._moteData = [];
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            this._moteData.push({
                ox: (Math.random() - 0.5) * 44,
                oz: (Math.random() - 0.5) * 44,
                y: 0.4 + Math.random() * 3.6,
                amp: 0.3 + Math.random() * 0.7,
                speed: 0.15 + Math.random() * 0.35,
                phase: Math.random() * Math.PI * 2,
            });
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.dayMotes = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xfff8e0,
            size: 0.10,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            sizeAttenuation: true,
        }));
        this.dayMotes.frustumCulled = false;
        this.scene.add(this.dayMotes);
    }

    _updateDayMotes(dt) {
        if (!this.dayMotes) return;
        const dayness = this._lastDayness ?? 1;
        const vis = dayness > 0.04 && !this.isInsideHouse;
        this.dayMotes.visible = vis;
        this.dayMotes.material.opacity = 0.35 * dayness;
        if (!vis) return;
        const t = performance.now() * 0.001;
        const p = this.player.position;
        const pos = this.dayMotes.geometry.attributes.position;
        for (let i = 0; i < this._moteData.length; i++) {
            const m = this._moteData[i];
            // 围着玩家的 44x44 区域取模平移，走到哪儿光尘飘到哪儿
            let x = m.ox + Math.sin(t * m.speed + m.phase) * m.amp + t * 0.25;
            let z = m.oz + Math.cos(t * m.speed * 0.8 + m.phase) * m.amp;
            x = ((x - p.x + 22) % 44 + 44) % 44 - 22 + p.x;
            z = ((z - p.z + 22) % 44 + 44) % 44 - 22 + p.z;
            const y = m.y + Math.sin(t * m.speed * 1.4 + m.phase) * 0.25;
            pos.setXYZ(i, x, y, z);
        }
        pos.needsUpdate = true;
    }

    _buildBunnies() {
        const inPath = (x, z) => {
            if (Math.hypot(x, z) < 8) return true;
            if (Math.abs(x) < 5 && z < 0 && z > -55) return true;
            if (Math.abs(z) < 5 && x > 0 && x <  55) return true;
            if (Math.abs(z) < 5 && x < 0 && x > -55) return true;
            return false;
        };
        for (let i = 0; i < 6; i++) {
            let x, z, tries = 0;
            do {
                x = (Math.random() - 0.5) * 130;
                z = (Math.random() - 0.5) * 130;
                tries++;
            } while (inPath(x, z) && tries < 20);
            if (tries >= 20) continue;
            this._addBunny(x, z);
        }
    }

    _addBunny(x, z) {
        const group = new THREE.Group();
        const isBrown = Math.random() < 0.4;
        const fur = isBrown ? 0xc9925c : 0xf5ede0;
        const mat = new THREE.MeshToonMaterial({ color: fur });
        // 身体
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), mat);
        body.scale.set(1.2, 1, 1.4);
        body.position.y = 0.22;
        body.castShadow = true;
        addOutline(body, 0.05);
        group.add(body);
        // 头
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat);
        head.position.set(0, 0.32, -0.22);
        head.castShadow = true;
        addOutline(head, 0.05);
        group.add(head);
        // 耳朵
        for (const sx of [-1, 1]) {
            const ear = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.04, 0.22, 4, 8),
                mat
            );
            ear.position.set(sx * 0.06, 0.55, -0.25);
            ear.rotation.z = sx * 0.15;
            addOutline(ear, 0.06);
            group.add(ear);
        }
        // 尾巴（白色绒球）
        const tail = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 10, 8),
            new THREE.MeshToonMaterial({ color: 0xffffff })
        );
        tail.position.set(0, 0.22, 0.18);
        addOutline(tail, 0.05);
        group.add(tail);
        // 眼睛
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(0.025, 6, 4),
                new THREE.MeshBasicMaterial({ color: 0x1a1a2e })
            );
            eye.position.set(sx * 0.06, 0.36, -0.34);
            group.add(eye);
        }
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
        this.bunnies.push({
            group,
            phase: Math.random() * Math.PI * 2,
            home: new THREE.Vector3(x, 0, z),
            hopT: Math.random() * 4,
        });
    }

    _updateBunnies(dt) {
        if (!this.bunnies) return;
        const t = performance.now() * 0.001;
        this.bunnies.forEach(b => {
            // 偶发跳一下
            b.hopT -= dt;
            if (b.hopT <= 0) {
                b.hopT = 2 + Math.random() * 4;
                b.hopPhase = 0;
                // 随机选个新方向
                b.heading = Math.random() * Math.PI * 2;
            }
            if (b.hopPhase !== undefined && b.hopPhase < 1) {
                b.hopPhase += dt * 3.5;
                const y = Math.sin(b.hopPhase * Math.PI) * 0.18;
                b.group.position.y = y;
                // 平移
                if (b.hopPhase < 1) {
                    b.group.position.x += Math.sin(b.heading) * 0.5 * dt;
                    b.group.position.z += Math.cos(b.heading) * 0.5 * dt;
                }
                b.group.rotation.y = b.heading;
            } else {
                b.group.position.y = 0;
            }
            // 别跑太远
            const dx = b.group.position.x - b.home.x;
            const dz = b.group.position.z - b.home.z;
            if (Math.hypot(dx, dz) > 4) {
                b.heading = Math.atan2(-dx, -dz);
            }
        });
    }

    _addLakeRipple() {
        const lx = 48, lz = -42;
        const r0 = 0.3;
        const r = Math.random() * 6 + 1;
        const ang = Math.random() * Math.PI * 2;
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(r0 - 0.05, r0 + 0.05, 24),
            new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.7,
                side: THREE.DoubleSide, depthWrite: false,
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(lx + Math.cos(ang) * r, 0.10, lz + Math.sin(ang) * r);
        this.scene.add(ring);
        this.ripples.push({ ring, life: 1.5, full: 1.5 });
    }

    _updateRipples(dt) {
        if (!this.ripples) return;
        this._rippleTimer -= dt;
        if (this._rippleTimer <= 0) {
            this._rippleTimer = 0.8 + Math.random() * 1.2;
            this._addLakeRipple();
        }
        this.ripples = this.ripples.filter(r => {
            r.life -= dt;
            if (r.life <= 0) {
                this.scene.remove(r.ring);
                r.ring.geometry.dispose(); r.ring.material.dispose();
                return false;
            }
            const k = 1 - r.life / r.full;
            r.ring.scale.setScalar(1 + k * 8);
            r.ring.material.opacity = 0.7 * (1 - k);
            return true;
        });
    }

    _buildBenches() {
        // 几张长椅放在路边/秋千旁/湖边
        const spots = [
            { x: -23, z: 36, ry: Math.PI / 2 },     // 秋千旁
            { x:  20, z:   8, ry: 0 },              // 东路旁
            { x: -18, z:  -8, ry: 0 },              // 西路旁
            { x:  42, z: -34, ry: -Math.PI / 4 },   // 湖边
        ];
        spots.forEach(s => this._addBench(s.x, s.z, s.ry));
    }

    _buildLampposts() {
        this.lampposts = [];
        // 3 条路两边对称放灯
        const spots = [];
        // 北路（z 负方向）
        for (let z = -10; z >= -40; z -= 10) {
            spots.push({ x: -4.5, z, ry: 0 });
            spots.push({ x: 4.5,  z, ry: 0 });
        }
        // 东路
        for (let x = 10; x <= 40; x += 10) {
            spots.push({ x, z: -4.5, ry: Math.PI / 2 });
            spots.push({ x, z:  4.5, ry: Math.PI / 2 });
        }
        // 西路
        for (let x = -10; x >= -40; x -= 10) {
            spots.push({ x, z: -4.5, ry: Math.PI / 2 });
            spots.push({ x, z:  4.5, ry: Math.PI / 2 });
        }
        spots.forEach(s => this._addLamppost(s.x, s.z, s.ry));
    }

    _addLamppost(x, z, ry) {
        const group = new THREE.Group();
        const poleMat = new THREE.MeshToonMaterial({ color: 0x2a2a3a });
        // 柱
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.10, 2.4, 8),
            poleMat
        );
        pole.position.y = 1.2;
        pole.castShadow = true;
        addOutline(pole, 0.04);
        group.add(pole);
        // 横臂
        const arm = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.06, 0.06),
            poleMat
        );
        arm.position.set(0.18, 2.4, 0);
        group.add(arm);
        // 灯罩
        const cap = new THREE.Mesh(
            new THREE.ConeGeometry(0.22, 0.28, 8),
            poleMat
        );
        cap.position.set(0.36, 2.36, 0);
        cap.rotation.x = Math.PI;
        addOutline(cap, 0.04);
        group.add(cap);
        // 灯泡（夜里发光）
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 12, 10),
            new THREE.MeshStandardMaterial({
                color: 0xfff099, emissive: 0xfff099, emissiveIntensity: 0,
            })
        );
        bulb.position.set(0.36, 2.18, 0);
        group.add(bulb);

        const lamp = new THREE.PointLight(0xffd599, 0, 5, 1.4);
        lamp.position.set(0.36, 2.18, 0);
        group.add(lamp);

        group.position.set(x, 0, z);
        group.rotation.y = ry;
        this.scene.add(group);
        this.lampposts.push({ bulb, lamp });
        this._addPropCollider(x, z, 0.28, 2.5);
    }

    _updateLampposts() {
        if (!this.lampposts) return;
        // 夜里灯亮，白天熄
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const nightness = Math.max(0, -sh + 0.15) / 1.15;  // 黄昏就开始亮
        const intensity = nightness * 2.5;
        const lampStr = nightness * 1.5;
        this.lampposts.forEach(L => {
            L.bulb.material.emissiveIntensity = intensity;
            L.lamp.intensity = lampStr;
        });
    }

    _buildCollectibleStars() {
        this.collectStars = [];
        // 读存档：已收集的不再生成，进度续上
        this.starsCollected = this._loadProgress().stars || 0;
        const remaining = Math.max(0, 24 - this.starsCollected);
        // 合法落点：避开广场中心、湖、房子内部（否则星星卡在墙里/湖里吸不到）
        const valid = (x, z) => {
            if (Math.hypot(x, z) < 6) return false;
            if (Math.hypot(x - 48, z + 42) < 12) return false;   // 湖
            for (const h of (this.houses || [])) {
                if (x > h.min.x - 1 && x < h.max.x + 1 && z > h.min.z - 1 && z < h.max.z + 1) return false;
            }
            return true;
        };
        for (let i = 0; i < remaining; i++) {
            let x, z, tries = 0;
            do {
                x = (Math.random() - 0.5) * 100;
                z = (Math.random() - 0.5) * 100;
                tries++;
            } while (!valid(x, z) && tries < 30);
            this._addCollectStar(x, z);
        }
        this._starsChip = document.getElementById('game-stars');
        if (this._starsChip) this._starsChip.textContent = `⭐ ${this.starsCollected} / 24`;
    }

    _addCollectStar(x, z) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.5,
        });
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), mat);
        star.position.set(x, 1.0, z);
        star.castShadow = true;
        this.scene.add(star);
        this.collectStars.push({ mesh: star, baseY: 1.0, phase: Math.random() * Math.PI * 2 });
    }

    _updateCollectStars(dt) {
        if (!this.collectStars) return;
        const t = performance.now() * 0.001;
        const p = this.player.position;
        for (let i = this.collectStars.length - 1; i >= 0; i--) {
            const s = this.collectStars[i];
            s.mesh.rotation.y = t * 2 + s.phase;
            s.mesh.position.y = s.baseY + Math.sin(t * 2 + s.phase) * 0.15;
            const dx = p.x - s.mesh.position.x;
            const dz = p.z - s.mesh.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 2.0) {
                // 吸附移动 + 收集
                s.mesh.position.x += dx * 6 * dt;
                s.mesh.position.z += dz * 6 * dt;
                if (dist < 0.6) {
                    this.scene.remove(s.mesh);
                    s.mesh.geometry.dispose();
                    s.mesh.material.dispose();
                    this.collectStars.splice(i, 1);
                    this.starsCollected++;
                    if (this._starsChip) {
                        this._starsChip.textContent = `⭐ ${this.starsCollected} / ${this.starsCollected + this.collectStars.length}`;
                    }
                    this._tone(880, 0.10, 'sine', 0.06);
                    this._tone(1320, 0.10, 'sine', 0.05, 0.05);
                    this._unlockAchievement('first_star');
                    if (this.collectStars.length === 0) this._unlockAchievement('all_stars');
                    this._saveProgress();
                }
            }
        }
    }

    // ===================== 收集主线：点亮钟楼 =====================
    _initQuest() {
        this.questItems = [];
        this.questCount = 0;
        this._questReady = false;
        this._questDone = false;
        this.bellTowerPos = new THREE.Vector3(7, 0, 5);

        // 三件心愿之物（含一束光柱指引，方便在大地图里找到）
        // 1) 火种——冰雪国冰湖边
        this._addQuestItem({
            key: 'fireseed', x: -30, z: -88, color: 0xff7a2a, emissive: 0xff5500,
            emoji: '🔥', label: '暖灯火种',
            story: '🔥 拿到暖灯火种！<br>小雪精灵不再孤单啦。',
        });
        // 2) 清泉之珠——沙漠绿洲（复用已埋好的发光珠子）
        if (this._oasisGem) {
            this.questItems.push({
                key: 'springpearl', mesh: this._oasisGem, beam: this._addQuestBeam(this._oasisGem.position, 0x66e0ff),
                baseY: this._oasisGem.position.y, phase: 0, collected: false,
                emoji: '💧', label: '清泉之珠',
                story: '💧 挖出清泉之珠！<br>绿洲会重新冒水的。',
            });
        }
        // 3) 月光石——月光湖边
        this._addQuestItem({
            key: 'moonstone', x: 38, z: -32, color: 0xdfeaff, emissive: 0x9ec4ff,
            emoji: '🌙', label: '月光石',
            story: '🌙 找到月光石！<br>湖底老乌龟笑了。',
        });

        // HUD：心愿之物进度
        this._questChip = document.createElement('div');
        Object.assign(this._questChip.style, {
            position: 'fixed', top: '64px', left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 16px',
            background: 'rgba(0,0,0,0.4)', color: '#fff',
            fontSize: '17px', fontWeight: 'bold', letterSpacing: '1px',
            borderRadius: '14px', zIndex: '19', pointerEvents: 'none',
            boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
        });
        document.body.appendChild(this._questChip);
        this._updateQuestHud();

        // 回填存档：已收集的心愿之物静默回放，钟楼若已点亮则直接亮起
        const prog = this._loadProgress();
        if (prog.quest && prog.quest.length) {
            for (const key of prog.quest) {
                const it = this.questItems.find(i => i.key === key && !i.collected);
                if (it) this._collectQuestItem(it, true);
            }
        }
        if (prog.questDone && this.questCount >= this.questItems.length) {
            this._lightBellTower(true);
        }
    }

    _addQuestItem({ key, x, z, color, emissive, emoji, label, story }) {
        const mesh = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.55, 0),
            new THREE.MeshStandardMaterial({
                color, emissive, emissiveIntensity: 1.3, metalness: 0.2, roughness: 0.3,
            })
        );
        mesh.position.set(x, 1.4, z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.questItems.push({
            key, mesh, beam: this._addQuestBeam(mesh.position, emissive),
            baseY: 1.4, phase: Math.random() * Math.PI * 2, collected: false,
            emoji, label, story,
        });
    }

    // 一束竖直光柱，远远就能看到心愿之物在哪
    _addQuestBeam(pos, color) {
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 9, 12, 1, true),
            new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.34,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            })
        );
        beam.position.set(pos.x, 4.5, pos.z);
        this.scene.add(beam);
        return beam;
    }

    _updateQuest(dt) {
        if (!this.questItems) return;
        const t = performance.now() * 0.001;
        const p = this.player.position;

        for (const it of this.questItems) {
            if (it.collected) continue;
            // 漂浮 + 自转 + 光柱呼吸
            it.mesh.rotation.y = t * 1.5 + it.phase;
            it.mesh.position.y = it.baseY + Math.sin(t * 1.8 + it.phase) * 0.2;
            if (it.beam) it.beam.material.opacity = 0.3 + Math.sin(t * 2 + it.phase) * 0.1;

            const dx = p.x - it.mesh.position.x;
            const dz = p.z - it.mesh.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 2.2) {
                it.mesh.position.x += dx * 6 * dt;   // 吸附
                it.mesh.position.z += dz * 6 * dt;
                if (dist < 0.9) this._collectQuestItem(it);
            }
        }

        // 集齐三样 → 引导回钟楼（钟楼亮一束金光）
        if (this._questReady && !this._questDone) {
            if (!this._bellBeam) {
                this._bellBeam = this._addQuestBeam(this.bellTowerPos, 0xffd86b);
                this._bellBeam.scale.y = 1.6;
                this._bellBeam.position.y = 7;
            }
            this._bellBeam.material.opacity = 0.32 + Math.sin(t * 3) * 0.12;
            // 走到钟楼脚下 → 点亮通关
            if (Math.hypot(p.x - this.bellTowerPos.x, p.z - this.bellTowerPos.z) < 3.4) {
                this._lightBellTower();
            }
        }
    }

    _collectQuestItem(it, silent = false) {
        it.collected = true;
        this.scene.remove(it.mesh);
        if (it.mesh.geometry) it.mesh.geometry.dispose();
        if (it.mesh.material) it.mesh.material.dispose();
        if (it.beam) {
            this.scene.remove(it.beam);
            it.beam.geometry.dispose(); it.beam.material.dispose();
        }
        if (it.key === 'springpearl') this._oasisGem = null;  // 别再让沙漠 FX 引用它
        this.questCount++;
        this._updateQuestHud();
        if (!silent) {
            // 收集反馈（加载存档时静默，不放烟花）
            this._tone(880, 0.10, 'sine', 0.07);
            this._tone(1320, 0.12, 'sine', 0.06, 0.06);
            this._launchFirework();
            this._showEasterBadge(it.story.replace(/<br>/g, ' '));
        }
        this._unlockAchievement && this._unlockAchievement('quest_' + it.key);

        // —— 区域故事角色的反应（存档回放也要应用，否则进度对不上）——
        if (it.key === 'fireseed' && this._snowSpriteRec) {
            if (this._snowSpriteBody) {
                this._snowSpriteBody.material.color.setHex(0xffd9ec);
                this._snowSpriteBody.material.emissive.setHex(0xff9ec4);
            }
            if (this._snowSpriteHalo) this._snowSpriteHalo.material.color.setHex(0xffc0e0);
            if (this._snowSpriteMouth) this._snowSpriteMouth.rotation.z = Math.PI;
            this._setStoryLine(this._snowSpriteRec, '谢谢你，小蛋！暖和多啦～(*^▽^*)');
        }
        if (it.key === 'springpearl') this._reviveOasis();
        if (it.key === 'moonstone' && this._turtleRec) {
            this._setStoryLine(this._turtleRec, '谢谢你，小蛋。夜里它会照亮回家的路～');
        }

        if (this.questCount >= this.questItems.length) {
            this._questReady = true;
            if (!silent) setTimeout(() => {
                if (!this._questDone) this._showEasterBadge('✨ 三样心愿之物都齐了！快回村庄钟楼！');
            }, 2400);
        }
        if (!silent) this._saveProgress();
    }

    _updateQuestHud() {
        if (!this._questChip) return;
        const mark = (k) => {
            const it = this.questItems.find(i => i.key === k);
            return it ? `${it.emoji}${it.collected ? '✅' : '·'}` : '';
        };
        this._questChip.innerHTML =
            `心愿之物　${mark('fireseed')}　${mark('springpearl')}　${mark('moonstone')}　${this.questCount}/${this.questItems.length}`;
    }

    _lightBellTower(silent = false) {
        this._questDone = true;
        // 钟楼整体发光
        if (this.bell) {
            this.bell.material.emissive = new THREE.Color(0xffcf5a);
            this.bell.material.emissiveIntensity = 1.4;
        }
        this.bellGroup?.traverse(o => {
            if (o.isMesh && o.material && 'emissive' in o.material) {
                o.material.emissive = new THREE.Color(0xffe6a0);
                o.material.emissiveIntensity = 0.5;
            }
        });
        // 撤掉引导光柱
        if (this._bellBeam) {
            this.scene.remove(this._bellBeam);
            this._bellBeam.geometry.dispose(); this._bellBeam.material.dispose();
            this._bellBeam = null;
        }
        this._updateQuestHud();
        if (!silent) {
            // 钟声 + 胜利和弦 + 连发烟花 + 通关庆祝大画面
            this._bellShakeT = 1.4;
            this._playBell && this._playBell();
            this._playWin();
            for (let i = 0; i < 10; i++) setTimeout(() => this._launchFirework(), i * 240);
            this._showWinScreen();
            this._saveProgress();
        }
        this._unlockAchievement && this._unlockAchievement('belltower_lit');
    }

    // 通关庆祝大画面（大字 + 继续探索按钮）
    _showWinScreen() {
        if (this._winEl) return;
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'fixed', inset: '0', zIndex: '50',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(ellipse at center, rgba(40,20,60,0.35), rgba(20,10,30,0.72))',
            opacity: '0', transition: 'opacity 0.8s', textAlign: 'center',
        });
        el.innerHTML = `
            <div style="font-size:64px">🔔🎆</div>
            <div style="font-size:42px;font-weight:bold;color:#fff;
                 text-shadow:0 3px 16px rgba(255,180,80,0.8);margin:8px 0">钟楼亮啦！</div>
            <div style="font-size:24px;color:#ffe6a0;margin-bottom:6px">你做到了，蛋蛋！🥚✨</div>
            <div style="font-size:17px;color:#cfc4e0;max-width:80vw;line-height:1.6;margin-bottom:26px">
                你把火种、清泉之珠、月光石都带回了村庄，<br>钟声又响起来了，大家都笑了 🎉</div>
            <button id="win-continue" style="font-size:20px;font-weight:bold;color:#fff;
                 padding:12px 32px;border:none;border-radius:999px;cursor:pointer;
                 background:linear-gradient(90deg,#ff9ec4,#ffd24a);box-shadow:0 6px 20px rgba(0,0,0,0.3)">
                继续探索 🌿</button>`;
        document.body.appendChild(el);
        this._winEl = el;
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        const btn = el.querySelector('#win-continue');
        btn.onclick = () => {
            el.style.opacity = '0';
            setTimeout(() => { el.remove(); this._winEl = null; }, 800);
            this.container?.requestPointerLock?.();
        };
    }

    _loadProgress() {
        try { return JSON.parse(localStorage.getItem('eggGameProgress')) || {}; }
        catch (e) { return {}; }
    }
    _saveProgress() {
        try {
            localStorage.setItem('eggGameProgress', JSON.stringify({
                stars: this.starsCollected || 0,
                quest: (this.questItems || []).filter(it => it.collected).map(it => it.key),
                questDone: !!this._questDone,
            }));
        } catch (e) {}
    }

    _scatterMushrooms() {
        const inPath = (x, z) => {
            if (Math.hypot(x, z) < 9) return true;
            if (Math.abs(x) < 5 && z < 0 && z > -55) return true;
            if (Math.abs(z) < 5 && x > 0 && x <  55) return true;
            if (Math.abs(z) < 5 && x < 0 && x > -55) return true;
            return false;
        };
        for (let i = 0; i < 36; i++) {
            const x = (Math.random() - 0.5) * 140;
            const z = (Math.random() - 0.5) * 140;
            if (inPath(x, z)) continue;
            if (z < -56) continue;  // 雪原里不长蘑菇
            this._addMushroom(x, z);
        }
    }

    _addMushroom(x, z) {
        const group = new THREE.Group();
        const isRed = Math.random() < 0.65;
        const capColor = isRed ? 0xc83a3a : 0xc8a8ff;
        // 柄
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07, 0.10, 0.28, 8),
            new THREE.MeshToonMaterial({ color: 0xf5e6d6 })
        );
        stem.position.y = 0.14;
        stem.castShadow = true;
        addOutline(stem, 0.05);
        group.add(stem);
        // 伞（半球）
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshToonMaterial({ color: capColor })
        );
        cap.position.y = 0.28;
        cap.castShadow = true;
        addOutline(cap, 0.05);
        group.add(cap);
        // 伞底
        const capBottom = new THREE.Mesh(
            new THREE.CircleGeometry(0.22, 16),
            new THREE.MeshToonMaterial({ color: 0xf5e6d6, side: THREE.DoubleSide })
        );
        capBottom.rotation.x = Math.PI / 2;
        capBottom.position.y = 0.28;
        group.add(capBottom);
        // 白点
        const spotMat = new THREE.MeshToonMaterial({ color: 0xffffff });
        for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2;
            const r = 0.10 + Math.random() * 0.06;
            const spot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), spotMat);
            spot.position.set(
                Math.cos(ang) * r,
                0.36,
                Math.sin(ang) * r
            );
            group.add(spot);
        }
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        group.scale.setScalar(0.8 + Math.random() * 0.6);
        this.scene.add(group);
    }

    _buildHotAirBalloon() {
        const group = new THREE.Group();
        // 气球本体（球+底部尖）
        const balloon = new THREE.Mesh(
            new THREE.SphereGeometry(2.0, 20, 16),
            new THREE.MeshToonMaterial({ color: 0xff6b9c })
        );
        balloon.scale.y = 1.25;
        balloon.position.y = 2.2;
        balloon.castShadow = true;
        addOutline(balloon, 0.04);
        group.add(balloon);
        // 气球底部颈
        const neck = new THREE.Mesh(
            new THREE.CylinderGeometry(0.25, 0.4, 0.4, 12),
            new THREE.MeshToonMaterial({ color: 0xff3a78 })
        );
        neck.position.y = 0.45;
        addOutline(neck, 0.04);
        group.add(neck);
        // 火焰（发光）
        const flame = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 10, 8),
            new THREE.MeshStandardMaterial({
                color: 0xffaa44, emissive: 0xff6622, emissiveIntensity: 2.0,
            })
        );
        flame.position.y = 0.22;
        flame.scale.y = 1.5;
        group.add(flame);
        // 绳子（4 根）
        const ropeMat = new THREE.MeshBasicMaterial({ color: 0x2c2c54 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const rope = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4),
                ropeMat
            );
            rope.position.set(sx * 0.4, -0.15, sz * 0.4);
            rope.rotation.z = -sx * 0.1;
            rope.rotation.x = sz * 0.1;
            group.add(rope);
        }
        // 篮筐
        const basket = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.55, 0.9),
            new THREE.MeshToonMaterial({ color: 0x8a5a2e })
        );
        basket.position.y = -0.8;
        basket.castShadow = true;
        addOutline(basket, 0.04);
        group.add(basket);
        // 装饰白条
        const stripe = new THREE.Mesh(
            new THREE.SphereGeometry(2.05, 20, 16, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.1),
            new THREE.MeshToonMaterial({ color: 0xffffff })
        );
        stripe.scale.y = 1.25;
        stripe.position.y = 2.2;
        group.add(stripe);

        group.position.set(-60, 22, 0);
        this.scene.add(group);
        this.hotAirBalloon = { group, phase: 0 };
    }

    _updateHotAirBalloon(dt) {
        if (!this.hotAirBalloon) return;
        const b = this.hotAirBalloon;
        b.phase += dt * 0.05;
        if (b.phase > Math.PI * 2) b.phase -= Math.PI * 2;
        // 大圆周飘
        const r = 70;
        b.group.position.x = Math.cos(b.phase) * r;
        b.group.position.z = Math.sin(b.phase) * r;
        b.group.position.y = 22 + Math.sin(b.phase * 3) * 1.5;
        // 朝向运动方向
        b.group.rotation.y = b.phase + Math.PI / 2;
    }

    _buildSnowmen() {
        this.snowmen = [];
        // 2 个雪人（默认隐藏，雪天显形）
        const positions = [{ x: 9, z: 6 }, { x: -8, z: 8 }];
        positions.forEach(p => this._addSnowman(p.x, p.z));
    }

    _addSnowman(x, z) {
        const group = new THREE.Group();
        const snowMat = new THREE.MeshToonMaterial({ color: 0xffffff });
        // 三球
        const ball1 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), snowMat);
        ball1.position.y = 0.55;
        ball1.castShadow = true;
        addOutline(ball1, 0.04);
        group.add(ball1);
        const ball2 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), snowMat);
        ball2.position.y = 1.35;
        ball2.castShadow = true;
        addOutline(ball2, 0.04);
        group.add(ball2);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 16, 12), snowMat);
        head.position.y = 1.95;
        head.castShadow = true;
        addOutline(head, 0.04);
        group.add(head);
        // 眼睛（小黑球）
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0x1a1a2e })
            );
            eye.position.set(sx * 0.10, 2.02, -0.24);
            group.add(eye);
        }
        // 胡萝卜鼻子
        const nose = new THREE.Mesh(
            new THREE.ConeGeometry(0.06, 0.25, 8),
            new THREE.MeshToonMaterial({ color: 0xff8c42 })
        );
        nose.position.set(0, 1.95, -0.40);
        nose.rotation.x = -Math.PI / 2;
        group.add(nose);
        // 围巾
        const scarf = new THREE.Mesh(
            new THREE.TorusGeometry(0.35, 0.10, 8, 16),
            new THREE.MeshToonMaterial({ color: 0xa84030 })
        );
        scarf.position.y = 1.65;
        scarf.rotation.x = Math.PI / 2;
        addOutline(scarf, 0.05);
        group.add(scarf);
        // 手（两根树枝）
        const stickMat = new THREE.MeshToonMaterial({ color: 0x4a2a1a });
        for (const sx of [-1, 1]) {
            const arm = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6),
                stickMat
            );
            arm.position.set(sx * 0.5, 1.4, 0);
            arm.rotation.z = sx * (Math.PI / 2 - 0.2);
            group.add(arm);
        }
        // 帽子（高顶帽）
        const hat = new THREE.Mesh(
            new THREE.CylinderGeometry(0.20, 0.20, 0.32, 12),
            new THREE.MeshToonMaterial({ color: 0x1a1a2e })
        );
        hat.position.y = 2.30;
        addOutline(hat, 0.04);
        group.add(hat);
        const hatBrim = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.04, 12),
            new THREE.MeshToonMaterial({ color: 0x1a1a2e })
        );
        hatBrim.position.y = 2.16;
        group.add(hatBrim);

        group.position.set(x, 0, z);
        group.visible = false;  // 默认隐藏
        this.scene.add(group);
        this.snowmen.push(group);
        this._addPropCollider(x, z, 0.6, 2.0);
    }

    _updateSnowmen() {
        if (!this.snowmen) return;
        const weatherSnow = this.weather === 'snow';
        this.snowmen.forEach(s => {
            if (s.userData && s.userData.permanent) {
                s.visible = true;  // 雪地里永驻的不受天气控制
            } else {
                s.visible = weatherSnow;
            }
        });
    }

    _buildFence() {
        // 外圈半径 78 的圆形篱笆，每 6° 一段（约 60 段）
        const radius = 78;
        const segCount = 60;
        const postMat = new THREE.MeshToonMaterial({ color: 0xa67a4a });
        const railMat = new THREE.MeshToonMaterial({ color: 0xc89868 });
        for (let i = 0; i < segCount; i++) {
            const ang = (i / segCount) * Math.PI * 2;
            const px = Math.cos(ang) * radius;
            const pz = Math.sin(ang) * radius;
            // 篱笆桩
            const post = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.9, 0.12),
                postMat
            );
            post.position.set(px, 0.45, pz);
            post.castShadow = true;
            addOutline(post, 0.05);
            this.scene.add(post);
            // 横档：连接到下一个桩
            const nextAng = ((i + 1) / segCount) * Math.PI * 2;
            const nx = Math.cos(nextAng) * radius;
            const nz = Math.sin(nextAng) * radius;
            const midX = (px + nx) / 2;
            const midZ = (pz + nz) / 2;
            const dist = Math.hypot(nx - px, nz - pz);
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(dist, 0.08, 0.04),
                railMat
            );
            rail.position.set(midX, 0.65, midZ);
            rail.rotation.y = Math.atan2(nz - pz, nx - px);
            this.scene.add(rail);
            // 第二根横档
            const rail2 = new THREE.Mesh(
                new THREE.BoxGeometry(dist, 0.08, 0.04),
                railMat
            );
            rail2.position.set(midX, 0.35, midZ);
            rail2.rotation.y = Math.atan2(nz - pz, nx - px);
            this.scene.add(rail2);
        }
    }

    _buildHolidayLights() {
        this.holidayLights = [];
        const houseConfigs = [
            { x: -42, z: -28, W: 8, D: 8, H: 5 },
            { x:  50, z:  20, W: 8, D: 8, H: 5 },
            { x: -55, z:  35, W: 8, D: 8, H: 5 },
            { x:  35, z: -52, W: 8, D: 8, H: 5 },
        ];
        const colors = [0xff5050, 0xffd700, 0x66ff66, 0x66aaff, 0xff66cc];
        houseConfigs.forEach(c => {
            // 前屋檐挂彩灯（一条横线 8 颗）
            const count = 8;
            for (let i = 0; i < count; i++) {
                const k = (i / (count - 1));
                const lx = c.x - c.W / 2 + 0.3 + k * (c.W - 0.6);
                const ly = c.H + 0.1 - 0.18 * Math.sin(k * Math.PI); // 微下垂
                const lz = c.z + c.D / 2 + 0.15;
                const bulb = new THREE.Mesh(
                    new THREE.SphereGeometry(0.07, 8, 6),
                    new THREE.MeshStandardMaterial({
                        color: colors[i % colors.length],
                        emissive: colors[i % colors.length],
                        emissiveIntensity: 0,
                    })
                );
                bulb.position.set(lx, ly, lz);
                this.scene.add(bulb);
                this.holidayLights.push(bulb);
            }
            // 灯线（一根细绳）
            const ropeStart = new THREE.Vector3(c.x - c.W / 2 + 0.3, c.H + 0.1, c.z + c.D / 2 + 0.15);
            const ropeEnd = new THREE.Vector3(c.x + c.W / 2 - 0.3, c.H + 0.1, c.z + c.D / 2 + 0.15);
            const rope = new THREE.Mesh(
                new THREE.CylinderGeometry(0.012, 0.012, c.W - 0.6, 4),
                new THREE.MeshBasicMaterial({ color: 0x2c2c54 })
            );
            rope.position.copy(ropeStart).lerp(ropeEnd, 0.5);
            rope.rotation.z = Math.PI / 2;
            this.scene.add(rope);
        });
    }

    _updateHolidayLights() {
        if (!this.holidayLights) return;
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const nightness = Math.max(0, -sh + 0.15) / 1.15;
        const t = performance.now() * 0.001;
        this.holidayLights.forEach((b, i) => {
            // 夜里亮，还轻微闪
            const flicker = 0.7 + 0.3 * Math.sin(t * 3 + i * 0.4);
            b.material.emissiveIntensity = nightness * 1.8 * flicker;
        });
    }

    _buildFountain() {
        const group = new THREE.Group();
        // 外圈石环
        const baseMat = new THREE.MeshToonMaterial({ color: 0xaaa8a0 });
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(1.4, 1.5, 0.35, 24),
            baseMat
        );
        base.position.y = 0.175;
        base.castShadow = true;
        base.receiveShadow = true;
        addOutline(base, 0.025);
        group.add(base);
        // 内圈水池
        const water = new THREE.Mesh(
            new THREE.CylinderGeometry(1.15, 1.15, 0.10, 24),
            new THREE.MeshStandardMaterial({
                color: 0x6890c8, transparent: true, opacity: 0.85,
                metalness: 0.1, roughness: 0.2,
            })
        );
        water.position.y = 0.3;
        group.add(water);
        // 中心柱
        const center = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.25, 0.7, 12),
            baseMat
        );
        center.position.y = 0.7;
        addOutline(center, 0.03);
        group.add(center);
        // 顶部碗
        const bowl = new THREE.Mesh(
            new THREE.CylinderGeometry(0.45, 0.30, 0.18, 16),
            baseMat
        );
        bowl.position.y = 1.10;
        addOutline(bowl, 0.03);
        group.add(bowl);

        group.position.set(0, 0, 0); // 广场中心
        this._addPropCollider(0, 0, 1.5, 1.4);
        this.scene.add(group);

        // 水柱粒子
        this.fountainParticles = [];
        this._fountainTimer = 0;
    }

    _updateFountain(dt) {
        // 生成新粒子
        this._fountainTimer -= dt;
        if (this._fountainTimer <= 0) {
            this._fountainTimer = 0.05;
            const ang = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.15;
            const drop = new THREE.Mesh(
                new THREE.SphereGeometry(0.05 + Math.random() * 0.03, 6, 4),
                new THREE.MeshStandardMaterial({
                    color: 0x88c8e8, transparent: true, opacity: 0.85,
                })
            );
            drop.position.set(
                Math.cos(ang) * radius,
                1.3,
                Math.sin(ang) * radius
            );
            drop.userData = {
                vx: Math.cos(ang) * (0.4 + Math.random() * 0.5),
                vy: 3.5 + Math.random() * 0.8,
                vz: Math.sin(ang) * (0.4 + Math.random() * 0.5),
                life: 0.9,
            };
            this.scene.add(drop);
            this.fountainParticles.push(drop);
        }
        // 更新现有
        this.fountainParticles = this.fountainParticles.filter(p => {
            p.userData.life -= dt;
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                p.geometry.dispose(); p.material.dispose();
                return false;
            }
            p.userData.vy -= 9.8 * dt;
            p.position.x += p.userData.vx * dt;
            p.position.y += p.userData.vy * dt;
            p.position.z += p.userData.vz * dt;
            if (p.position.y < 0.35) p.position.y = 0.35;  // 落到水面
            p.material.opacity = 0.85 * Math.min(1, p.userData.life * 1.5);
            return true;
        });
    }

    _buildBellTower() {
        const x = 7, z = 5;  // 广场边
        this._addPropCollider(x, z, 1.2, 5);
        const group = new THREE.Group();
        const stoneMat = new THREE.MeshToonMaterial({ color: 0xc8c0b0 });
        // 塔基
        const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 2.2), stoneMat);
        base.position.y = 0.2;
        base.castShadow = true;
        addOutline(base, 0.025);
        group.add(base);
        // 塔身
        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.5, 1.6), stoneMat);
        tower.position.y = 2.65;
        tower.castShadow = true;
        addOutline(tower, 0.025);
        group.add(tower);
        // 钟室（开放四面）
        const bellRoom = new THREE.Mesh(
            new THREE.BoxGeometry(2.0, 0.15, 2.0),
            stoneMat
        );
        bellRoom.position.y = 5.0;
        group.add(bellRoom);
        // 4 根柱子
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const col = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.10, 0.95, 8),
                stoneMat
            );
            col.position.set(sx * 0.85, 5.5, sz * 0.85);
            group.add(col);
        }
        // 钟
        const bell = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.5, 0.7, 16, 1, true),
            new THREE.MeshToonMaterial({ color: 0xc89020, side: THREE.DoubleSide })
        );
        bell.position.y = 5.5;
        bell.castShadow = true;
        addOutline(bell, 0.04);
        group.add(bell);
        const bellCap = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshToonMaterial({ color: 0xc89020 })
        );
        bellCap.position.y = 5.85;
        group.add(bellCap);
        // 屋顶
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(1.5, 1.2, 4),
            new THREE.MeshToonMaterial({ color: 0x8b4540 })
        );
        roof.position.y = 6.7;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        addOutline(roof, 0.04);
        group.add(roof);

        group.position.set(x, 0, z);
        this.scene.add(group);
        this.bell = bell;
        this.bellGroup = group;
        this._bellShakeT = 0;
        this._lastHourCheck = -1;
        // 注册塔身为 obstacle
        this.obstacles.push({
            min: new THREE.Vector3(x - 1.1, 0, z - 1.1),
            max: new THREE.Vector3(x + 1.1, 4.5, z + 1.1),
        });
    }

    _updateBellTower(dt) {
        if (!this.bell) return;
        // 检测"整点"：dayPhase 跨过 1/8 边界（一天 8 个"小时"）
        const hour = Math.floor(this.dayPhase * 8);
        if (this._lastHourCheck < 0) this._lastHourCheck = hour;
        if (hour !== this._lastHourCheck) {
            this._lastHourCheck = hour;
            this._bellShakeT = 1.0;
            this._playBell();
        }
        // 钟摇晃动画
        if (this._bellShakeT > 0) {
            this._bellShakeT -= dt;
            const swing = Math.sin(this._bellShakeT * 16) * 0.3 * this._bellShakeT;
            this.bell.rotation.z = swing;
        } else {
            this.bell.rotation.z = 0;
        }
    }

    _playBell() {
        // 3 声逐渐衰减的低频纯音
        this._tone(220, 1.5, 'sine', 0.10);
        this._tone(330, 1.5, 'sine', 0.06, 0.05);
        this._tone(440, 1.5, 'sine', 0.04, 0.10);
    }

    _buildChickens() {
        this.chickens = [];
        // 5 只小鸡，分散在房子附近的院子区
        const spots = [
            { x: -39, z: -23 }, { x: -38, z: -24 },
            { x:  48, z:  24 },
            { x: -52, z:  39 },
            { x:  37, z: -49 },
        ];
        spots.forEach(s => this._addChicken(s.x, s.z));
    }

    _addChicken(x, z) {
        const group = new THREE.Group();
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 12, 10),
            new THREE.MeshToonMaterial({ color: 0xfff099 })
        );
        body.scale.set(1, 0.9, 1.2);
        body.position.y = 0.18;
        body.castShadow = true;
        addOutline(body, 0.05);
        group.add(body);
        // 头（小一点的球）
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 10, 8),
            new THREE.MeshToonMaterial({ color: 0xfff099 })
        );
        head.position.set(0, 0.30, -0.20);
        head.castShadow = true;
        addOutline(head, 0.05);
        group.add(head);
        // 鸡冠
        const comb = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 8, 6),
            new THREE.MeshToonMaterial({ color: 0xc83a3a })
        );
        comb.position.set(0, 0.41, -0.20);
        comb.scale.set(1.4, 0.6, 0.4);
        group.add(comb);
        // 喙
        const beak = new THREE.Mesh(
            new THREE.ConeGeometry(0.04, 0.10, 6),
            new THREE.MeshToonMaterial({ color: 0xff8c42 })
        );
        beak.position.set(0, 0.28, -0.32);
        beak.rotation.x = -Math.PI / 2;
        group.add(beak);
        // 眼睛
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(0.02, 6, 4),
                new THREE.MeshBasicMaterial({ color: 0x1a1a2e })
            );
            eye.position.set(sx * 0.05, 0.33, -0.27);
            group.add(eye);
        }
        // 腿（两根橙色细柱）
        const legMat = new THREE.MeshToonMaterial({ color: 0xff8c42 });
        for (const sx of [-1, 1]) {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.10, 4),
                legMat
            );
            leg.position.set(sx * 0.05, 0.05, 0.02);
            group.add(leg);
        }
        // 尾翼
        const tail = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 6),
            new THREE.MeshToonMaterial({ color: 0xfff099 })
        );
        tail.position.set(0, 0.24, 0.18);
        tail.scale.set(0.8, 1.2, 0.6);
        group.add(tail);

        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
        this.chickens.push({
            group,
            head,
            home: new THREE.Vector3(x, 0, z),
            phase: Math.random() * Math.PI * 2,
            heading: Math.random() * Math.PI * 2,
            walkT: 0,
            stepT: Math.random() * 3,
        });
    }

    _updateChickens(dt) {
        if (!this.chickens) return;
        const t = performance.now() * 0.001;
        this.chickens.forEach(c => {
            // 头部点头（啄食 idle）
            c.head.rotation.x = Math.sin(t * 4 + c.phase) * 0.25;
            // 慢踱步
            c.stepT -= dt;
            if (c.stepT <= 0) {
                c.stepT = 2 + Math.random() * 3;
                c.heading = Math.random() * Math.PI * 2;
            }
            const dx = c.group.position.x - c.home.x;
            const dz = c.group.position.z - c.home.z;
            if (Math.hypot(dx, dz) > 3) {
                c.heading = Math.atan2(-dx, -dz);
            }
            c.group.position.x += Math.sin(c.heading) * 0.35 * dt;
            c.group.position.z += Math.cos(c.heading) * 0.35 * dt;
            c.group.rotation.y = c.heading;
            // 身体上下小幅起伏（走路感）
            c.group.position.y = Math.abs(Math.sin(t * 4 + c.phase)) * 0.03;
        });
    }

    _initFireworks() {
        this.fireworks = [];
        this._fireworkTimer = 6;
    }

    _updateFireworks(dt) {
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const isNight = sh < -0.05;

        if (isNight) {
            this._fireworkTimer -= dt;
            if (this._fireworkTimer <= 0) {
                this._fireworkTimer = 10 + Math.random() * 15;
                this._launchFirework();
            }
        }

        // 更新所有粒子
        this.fireworks = this.fireworks.filter(p => {
            p.life -= dt;
            if (p.life <= 0) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose(); p.mesh.material.dispose();
                return false;
            }
            if (p.phase === 'rise') {
                p.mesh.position.y += p.vy * dt;
                p.vy -= 4 * dt;
                if (p.vy < 0.5 || p.mesh.position.y > p.targetY) {
                    p.phase = 'explode';
                    this._explodeFirework(p.mesh.position, p.color);
                    this.scene.remove(p.mesh);
                    p.mesh.geometry.dispose(); p.mesh.material.dispose();
                    return false;
                }
            } else {
                p.mesh.position.x += p.vx * dt;
                p.mesh.position.y += p.vy * dt;
                p.mesh.position.z += p.vz * dt;
                p.vy -= 1.5 * dt;
                const k = 1 - p.life / p.full;
                p.mesh.material.opacity = 1 - k;
            }
            return true;
        });
    }

    _launchFirework() {
        if (this._destroyed) return;
        this._unlockAchievement('see_firework');
        this._fireworkCount = (this._fireworkCount || 0) + 1;
        if (this._fireworkCount >= 5) this._unlockAchievement('firework_lover');
        const colors = [0xff5050, 0xffd700, 0x66ff66, 0x66aaff, 0xff66cc, 0xffffff];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const x = (Math.random() - 0.5) * 50;
        const z = (Math.random() - 0.5) * 50;
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 8, 6),
            new THREE.MeshStandardMaterial({
                color, emissive: color, emissiveIntensity: 2.5,
            })
        );
        mesh.position.set(x, 0.5, z);
        this.scene.add(mesh);
        this.fireworks.push({
            mesh, vy: 12 + Math.random() * 4,
            targetY: 18 + Math.random() * 6,
            phase: 'rise', life: 5, full: 5, color,
        });
        this._tone(120, 0.3, 'sawtooth', 0.04); // 升空嘶声
    }

    _explodeFirework(pos, color) {
        // 24 颗粒子四面八方炸开
        for (let i = 0; i < 24; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = (Math.random() - 0.5) * Math.PI;
            const speed = 3 + Math.random() * 2;
            const vx = Math.cos(theta) * Math.cos(phi) * speed;
            const vy = Math.sin(phi) * speed;
            const vz = Math.sin(theta) * Math.cos(phi) * speed;
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.10, 6, 4),
                new THREE.MeshStandardMaterial({
                    color, emissive: color, emissiveIntensity: 2.5,
                    transparent: true, opacity: 1,
                })
            );
            mesh.position.copy(pos);
            this.scene.add(mesh);
            this.fireworks.push({
                mesh, vx, vy, vz, phase: 'fall', life: 1.8, full: 1.8, color,
            });
        }
        // 爆炸音
        this._tone(80 + Math.random() * 50, 0.4, 'square', 0.08);
    }

    _initBats() {
        this.bats = [];
        if (!this._batTex) {
            const c = document.createElement('canvas');
            c.width = 64; c.height = 32;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#1a1a2e';
            // 蝙蝠轮廓：W 形翅膀
            ctx.beginPath();
            ctx.moveTo(4, 16); ctx.quadraticCurveTo(14, 4, 22, 12);
            ctx.lineTo(28, 6); ctx.lineTo(32, 12); ctx.lineTo(36, 6);
            ctx.lineTo(42, 12); ctx.quadraticCurveTo(50, 4, 60, 16);
            ctx.lineTo(50, 18); ctx.quadraticCurveTo(42, 22, 32, 20);
            ctx.quadraticCurveTo(22, 22, 14, 18);
            ctx.closePath(); ctx.fill();
            this._batTex = new THREE.CanvasTexture(c);
            this._batTex.colorSpace = THREE.SRGBColorSpace;
        }
        for (let i = 0; i < 8; i++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this._batTex, transparent: true, depthWrite: false, opacity: 0,
            }));
            sp.scale.set(0.7, 0.35, 1);
            const angle = (i / 8) * Math.PI * 2;
            const r = 25 + Math.random() * 12;
            sp.position.set(Math.cos(angle) * r, 12 + Math.random() * 4, Math.sin(angle) * r);
            sp.userData = {
                angle, r, speed: 0.4 + Math.random() * 0.4,
                phase: Math.random() * Math.PI * 2,
            };
            this.scene.add(sp);
            this.bats.push(sp);
        }
    }

    _updateBats(dt) {
        if (!this.bats) return;
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const nightness = Math.max(0, -sh);
        const t = performance.now() * 0.001;
        this.bats.forEach(b => {
            const d = b.userData;
            d.angle += d.speed * dt * 0.4;
            b.position.x = Math.cos(d.angle) * d.r;
            b.position.z = Math.sin(d.angle) * d.r;
            b.position.y = 12 + Math.sin(t * 2 + d.phase) * 2;
            // 透明度
            const targetOp = nightness > 0.05 ? 0.85 : 0;
            b.material.opacity += (targetOp - b.material.opacity) * 0.05;
            // 翅膀拍动
            const flap = 0.5 + Math.abs(Math.sin(t * 10 + d.phase)) * 0.5;
            b.scale.y = 0.35 * flap;
        });
    }

    _buildBeach() {
        // 湖边沙滩区域：椭圆沙地包住湖
        const lx = 48, lz = -42;
        const sand = new THREE.Mesh(
            new THREE.CircleGeometry(13, 48),
            new THREE.MeshToonMaterial({ color: 0xf5dcb5 })
        );
        sand.rotation.x = -Math.PI / 2;
        sand.position.set(lx, 0.04, lz);  // 在湖下方一点点
        sand.receiveShadow = true;
        this.scene.add(sand);

        // 4 棵椰子树（沙滩边缘）
        const trees = [
            { x: lx + 9,  z: lz + 5,  tilt: -0.15 },
            { x: lx - 9,  z: lz - 4,  tilt:  0.10 },
            { x: lx + 4,  z: lz + 10, tilt: -0.20 },
            { x: lx - 6,  z: lz + 9,  tilt:  0.12 },
        ];
        trees.forEach(t => this._addPalmTree(t.x, t.z, t.tilt));
    }

    _addPalmTree(x, z, tilt) {
        const group = new THREE.Group();
        // 树干（斜立卡通柱）
        const trunkH = 3.5 + Math.random() * 0.8;
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.25, trunkH, 10),
            new THREE.MeshToonMaterial({ color: 0x8a5a2e })
        );
        trunk.position.y = trunkH / 2;
        trunk.rotation.z = tilt;
        trunk.castShadow = true;
        addOutline(trunk, 0.04);
        group.add(trunk);

        // 树冠（6 片椭圆叶向四周下垂）
        const leafMat = new THREE.MeshToonMaterial({ color: 0x4caa5c, side: THREE.DoubleSide });
        const leafCount = 6;
        for (let i = 0; i < leafCount; i++) {
            const ang = (i / leafCount) * Math.PI * 2;
            const leaf = new THREE.Mesh(
                new THREE.SphereGeometry(1.0, 10, 6),
                leafMat
            );
            leaf.scale.set(0.3, 0.15, 1.4);
            leaf.position.set(
                Math.cos(ang) * 1.2 + tilt * trunkH * 0.5,
                trunkH + Math.sin(ang * 2) * 0.1,
                Math.sin(ang) * 1.2
            );
            leaf.rotation.y = ang + Math.PI / 2;
            leaf.rotation.x = -0.3;
            leaf.castShadow = true;
            addOutline(leaf, 0.05);
            group.add(leaf);
        }
        // 椰子（2-3 颗深褐小球）
        const coconutMat = new THREE.MeshToonMaterial({ color: 0x5a3a2a });
        const coconutCount = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < coconutCount; i++) {
            const c = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 8, 6),
                coconutMat
            );
            const ang = Math.random() * Math.PI * 2;
            c.position.set(
                Math.cos(ang) * 0.35 + tilt * trunkH * 0.5,
                trunkH - 0.05,
                Math.sin(ang) * 0.35
            );
            addOutline(c, 0.05);
            group.add(c);
        }
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
    }

    _buildStreamAndBridge() {
        // 小溪：从湖向北延伸一段细长 plane
        const stream = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 24),
            new THREE.MeshStandardMaterial({
                color: 0x6890c8, transparent: true, opacity: 0.85,
                metalness: 0.2, roughness: 0.3,
            })
        );
        stream.rotation.x = -Math.PI / 2;
        stream.position.set(45, 0.08, -25);  // 湖 (-42 z) 向北
        this.scene.add(stream);
        // 溪边石头点缀
        const stoneMat = new THREE.MeshToonMaterial({ color: 0xaaa8a0 });
        for (let i = 0; i < 8; i++) {
            const k = (i - 4) * 2.5;
            for (const sx of [-1.5, 1.5]) {
                if (Math.random() < 0.5) continue;
                const stone = new THREE.Mesh(
                    new THREE.SphereGeometry(0.15 + Math.random() * 0.15, 8, 6),
                    stoneMat
                );
                stone.scale.y = 0.6;
                stone.position.set(45 + sx + (Math.random() - 0.5) * 0.3, 0.10, -25 + k);
                this.scene.add(stone);
            }
        }
        // 石拱桥（横跨小溪一段）
        const bridge = new THREE.Group();
        const archStoneMat = new THREE.MeshToonMaterial({ color: 0xb8b0a0 });
        // 桥板
        const deck = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 2.6), archStoneMat);
        deck.position.y = 0.55;
        deck.castShadow = true;
        deck.receiveShadow = true;
        addOutline(deck, 0.025);
        bridge.add(deck);
        // 两侧栏杆
        for (const sz of [-1.1, 1.1]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.5, 0.12), archStoneMat);
            rail.position.set(0, 0.95, sz);
            addOutline(rail, 0.04);
            bridge.add(rail);
            for (const sx of [-1.8, -0.6, 0.6, 1.8]) {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), archStoneMat);
                pillar.position.set(sx, 0.85, sz);
                addOutline(pillar, 0.04);
                bridge.add(pillar);
            }
        }
        // 拱（半圆）
        const arch = new THREE.Mesh(
            new THREE.TorusGeometry(1.2, 0.18, 8, 12, Math.PI),
            archStoneMat
        );
        arch.position.set(0, 0.6, 0);
        arch.rotation.z = Math.PI;
        arch.rotation.y = Math.PI / 2;
        addOutline(arch, 0.04);
        bridge.add(arch);

        bridge.position.set(45, 0, -16);
        this.scene.add(bridge);
        // 桥板做障碍（蛋可以走上去）
        this.obstacles.push({
            min: new THREE.Vector3(45 - 2.25, 0, -16 - 1.3),
            max: new THREE.Vector3(45 + 2.25, 0.7, -16 + 1.3),
        });
    }

    _initWind() {
        this.wind = { dir: 0.3, strength: 0.35 };
    }

    _updateWind(dt) {
        const t = performance.now() * 0.0001;
        this.wind.dir = Math.sin(t * 1.3) * 0.6 + 0.3;
        this.wind.strength = 0.25 + Math.abs(Math.sin(t * 0.8)) * 0.4;
        // 草地 shader 风强同步
        if (this.grass && this.grass.material.userData.shader) {
            this.grass.material.userData.shader.uniforms.uWindStrength.value = this.wind.strength;
        }
    }

    _addRooftopCat() {
        // 🐱 emoji sprite 站在小蓝家屋顶 (50, 20)
        const c = document.createElement('canvas');
        c.width = 128; c.height = 128;
        const ctx = c.getContext('2d');
        ctx.font = '110px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐱', 64, 64);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const cat = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false,
        }));
        cat.scale.set(1.2, 1.2, 1);
        cat.position.set(50, 6.6, 21.2);  // 房顶上
        this.scene.add(cat);
        this.rooftopCat = cat;
    }

    _checkWindmillKnockback() {
        if (!this.animDecor) return;
        const wm = this.animDecor.find(d => d.type === 'windmill');
        if (!wm) return;
        // 风车塔位置：build 时是 (-58, -22)
        const wmX = -58, wmZ = -22;
        const dx = this.player.position.x - wmX;
        const dz = this.player.position.z - wmZ;
        const dist = Math.hypot(dx, dz);
        // 叶片在塔正前方 z=-21（hub 偏移 1）
        // 叶片半径约 2.4
        if (dist < 3.0 && this.player.position.y < 4.0 && !this._knockbackCooldown) {
            // 计算 hub 旋转决定的某个叶片是否扫到这里
            // 简化：直接进 3m + onGround = 弹飞
            if (this.onGround) {
                const nx = dx / (dist || 1);
                const nz = dz / (dist || 1);
                this.velocity.x = nx * 14;
                this.velocity.z = nz * 14;
                this.playerVy = 9;
                this.onGround = false;
                this._knockbackCooldown = 1.2;
                this._tone(160, 0.25, 'square', 0.10);
                this._tone(80, 0.3, 'sawtooth', 0.06, 0.05);
                this._unlockAchievement('windmill_kick');
            }
        }
    }

    _buildSnowBiome() {
        // 北金星后面 (z < -60) 进入雪地，雪原贴图+白顶松+裂纹冰湖+冰屋
        const snowTex = makeSnowTexture();
        snowTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        const snowGround = new THREE.Mesh(
            new THREE.PlaneGeometry(160, 60),
            new THREE.MeshToonMaterial({ map: snowTex })
        );
        snowGround.rotation.x = -Math.PI / 2;
        snowGround.position.set(0, 0.03, -85);
        snowGround.receiveShadow = true;
        this.scene.add(snowGround);

        // 雪地边缘渐变（深色一点的雪做过渡）
        const edge = new THREE.Mesh(
            new THREE.PlaneGeometry(160, 6),
            new THREE.MeshToonMaterial({ color: 0xd8e0e8, transparent: true, opacity: 0.7 })
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(0, 0.035, -58);
        this.scene.add(edge);

        // 白顶松树（圆锥三层叠）— 散布
        const inSnow = (x, z) => x > -70 && x < 70 && z < -62 && z > -110;
        for (let i = 0; i < 28; i++) {
            const x = (Math.random() - 0.5) * 140;
            const z = -65 - Math.random() * 38;
            if (!inSnow(x, z)) continue;
            this._addPineTree(x, z);
        }

        // 冰湖：裂纹冰面 + 微反光
        const icePond = new THREE.Mesh(
            new THREE.CircleGeometry(7, 32),
            new THREE.MeshStandardMaterial({
                map: makeIceTexture(),
                metalness: 0.05, roughness: 0.45,  // 粗糙度太低会被正午太阳的镜面高光糊成一团白
            })
        );
        icePond.rotation.x = -Math.PI / 2;
        icePond.position.set(-30, 0.06, -90);
        this.scene.add(icePond);
        // 雪堤围岸（白色，盖住冰湖和雪地的接缝）
        const iceRim = new THREE.Mesh(
            new THREE.RingGeometry(6.6, 8.2, 32),
            new THREE.MeshToonMaterial({ color: 0xf6f9ff })
        );
        iceRim.rotation.x = -Math.PI / 2;
        iceRim.position.set(-30, 0.055, -90);
        this.scene.add(iceRim);
        // 冰面碎光（复用湖面波光思路，更慢更冷）
        this._iceGlintTex = makeLakeGlintTexture();
        const iceGlint = new THREE.Mesh(
            new THREE.CircleGeometry(6.8, 32),
            new THREE.MeshBasicMaterial({
                map: this._iceGlintTex,
                transparent: true,
                opacity: 0.10,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        );
        iceGlint.rotation.x = -Math.PI / 2;
        iceGlint.position.set(-30, 0.072, -90);
        this.scene.add(iceGlint);
        this.iceGlint = iceGlint;

        // 雪堆（压扁的白球，错落几堆）
        const driftMat = new THREE.MeshToonMaterial({ color: 0xf6f9ff });
        const nearPondOrIgloo = (x, z) =>
            Math.hypot(x + 30, z + 90) < 10 || Math.hypot(x - 30, z + 80) < 6;
        for (let i = 0; i < 12; i++) {
            const x = (Math.random() - 0.5) * 130;
            const z = -64 - Math.random() * 42;
            if (!inSnow(x, z) || nearPondOrIgloo(x, z)) continue;
            const drift = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), driftMat);
            const s = 0.8 + Math.random() * 1.8;
            drift.scale.set(s, s * 0.32, s * (0.7 + Math.random() * 0.5));
            drift.rotation.y = Math.random() * Math.PI;
            drift.position.set(x, 0, z);
            drift.receiveShadow = true;
            this.scene.add(drift);
        }

        this._initSnowFX();

        // 冰屋（白色半球+黑洞口）
        const igloo = new THREE.Group();
        const dome = new THREE.Mesh(
            new THREE.SphereGeometry(2.0, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshToonMaterial({ color: 0xf5f8fc })
        );
        dome.position.y = 0;
        dome.castShadow = true;
        addOutline(dome, 0.025);
        igloo.add(dome);
        // 砖纹（用矮圆柱叠几圈）
        for (let r = 0; r < 3; r++) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(2.0 - r * 0.6, 0.05, 6, 24),
                new THREE.MeshBasicMaterial({ color: 0xd0d8e0 })
            );
            ring.position.y = 0.4 + r * 0.55;
            ring.rotation.x = Math.PI / 2;
            igloo.add(ring);
        }
        // 入口（小拱）
        const entrance = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.9, 0.7),
            new THREE.MeshToonMaterial({ color: 0xe8eef5 })
        );
        entrance.position.set(0, 0.45, 1.6);
        addOutline(entrance, 0.04);
        igloo.add(entrance);
        const hole = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.55, 0.4),
            new THREE.MeshBasicMaterial({ color: 0x1a1a2e })
        );
        hole.position.set(0, 0.30, 1.85);
        igloo.add(hole);

        igloo.position.set(30, 0, -80);
        igloo.rotation.y = -0.2;
        this.scene.add(igloo);
        // 不做障碍，蛋可以走过去（屋是装饰）

        // 几个雪人（永驻雪地，跟天气雪人不同）
        for (const sp of [[15, -75], [-15, -95], [40, -100]]) {
            this._addSnowman(sp[0], sp[1]);
            // _addSnowman 会把 group 加到 this.snowmen，默认 visible=false
            // 把刚加的设为永久可见
            const justAdded = this.snowmen[this.snowmen.length - 1];
            justAdded.visible = true;
            justAdded.userData.permanent = true;  // 标记雪天切换时不要被关
        }
    }

    _buildDesertBiome() {
        // 南边 (z > +78) 进入太阳沙漠：暖沙地 + 仙人掌 + 沙丘 + 干涸绿洲 + 沙岩金字塔
        // （起点压在 z78 之后，给村屋 z58 / 后院金币 z67 留出缓冲）
        const sandGround = new THREE.Mesh(
            new THREE.PlaneGeometry(170, 84),
            new THREE.MeshToonMaterial({ color: 0xe7cd96 })
        );
        sandGround.rotation.x = -Math.PI / 2;
        sandGround.position.set(0, 0.03, 118);
        sandGround.receiveShadow = true;
        this.scene.add(sandGround);

        // 沙地边缘渐变（深一点的沙做过渡，盖住草沙接缝）
        const edge = new THREE.Mesh(
            new THREE.PlaneGeometry(170, 7),
            new THREE.MeshToonMaterial({ color: 0xd8bb7e, transparent: true, opacity: 0.75 })
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(0, 0.035, 77);
        this.scene.add(edge);

        // 沙波纹（细长扁平的浅色弧，平铺地面增加层次）
        const rippleMat = new THREE.MeshToonMaterial({ color: 0xf0dcab, transparent: true, opacity: 0.5 });
        for (let i = 0; i < 16; i++) {
            const rip = new THREE.Mesh(new THREE.PlaneGeometry(6 + Math.random() * 8, 0.9), rippleMat);
            rip.rotation.x = -Math.PI / 2;
            rip.rotation.z = (Math.random() - 0.5) * 0.6;
            rip.position.set((Math.random() - 0.5) * 150, 0.04, 84 + Math.random() * 70);
            this.scene.add(rip);
        }

        const inDesert = (x, z) => x > -78 && x < 78 && z > 80 && z < 158;

        // 仙人掌散布
        for (let i = 0; i < 18; i++) {
            const x = (Math.random() - 0.5) * 150;
            const z = 82 + Math.random() * 72;
            if (!inDesert(x, z)) continue;
            this._addCactus(x, z);
        }

        // 沙丘（压扁的暖沙球，错落几堆）
        const duneMat = new THREE.MeshToonMaterial({ color: 0xddc086 });
        for (let i = 0; i < 16; i++) {
            const x = (Math.random() - 0.5) * 150;
            const z = 82 + Math.random() * 74;
            if (!inDesert(x, z)) continue;
            const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), duneMat);
            const s = 2 + Math.random() * 4;
            dune.scale.set(s, s * 0.28, s * (0.7 + Math.random() * 0.6));
            dune.rotation.y = Math.random() * Math.PI;
            dune.position.set(x, 0, z);
            dune.receiveShadow = true;
            this.scene.add(dune);
        }

        // 干涸的绿洲：龟裂土圈 + 仅剩一小汪水 + 几棵蔫椰子树（呼应「清泉之珠被埋」故事）
        const oasisX = -30, oasisZ = 116;
        const crackedEarth = new THREE.Mesh(
            new THREE.CircleGeometry(9, 32),
            new THREE.MeshToonMaterial({ color: 0xb89760 })
        );
        crackedEarth.rotation.x = -Math.PI / 2;
        crackedEarth.position.set(oasisX, 0.045, oasisZ);
        this.scene.add(crackedEarth);
        // 仅剩的一小汪水（暗示快干了）
        const puddle = new THREE.Mesh(
            new THREE.CircleGeometry(2.4, 24),
            new THREE.MeshStandardMaterial({ color: 0x5fb9c4, metalness: 0.1, roughness: 0.4, transparent: true, opacity: 0.85 })
        );
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(oasisX, 0.06, oasisZ);
        this.scene.add(puddle);
        this._addPalmTree(oasisX - 5, oasisZ - 2, 0.12);
        this._addPalmTree(oasisX + 4, oasisZ + 3, -0.18);
        this._addPalmTree(oasisX + 6, oasisZ - 4, 0.1);
        // 半埋的「清泉之珠」微光（留给下次任务主线接，先做个发光暗示）
        const gem = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 16, 12),
            new THREE.MeshStandardMaterial({ color: 0x66e0ff, emissive: 0x3399cc, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 })
        );
        gem.position.set(oasisX + 1.5, 0.2, oasisZ + 5);
        this.scene.add(gem);
        this._oasisGem = gem;

        // 沙岩金字塔（沙漠地标，呼应雪区的冰屋）
        const pyramid = new THREE.Mesh(
            new THREE.ConeGeometry(7, 9, 4),
            new THREE.MeshToonMaterial({ color: 0xd9b878 })
        );
        pyramid.position.set(34, 4.4, 110);
        pyramid.rotation.y = Math.PI / 4;
        pyramid.castShadow = true;
        addOutline(pyramid, 0.05);
        this.scene.add(pyramid);
        // 金字塔登记碰撞（蛋绕着走，不穿过）
        this.obstacles.push({
            min: new THREE.Vector3(34 - 5, 0, 110 - 5),
            max: new THREE.Vector3(34 + 5, 7, 110 + 5),
        });

        // 晒白的小石头/骨头点缀
        const boneMat = new THREE.MeshToonMaterial({ color: 0xeae0cf });
        for (let i = 0; i < 8; i++) {
            const x = (Math.random() - 0.5) * 140;
            const z = 84 + Math.random() * 70;
            if (!inDesert(x, z)) continue;
            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + Math.random() * 0.5), boneMat);
            rock.position.set(x, 0.2, z);
            rock.rotation.set(Math.random(), Math.random(), Math.random());
            this.scene.add(rock);
        }

        this._initDesertFX();
    }

    _addCactus(x, z) {
        const group = new THREE.Group();
        const mat = new THREE.MeshToonMaterial({ color: 0x4f9e5a });
        const h = 1.6 + Math.random() * 1.4;
        // 主干
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, h, 10), mat);
        trunk.position.y = h / 2;
        trunk.castShadow = true;
        addOutline(trunk, 0.04);
        group.add(trunk);
        // 1~2 条手臂
        const arms = 1 + (Math.random() > 0.5 ? 1 : 0);
        for (let a = 0; a < arms; a++) {
            const side = a === 0 ? 1 : -1;
            const armY = h * (0.45 + Math.random() * 0.2);
            const hPart = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.6, 8), mat);
            hPart.rotation.z = Math.PI / 2;
            hPart.position.set(side * 0.45, armY, 0);
            group.add(hPart);
            const vPart = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.7, 8), mat);
            vPart.position.set(side * 0.72, armY + 0.55, 0);
            addOutline(vPart, 0.03);
            group.add(vPart);
        }
        // 顶上一朵小红花
        if (Math.random() > 0.4) {
            const flower = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 10, 8),
                new THREE.MeshToonMaterial({ color: 0xff6f8f })
            );
            flower.position.y = h + 0.1;
            flower.scale.y = 0.6;
            group.add(flower);
        }
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI;
        this.scene.add(group);
        // 仙人掌算软障碍（蛋别穿过去）
        this.obstacles.push({
            min: new THREE.Vector3(x - 0.4, 0, z - 0.4),
            max: new THREE.Vector3(x + 0.4, h, z + 0.4),
        });
    }

    // 沙漠专属氛围：贴地飘的热气浮尘（不依赖全局天气）
    _initDesertFX() {
        const count = 160;
        const dp = new Float32Array(count * 3);
        this._dustSpeed = new Float32Array(count);
        this._dustPhase = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            dp[i * 3]     = (Math.random() - 0.5) * 160;
            dp[i * 3 + 1] = Math.random() * 5;
            dp[i * 3 + 2] = 78 + Math.random() * 80;
            this._dustSpeed[i] = 0.3 + Math.random() * 0.7;
            this._dustPhase[i] = Math.random() * Math.PI * 2;
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
        this.desertDust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
            color: 0xf0dca8, size: 0.22,
            transparent: true, opacity: 0.5, depthWrite: false, sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
        }));
        this.desertDust.frustumCulled = false;
        this.scene.add(this.desertDust);
    }

    _updateDesertFX(dt) {
        if (!this.desertDust) return;
        // 玩家离沙漠远就整体跳过
        const nearDesert = this.player.position.z > 62;
        this.desertDust.visible = nearDesert;
        if (!nearDesert) return;
        const t = performance.now() * 0.001;
        const pos = this.desertDust.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            // 热气上升 + 横向飘
            let y = pos.getY(i) + this._dustSpeed[i] * dt * 0.6;
            if (y > 6) y = 0.1;
            pos.setY(i, y);
            pos.setX(i, pos.getX(i) + Math.sin(t * 0.8 + this._dustPhase[i]) * dt * 0.5);
        }
        pos.needsUpdate = true;
        // 半埋的清泉之珠呼吸式微光
        if (this._oasisGem) {
            this._oasisGem.material.emissiveIntensity = 0.8 + Math.sin(t * 2) * 0.5;
        }
        // 绿洲复活渐显（收到清泉之珠后）
        if (this._oasisFx) {
            const fx = this._oasisFx;
            fx.t = Math.min(1, fx.t + dt * 0.5);
            fx.pond.material.opacity = 0.85 * fx.t;
            fx.grassRing.material.opacity = 0.9 * fx.t;
            for (const f of fx.flowers) f.material.opacity = fx.t;
        }
    }

    // ===================== 区域感受系统 =====================
    _initRegionFeel() {
        this._currentRegion = 'home';
        this._coldT = 0; this._heatT = 0; this._coolT = 0;
        this._feelSfxT = 0; this._breathT = 0; this._sweatT = 0;
        this._breathPuffs = [];
        this._sweatDrops = [];

        // 每个区域的进区故事旁白 + 色调
        this._regionMeta = {
            snow:   { story: '❄️ 冰雪国<br>好冷呀～蛋蛋冻得直打哆嗦。<br>听说雪山深处住着孤单的小雪精灵…' },
            desert: { story: '🔥 太阳沙漠<br>好热！汗都冒出来了。<br>绿洲快干了，清泉之珠被埋在沙子里…' },
            lake:   { story: '🌊 月光湖<br>水边好清凉～<br>湖底的老乌龟好像在找什么东西。' },
            home:   { story: '🌿 回到温暖的村庄，真舒服~' },
        };

        // 进区故事气泡（顶部居中卡片）
        this._feelChip = document.createElement('div');
        Object.assign(this._feelChip.style, {
            position: 'fixed', top: '15%', left: '50%',
            transform: 'translate(-50%, -50%) scale(0.9)',
            padding: '14px 26px', maxWidth: '80vw',
            background: 'rgba(0,0,0,0.45)', color: '#fff',
            fontSize: '21px', fontWeight: 'bold', lineHeight: '1.6',
            borderRadius: '18px', textAlign: 'center',
            boxShadow: '0 6px 22px rgba(0,0,0,0.3)',
            zIndex: '21', pointerEvents: 'none',
            transition: 'opacity 0.5s, transform 0.5s', opacity: '0',
            backdropFilter: 'blur(2px)',
        });
        document.body.appendChild(this._feelChip);

        // 全屏色调晕影 overlay（冷蓝/暖橙/清凉青）
        this._tintEl = document.createElement('div');
        Object.assign(this._tintEl.style, {
            position: 'fixed', inset: '0',
            pointerEvents: 'none', zIndex: '15',
            opacity: '0', transition: 'opacity 0.8s',
        });
        document.body.appendChild(this._tintEl);
    }

    _regionAt(x, z) {
        if (z < -60 && Math.abs(x) < 75) return 'snow';
        if (z > 78 && Math.abs(x) < 78) return 'desert';
        if (Math.hypot(x - 48, z + 42) < 26) return 'lake';
        return 'home';
    }

    _updateRegionFeel(dt) {
        if (!this._feelChip) return;
        const p = this.player.position;
        const region = this._regionAt(p.x, p.z);

        // 进入新区域：弹故事旁白 + 进区音效
        if (region !== this._currentRegion) {
            this._currentRegion = region;
            this._showRegionStory(region);
        }

        // 各区"深入度"：越往里感受越强
        let coldTarget = 0, heatTarget = 0, coolTarget = 0;
        if (region === 'snow')   coldTarget = Math.max(0.25, Math.min(1, (-60 - p.z) / 50));
        if (region === 'desert') heatTarget = Math.max(0.25, Math.min(1, (p.z - 78) / 55));
        if (region === 'lake')   coolTarget = 0.6;
        this._coldT = approach(this._coldT, coldTarget, dt * 1.5);
        this._heatT = approach(this._heatT, heatTarget, dt * 1.5);
        this._coolT = approach(this._coolT, coolTarget, dt * 1.5);

        // —— 画面色调晕影 ——
        if (this._coldT > 0.02) {
            this._tintEl.style.background =
                `radial-gradient(ellipse at center, transparent 30%, rgba(90,150,230,0.55) 100%)`;
            this._tintEl.style.opacity = String(this._coldT);
        } else if (this._heatT > 0.02) {
            // 暖橙 + 轻微脉动模拟热浪
            const wob = 0.85 + Math.sin(performance.now() * 0.004) * 0.15;
            this._tintEl.style.background =
                `radial-gradient(ellipse at center, transparent 26%, rgba(238,150,55,0.5) 100%)`;
            this._tintEl.style.opacity = String(Math.min(1, this._heatT * wob));
        } else if (this._coolT > 0.02) {
            this._tintEl.style.background =
                `radial-gradient(ellipse at center, transparent 42%, rgba(80,205,210,0.35) 100%)`;
            this._tintEl.style.opacity = String(this._coolT);
        } else {
            this._tintEl.style.opacity = '0';
        }

        // —— 身体动作（死亡/通关时不抖，免得跟其它动画打架）——
        if (!this.dying && !this.won) {
            this._applyShiver();
            this._applyHeatBody();
        }
        this._updateBreath(dt);   // 冷：吐白气
        this._updateSweat(dt);    // 热：汗珠
        this._updateFeelSfx(dt);  // 冷哆嗦声 / 热知了声
    }

    _applyShiver() {
        if (!this.animRoot) return;
        if (this._coldT > 0.05) {
            const t = performance.now() * 0.001;
            const amp = 0.045 * this._coldT;
            this.animRoot.position.x = Math.sin(t * 38) * amp;
            this.animRoot.rotation.z = Math.sin(t * 41 + 1) * amp * 0.8;
        } else {
            // 回正（也兜底热区/离开后归零）
            this.animRoot.position.x *= 0.8;
            this.animRoot.rotation.z *= 0.8;
        }
    }

    _applyHeatBody() {
        if (!this.animRoot || this._heatT <= 0.05) return;
        // 蔫蔫地：整体压扁一点 + 无力地轻晃（叠在 anim scale 之上）
        const t = performance.now() * 0.001;
        this.animRoot.scale.y *= (1 - 0.07 * this._heatT);
        this.animRoot.rotation.z = Math.sin(t * 1.4) * 0.06 * this._heatT;
    }

    _updateBreath(dt) {
        // 冷天周期性吐白气
        if (this._coldT > 0.2 && !this.dying && !this.won) {
            this._breathT -= dt;
            if (this._breathT <= 0) {
                this._breathT = 1.3 + Math.random() * 0.9;
                this._spawnBreathPuff();
            }
        }
        for (let i = this._breathPuffs.length - 1; i >= 0; i--) {
            const b = this._breathPuffs[i];
            b.life -= dt;
            b.mesh.position.x += b.vx * dt;
            b.mesh.position.y += dt * 0.5;
            b.mesh.position.z += b.vz * dt;
            const k = 1 - b.life / b.full;
            b.mesh.scale.setScalar(0.3 + k * 0.9);
            b.mesh.material.opacity = 0.5 * (1 - k);
            if (b.life <= 0) {
                this.scene.remove(b.mesh);
                b.mesh.geometry.dispose(); b.mesh.material.dispose();
                this._breathPuffs.splice(i, 1);
            }
        }
    }

    _spawnBreathPuff() {
        const p = this.player.position;
        const ry = this.player.rotation.y;
        const fx = Math.sin(ry), fz = -Math.cos(ry);  // 蛋脸朝向
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false })
        );
        mesh.position.set(p.x + fx * 0.7, p.y + 0.9, p.z + fz * 0.7);
        mesh.scale.setScalar(0.3);
        this.scene.add(mesh);
        this._breathPuffs.push({ mesh, life: 1.4, full: 1.4, vx: fx * 0.6, vz: fz * 0.6 });
    }

    _updateSweat(dt) {
        if (this._heatT > 0.25 && !this.dying && !this.won) {
            this._sweatT -= dt;
            if (this._sweatT <= 0) {
                this._sweatT = 0.6 + Math.random() * 0.6;
                this._spawnSweatDrop();
            }
        }
        for (let i = this._sweatDrops.length - 1; i >= 0; i--) {
            const s = this._sweatDrops[i];
            s.life -= dt;
            s.vy -= dt * 6;
            s.mesh.position.y += s.vy * dt;
            if (s.life <= 0 || s.mesh.position.y < 0.06) {
                this.scene.remove(s.mesh);
                s.mesh.geometry.dispose(); s.mesh.material.dispose();
                this._sweatDrops.splice(i, 1);
            }
        }
    }

    _spawnSweatDrop() {
        const p = this.player.position;
        const ry = this.player.rotation.y;
        const fx = Math.sin(ry), fz = -Math.cos(ry);
        const side = (Math.random() - 0.5) * 0.8;
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.08, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xbfe8f5, transparent: true, opacity: 0.9 })
        );
        mesh.scale.y = 1.4;
        // 额头侧边滴落
        mesh.position.set(
            p.x + fx * 0.45 + Math.cos(ry) * side,
            p.y + 1.05,
            p.z + fz * 0.45 + Math.sin(ry) * side
        );
        this.scene.add(mesh);
        this._sweatDrops.push({ mesh, life: 1.3, vy: 0 });
    }

    _updateFeelSfx(dt) {
        if (!this.audioCtx || this.bgmMuted) return;
        this._feelSfxT -= dt;
        if (this._feelSfxT > 0) return;
        if (this._coldT > 0.3) {
            this._feelSfxT = 2.2 + Math.random() * 1.6;
            this._playChatter();
        } else if (this._heatT > 0.3) {
            this._feelSfxT = 3 + Math.random() * 2;
            this._playCicada();
        } else {
            this._feelSfxT = 1;
        }
    }

    _playChatter() {
        // 牙齿打颤：一串极短的高频 click
        for (let i = 0; i < 6; i++) {
            this._tone(880 + Math.random() * 240, 0.04, 'square', 0.022, i * 0.06);
        }
    }

    _playCicada() {
        // 知了：带颤音的方波 buzz
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = 1400;
        lfo.frequency.value = 28;        // 颤音速率
        lfoGain.gain.value = 220;
        lfo.connect(lfoGain); lfoGain.connect(o.frequency);
        const t0 = ctx.currentTime;
        g.gain.value = 0;
        g.gain.linearRampToValueAtTime(0.018, t0 + 0.12);
        g.gain.linearRampToValueAtTime(0.018, t0 + 1.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0); lfo.start(t0);
        o.stop(t0 + 1.7); lfo.stop(t0 + 1.7);
    }

    _showRegionStory(region) {
        const meta = this._regionMeta[region];
        if (!meta) return;
        this._feelChip.innerHTML = meta.story;
        this._feelChip.style.opacity = '1';
        this._feelChip.style.transform = 'translate(-50%, -50%) scale(1)';
        clearTimeout(this._feelTimer);
        this._feelTimer = setTimeout(() => {
            this._feelChip.style.opacity = '0';
            this._feelChip.style.transform = 'translate(-50%, -50%) scale(0.9)';
        }, region === 'home' ? 2200 : 3800);
        // 进区音效提示（遵守静音）
        if (!this.bgmMuted) {
            if (region === 'snow')        [1200, 900, 700].forEach((f, i) => this._tone(f, 0.18, 'sine', 0.05, i * 0.08));
            else if (region === 'desert') [300, 380].forEach((f, i) => this._tone(f, 0.3, 'sawtooth', 0.04, i * 0.12));
            else if (region === 'lake')   [700, 1050, 1400].forEach((f, i) => this._tone(f, 0.14, 'sine', 0.05, i * 0.07));
        }
    }

    // 雪区专属氛围：永驻小雪 + 雪面闪晶（不依赖全局天气）
    _initSnowFX() {
        // 永驻小雪：只飘在雪区上空
        const flakeCount = 240;
        const fp = new Float32Array(flakeCount * 3);
        this._flakeSpeed = new Float32Array(flakeCount);
        this._flakePhase = new Float32Array(flakeCount);
        for (let i = 0; i < flakeCount; i++) {
            fp[i * 3]     = (Math.random() - 0.5) * 140;
            fp[i * 3 + 1] = Math.random() * 12;
            fp[i * 3 + 2] = -58 - Math.random() * 50;
            this._flakeSpeed[i] = 0.8 + Math.random() * 1.4;
            this._flakePhase[i] = Math.random() * Math.PI * 2;
        }
        const flakeGeo = new THREE.BufferGeometry();
        flakeGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
        this.snowFlakes = new THREE.Points(flakeGeo, new THREE.PointsMaterial({
            map: makeSnowflakeTexture(), color: 0xffffff, size: 0.28,
            transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true,
        }));
        this.snowFlakes.frustumCulled = false;
        this.scene.add(this.snowFlakes);

        // 雪面闪晶：贴地小亮点，随机一颗颗闪起再熄灭（阳光下的雪晶）
        const sparkCount = 130;
        const sp = new Float32Array(sparkCount * 3);
        const sc = new Float32Array(sparkCount * 3);
        for (let i = 0; i < sparkCount; i++) {
            sp[i * 3]     = (Math.random() - 0.5) * 150;
            sp[i * 3 + 1] = 0.07;
            sp[i * 3 + 2] = -60 - Math.random() * 48;
            sc[i * 3] = sc[i * 3 + 1] = sc[i * 3 + 2] = 0.1;
        }
        const sparkGeo = new THREE.BufferGeometry();
        sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        sparkGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
        this.snowSparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
            size: 0.16, vertexColors: true, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
        }));
        this.snowSparks.frustumCulled = false;
        this.scene.add(this.snowSparks);
    }

    _updateSnowFX(dt) {
        if (!this.snowFlakes) return;
        // 玩家离雪区远就整体跳过（也不渲染）
        const nearSnow = this.player.position.z < -30;
        this.snowFlakes.visible = nearSnow;
        this.snowSparks.visible = nearSnow;
        if (!nearSnow) return;
        const t = performance.now() * 0.001;
        // 雪花下落 + 横向轻飘
        const fpos = this.snowFlakes.geometry.attributes.position;
        for (let i = 0; i < fpos.count; i++) {
            let y = fpos.getY(i) - this._flakeSpeed[i] * dt;
            if (y < 0) y = 12;
            fpos.setY(i, y);
            fpos.setX(i, fpos.getX(i) + Math.sin(t * 0.8 + this._flakePhase[i]) * dt * 0.5);
        }
        fpos.needsUpdate = true;
        // 闪晶：所有点缓慢变暗，每帧随机点亮几颗
        const scol = this.snowSparks.geometry.attributes.color;
        const arr = scol.array;
        for (let i = 0; i < arr.length; i++) arr[i] *= (1 - dt * 2.2);
        const dayness = this._lastDayness ?? 1;
        for (let k = 0; k < 2; k++) {
            if (Math.random() < 0.5 + dayness * 0.5) {
                const i = Math.floor(Math.random() * scol.count) * 3;
                const b = 0.6 + 0.4 * dayness;
                arr[i] = b; arr[i + 1] = b; arr[i + 2] = b * 1.05;
            }
        }
        scol.needsUpdate = true;
        // 冰面碎光缓慢流动
        if (this._iceGlintTex) {
            this._iceGlintTex.offset.x += dt * 0.008;
            this._iceGlintTex.offset.y += dt * 0.005;
        }
    }

    _addPineTree(x, z) {
        const group = new THREE.Group();
        const trunkH = 1.5 + Math.random() * 0.4;
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.22, trunkH, 8),
            new THREE.MeshToonMaterial({ color: 0x6a3a1a })
        );
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        addOutline(trunk, 0.05);
        group.add(trunk);
        // 3 层圆锥（深绿+厚雪挂）
        const greenMat = new THREE.MeshToonMaterial({ color: 0x2a6a3a });
        const snowMat = new THREE.MeshToonMaterial({ color: 0xf4f8ff });
        const layers = 3;
        let y = trunkH;
        for (let i = layers - 1; i >= 0; i--) {
            const r = 0.55 + i * 0.30;
            const h = 0.85;
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(r, h, 10),
                greenMat
            );
            cone.position.y = y + h / 2;
            cone.castShadow = true;
            addOutline(cone, 0.04);
            group.add(cone);
            // 雪挂：宽扁的雪锥压在每层上沿（像真的积了厚雪）
            const snowCap = new THREE.Mesh(
                new THREE.ConeGeometry(r * 0.88, h * 0.42, 10),
                snowMat
            );
            snowCap.position.y = y + h * 0.72;
            group.add(snowCap);
            y += h * 0.8;
        }
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        group.scale.setScalar(0.9 + Math.random() * 0.4);
        this.scene.add(group);
        this._addPropCollider(x, z, 0.5, 2.6);
    }

    _buildFishingBoat() {
        const group = new THREE.Group();
        // 船身（扁椭圆 = 半圆柱躺平）
        const hull = new THREE.Mesh(
            new THREE.CylinderGeometry(0.7, 0.9, 2.5, 12, 1, false, 0, Math.PI),
            new THREE.MeshToonMaterial({ color: 0x8a5a2e, side: THREE.DoubleSide })
        );
        hull.rotation.z = Math.PI / 2;
        hull.rotation.x = Math.PI / 2;
        hull.position.y = 0.3;
        hull.castShadow = true;
        addOutline(hull, 0.04);
        group.add(hull);
        // 船桨
        const oarMat = new THREE.MeshToonMaterial({ color: 0x6a3a1a });
        const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), oarMat);
        oar.position.set(0.8, 0.5, -0.4);
        oar.rotation.z = Math.PI / 4;
        addOutline(oar, 0.05);
        group.add(oar);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.45), oarMat);
        blade.position.set(1.3, 0.0, -0.95);
        group.add(blade);
        // 小渔夫蛋（坐船里）
        const fisherman = new THREE.Mesh(
            new THREE.SphereGeometry(0.30, 16, 12),
            new THREE.MeshToonMaterial({ color: 0xff9a66 })
        );
        fisherman.scale.set(1, 1.25, 1);
        fisherman.position.y = 0.65;
        fisherman.castShadow = true;
        addOutline(fisherman, 0.06);
        group.add(fisherman);
        // 渔夫帽（小圆锥）
        const hat = new THREE.Mesh(
            new THREE.ConeGeometry(0.32, 0.20, 12),
            new THREE.MeshToonMaterial({ color: 0xf5e6c0 })
        );
        hat.scale.y = 0.4;
        hat.position.y = 1.02;
        addOutline(hat, 0.05);
        group.add(hat);
        // 钓鱼竿
        const rod = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.02, 1.5, 4),
            new THREE.MeshBasicMaterial({ color: 0x2c2c54 })
        );
        rod.position.set(0.4, 1.0, 0.7);
        rod.rotation.x = -0.5;
        rod.rotation.z = 0.3;
        group.add(rod);
        // 钓线（细竖线）
        const line = new THREE.Mesh(
            new THREE.CylinderGeometry(0.005, 0.005, 0.8, 4),
            new THREE.MeshBasicMaterial({ color: 0x2c2c54 })
        );
        line.position.set(0.9, 0.4, 1.4);
        group.add(line);

        group.position.set(48, 0.4, -42);  // 湖中央
        this.scene.add(group);
        this.fishingBoat = group;
    }

    _updateFishingBoat() {
        if (!this.fishingBoat) return;
        const t = performance.now() * 0.001;
        this.fishingBoat.position.y = 0.4 + Math.sin(t * 1.2) * 0.06;
        this.fishingBoat.rotation.z = Math.sin(t * 0.8) * 0.04;
        this.fishingBoat.rotation.y = Math.sin(t * 0.3) * 0.15;
    }

    _buildLighthouse() {
        const group = new THREE.Group();
        // 圆柱塔身（白红条纹用 6 个矮圆柱叠）
        const segH = 1.6;
        const segs = 8;
        for (let i = 0; i < segs; i++) {
            const isWhite = i % 2 === 0;
            const seg = new THREE.Mesh(
                new THREE.CylinderGeometry(1.0 - i * 0.05, 1.05 - i * 0.05, segH, 16),
                new THREE.MeshToonMaterial({ color: isWhite ? 0xfafafa : 0xc83a3a })
            );
            seg.position.y = segH / 2 + i * segH;
            seg.castShadow = true;
            if (i === 0 || i === segs - 1) addOutline(seg, 0.025);
            group.add(seg);
        }
        const totalH = segs * segH;
        // 灯室（玻璃围栏 + 圆顶）
        const lampRoom = new THREE.Mesh(
            new THREE.CylinderGeometry(0.8, 0.85, 1.2, 12),
            new THREE.MeshToonMaterial({ color: 0x2c2c54, transparent: true, opacity: 0.7 })
        );
        lampRoom.position.y = totalH + 0.6;
        group.add(lampRoom);
        // 灯
        const lampBulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 16, 12),
            new THREE.MeshStandardMaterial({
                color: 0xfff5a0, emissive: 0xfff099, emissiveIntensity: 1.5,
            })
        );
        lampBulb.position.y = totalH + 0.6;
        group.add(lampBulb);
        // 圆顶
        const dome = new THREE.Mesh(
            new THREE.SphereGeometry(0.85, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshToonMaterial({ color: 0xc83a3a })
        );
        dome.position.y = totalH + 1.3;
        addOutline(dome, 0.04);
        group.add(dome);
        const tip = new THREE.Mesh(
            new THREE.ConeGeometry(0.1, 0.5, 8),
            new THREE.MeshToonMaterial({ color: 0xc83a3a })
        );
        tip.position.y = totalH + 1.9;
        group.add(tip);

        // 旋转扫光（SpotLight，spinning）
        const beam = new THREE.SpotLight(0xfff099, 0, 35, Math.PI / 7, 0.4, 1);
        beam.position.y = totalH + 0.6;
        beam.target.position.set(10, totalH + 0.3, 0);
        group.add(beam);
        group.add(beam.target);

        group.position.set(82, 0, 62);   // 远东南
        this.scene.add(group);

        this.lighthouseBulb = lampBulb;
        this.lighthouseBeam = beam;
        this.lighthouseTarget = beam.target;
        this.lighthousePhase = 0;
    }

    _updateLighthouse(dt) {
        if (!this.lighthouseBeam) return;
        // 旋转扫光：target 绕灯塔转
        this.lighthousePhase += dt * 0.8;
        const r = 30;
        this.lighthouseTarget.position.set(
            Math.cos(this.lighthousePhase) * r,
            -8,
            Math.sin(this.lighthousePhase) * r
        );
        // 夜里点亮
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const nightness = Math.max(0, -sh + 0.15) / 1.15;
        this.lighthouseBeam.intensity = nightness * 4;
        this.lighthouseBulb.material.emissiveIntensity = 0.5 + nightness * 2;
    }

    _initGreetQuest() {
        this._greeted = new Set();
        this._greetChip = document.getElementById('game-greet');
        this._greetCelebrated = false;
        if (this._greetChip) {
            this._greetChip.textContent = `👋 打招呼 0/${this.npcs.length}`;
        }
    }

    _checkGreets() {
        if (!this.npcs || this._greetCelebrated) return;
        this.npcs.forEach(n => {
            if (this._greeted.has(n)) return;
            if (n.bubble && n.bubble.material.opacity > 0.7) {
                this._greeted.add(n);
                if (this._greetChip) {
                    this._greetChip.textContent = `👋 打招呼 ${this._greeted.size}/${this.npcs.length}`;
                }
                if (this._greeted.size >= this.npcs.length) {
                    this._greetCelebrated = true;
                    this._celebrateGreet();
                }
            }
        });
    }

    _celebrateGreet() {
        // 满 8/8 时给个奖励：右上角弹彩色发光 + 烟花一个
        if (this._greetChip) {
            this._greetChip.textContent = '🎉 全村好朋友！';
            this._greetChip.style.background = 'linear-gradient(90deg, #ff66cc, #ffd700, #66ddff)';
        }
        this._launchFirework();
        this._launchFirework();
        // 拿星音效再来一遍庆贺
        this._playWin();
        this._unlockAchievement('all_greet');
    }

    _initRainbow() {
        // 7 色同心 ring 拼一道弧
        const colors = [0xff5050, 0xffa040, 0xffe066, 0x66ff66, 0x66aaff, 0x6660ff, 0xc060ff];
        this.rainbowGroup = new THREE.Group();
        for (let i = 0; i < 7; i++) {
            const r = 35 + i * 0.7;
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(r, 0.35, 8, 64, Math.PI),
                new THREE.MeshBasicMaterial({
                    color: colors[i], transparent: true, opacity: 0,
                    side: THREE.DoubleSide, fog: false,
                })
            );
            this.rainbowGroup.add(ring);
        }
        // 半圆开口朝下，立在地面上方
        this.rainbowGroup.rotation.z = 0;
        this.rainbowGroup.position.set(0, 0, -50);
        this.rainbowGroup.rotation.x = Math.PI / 2;
        this.rainbowGroup.rotation.y = Math.PI;  // 朝向相机
        this.scene.add(this.rainbowGroup);
        this._rainbowOpacity = 0;
        this._lastWeather = this.weather;
    }

    _updateRainbow(dt) {
        if (!this.rainbowGroup) return;
        // 检测雨→晴切换：触发彩虹
        if (this._lastWeather === 'rain' && this.weather === 'sunny') {
            this._rainbowOpacity = 1.0;
            this._unlockAchievement('see_rainbow');
        }
        this._lastWeather = this.weather;
        // 慢慢淡出
        if (this._rainbowOpacity > 0) {
            this._rainbowOpacity -= dt * 0.06;
            if (this._rainbowOpacity < 0) this._rainbowOpacity = 0;
        }
        this.rainbowGroup.children.forEach(ring => {
            ring.material.opacity = this._rainbowOpacity * 0.75;
        });
    }

    _initSwimming() {
        this.swimming = false;
        this.lakeCenter = { x: 48, z: -42 };
        this.lakeRadius = 7.5;
        this.icePondCenter = { x: -30, z: -90 };
        this.icePondRadius = 7;
    }

    _checkSwimming(dt) {
        const p = this.player.position;
        const dx = p.x - this.lakeCenter.x;
        const dz = p.z - this.lakeCenter.z;
        const distLake = Math.hypot(dx, dz);
        const inLake = distLake < this.lakeRadius;

        if (inLake && !this.swimming && this.player.position.y < 1.0) {
            // 落水瞬间：溅水花
            this.swimming = true;
            this._splashWater(p.x, p.z);
            this._tone(440, 0.15, 'sine', 0.06);
            this._unlockAchievement('first_swim');
        }
        if (!inLake && this.swimming) {
            this.swimming = false;
            // 上岸恢复颜色：下雨天恢复成雨天湿色，否则干色（别把雨天湿色覆盖丢了）
            if (this.bodyMesh) {
                const raining = this.weather === 'rain';
                this.bodyMesh.material.color.setHex(raining ? this._bodyColorWet : this._bodyColorDry);
            }
        }

        if (this.swimming) {
            // 浮力：被水推上来 + 减弱重力
            const surface = 0.5;
            if (this.player.position.y < surface) {
                this.playerVy += 12 * dt;
            }
            this.playerVy *= 0.85;  // 水阻
            this.velocity.x *= 0.92;
            this.velocity.z *= 0.92;
            // 让蛋停在水面附近上下浮
            if (this.player.position.y < 0.2) this.player.position.y = 0.2;
            // 蓝调
            if (this.bodyMesh) {
                this.bodyMesh.material.color.setHex(darkenHex(this._bodyColorDry, 0.65));
            }
        }
    }

    _splashWater(x, z) {
        for (let i = 0; i < 12; i++) {
            const drop = new THREE.Mesh(
                new THREE.SphereGeometry(0.08 + Math.random() * 0.05, 6, 4),
                new THREE.MeshStandardMaterial({
                    color: 0x88c8e8, transparent: true, opacity: 0.85,
                })
            );
            const ang = (i / 12) * Math.PI * 2;
            const sp = 2.5 + Math.random() * 1.5;
            drop.userData = {
                vx: Math.cos(ang) * sp,
                vy: 3.5 + Math.random() * 1.5,
                vz: Math.sin(ang) * sp,
                life: 1.0,
                full: 1.0,
            };
            drop.position.set(x, 0.5, z);
            this.scene.add(drop);
            this.landParticles.push(drop);
        }
    }

    _checkIceSlide(dt) {
        // 冰面打滑：速度衰减系数大幅降低（更滑）
        const p = this.player.position;
        const dx = p.x - this.icePondCenter.x;
        const dz = p.z - this.icePondCenter.z;
        const dist = Math.hypot(dx, dz);
        const onIce = dist < this.icePondRadius && this.onGround;
        if (onIce) {
            // 把已加的减速冲销一部分（粗暴：直接给速度一个回归到目标的弱拉力）
            this.velocity.x *= Math.pow(0.985, dt * 60);
            this.velocity.z *= Math.pow(0.985, dt * 60);
        }
        this._onIce = onIce;
    }

    _initShootingStars() {
        this.shootingStars = [];
        this._meteorTimer = 4 + Math.random() * 6;   // 入夜后较快来第一颗
    }

    _updateShootingStars(dt) {
        const sh = Math.sin(this.dayPhase * Math.PI * 2 - Math.PI / 2);
        const isNight = sh < -0.05;
        if (isNight) {
            this._meteorTimer -= dt;
            if (this._meteorTimer <= 0) {
                this._meteorTimer = 15 + Math.random() * 25;
                this._spawnMeteor();
            }
        }
        // 现有流星更新
        this.shootingStars = this.shootingStars.filter(m => {
            m.life -= dt;
            if (m.life <= 0) {
                this.scene.remove(m.head);
                m.head.geometry.dispose(); m.head.material.dispose();
                if (m.glow) { this.scene.remove(m.glow); m.glow.geometry.dispose(); m.glow.material.dispose(); }
                if (m.trail) { this.scene.remove(m.trail); m.trail.geometry.dispose(); m.trail.material.dispose(); }
                return false;
            }
            m.head.position.x += m.vx * dt;
            m.head.position.y += m.vy * dt;
            m.head.position.z += m.vz * dt;
            if (m.glow) m.glow.position.copy(m.head.position);
            // 拖尾：圆柱轴已在生成时用四元数对齐速度方向，这里只跟位置（尾巴拖在头后面）
            if (m.trail) {
                m.trail.position.copy(m.head.position).addScaledVector(m.dir, -m.trailLen * 0.5);
            }
            // 头两端淡入淡出：刚出现快速亮起，末尾淡出
            const age = 1 - m.life / m.full;            // 0→1
            const fade = Math.min(1, m.life / 0.4) * Math.min(1, age / 0.06 + 0.2);
            m.head.material.opacity = fade;
            if (m.glow) m.glow.material.opacity = fade * 0.5;
            if (m.trail) m.trail.material.opacity = fade * 0.8;
            return true;
        });
    }

    _onMeteorSeen() { this._unlockAchievement('see_meteor'); }

    _spawnMeteor() {
        this._onMeteorSeen();
        // 生成在玩家"正前方"的天空、从一侧横扫到另一侧——保证落在镜头视野里，抬头就看见
        const px = this.player ? this.player.position.x : 0;
        const pz = this.player ? this.player.position.z : 0;
        const yaw = this.cameraYaw || 0;
        const fx = Math.sin(yaw), fz = -Math.cos(yaw);   // 相机前方（水平）
        const rx = Math.cos(yaw), rz = Math.sin(yaw);    // 相机右方
        const side = Math.random() < 0.5 ? 1 : -1;       // 从左还是从右进场
        const ahead = 26 + Math.random() * 8;
        const lateral = 26;
        const startX = px + fx * ahead + rx * (side * lateral);
        const startZ = pz + fz * ahead + rz * (side * lateral);
        // 速度：主要横扫向对侧 + 轻微下落 + 略微朝镜头
        const cross = 23 + Math.random() * 6;
        const vx = -rx * side * cross - fx * 2;
        const vz = -rz * side * cross - fz * 2;
        const vy = -5 - Math.random() * 2;
        const dir = new THREE.Vector3(vx, vy, vz).normalize();

        // 头：大而亮，fog:false（夜雾不染），bloom 抓得到
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.7, 14, 12),
            new THREE.MeshStandardMaterial({
                color: 0xffffff, emissive: 0xfff0b0, emissiveIntensity: 4,
                transparent: true, opacity: 1, fog: false,
            })
        );
        head.position.set(startX, 30 + Math.random() * 8, startZ);
        this.scene.add(head);
        // 柔光晕
        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 14, 12),
            new THREE.MeshBasicMaterial({
                color: 0xffe98a, transparent: true, opacity: 0.5,
                depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
            })
        );
        glow.position.copy(head.position);
        this.scene.add(glow);
        // 拖尾：锥形圆柱（粗端贴头、细端在尾），用四元数把 +Y 轴对齐速度方向
        const trailLen = 9;
        const trail = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.02, trailLen, 10, 1, true),  // 顶(+Y,粗)=头, 底(细)=尾
            new THREE.MeshBasicMaterial({
                color: 0xfff3b0, transparent: true, opacity: 0.8,
                depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            })
        );
        trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        trail.position.copy(head.position).addScaledVector(dir, -trailLen * 0.5);
        this.scene.add(trail);

        this.shootingStars.push({
            head, glow, trail, dir, trailLen,
            vx, vy, vz,
            life: 2.6, full: 2.6,
        });
        // 流星音（短哨）
        this._tone(2000, 0.4, 'sine', 0.03);
        this._tone(1500, 0.4, 'sine', 0.025, 0.05);
    }

    _buildGiantWindmill() {
        const group = new THREE.Group();
        const towerH = 18;
        // 高大圆柱白塔
        const tower = new THREE.Mesh(
            new THREE.CylinderGeometry(1.2, 2.0, towerH, 14),
            new THREE.MeshToonMaterial({ color: 0xfafafa })
        );
        tower.position.y = towerH / 2;
        tower.castShadow = true;
        addOutline(tower, 0.018);
        group.add(tower);
        // 顶部小舱
        const nacelle = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 1.0, 3.5),
            new THREE.MeshToonMaterial({ color: 0xeae0c8 })
        );
        nacelle.position.y = towerH + 0.3;
        addOutline(nacelle, 0.03);
        group.add(nacelle);
        // 3 长叶（绑到 hub）
        const hub = new THREE.Group();
        const bladeMat = new THREE.MeshToonMaterial({ color: 0xf5f5f5 });
        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 8.5, 0.18),
                bladeMat
            );
            blade.position.y = 4.25;
            addOutline(blade, 0.03);
            const arm = new THREE.Group();
            arm.rotation.z = (i / 3) * Math.PI * 2;
            arm.add(blade);
            hub.add(arm);
        }
        hub.position.set(0, towerH + 0.3, 1.8);
        group.add(hub);
        const center = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 16, 12),
            new THREE.MeshToonMaterial({ color: 0x6a3a1a })
        );
        center.position.copy(hub.position);
        group.add(center);

        // 放远景地平线
        group.position.set(-85, 0, 75);
        this.scene.add(group);
        this.animDecor.push({ type: 'giantWindmill', hub });
    }

    // ========= 搜打撤撤离机制 + 宝箱盲盒 + 怪物 + 战斗 =========

    // 魔法阵符文盘贴图（同心圆 + 符文 + 放射刻度，发光紫青）
    _makeMagicCircleTexture() {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, 256, 256);
        const cx = 128, cy = 128;
        ctx.strokeStyle = '#b07cff'; ctx.lineWidth = 3;
        for (const r of [118, 96, 60, 40]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
        // 内三角形 + 反三角形（六芒）
        ctx.strokeStyle = '#7ce0ff'; ctx.lineWidth = 2.5;
        for (const off of [0, Math.PI]) {
            ctx.beginPath();
            for (let k = 0; k < 3; k++) {
                const a = off + k * (Math.PI * 2 / 3) - Math.PI / 2;
                const px = cx + Math.cos(a) * 90, py = cy + Math.sin(a) * 90;
                if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.stroke();
        }
        // 放射刻度 + 符文点
        ctx.fillStyle = '#d9b8ff';
        for (let k = 0; k < 24; k++) {
            const a = k * (Math.PI * 2 / 24);
            const px = cx + Math.cos(a) * 108, py = cy + Math.sin(a) * 108;
            ctx.beginPath(); ctx.arc(px, py, k % 2 ? 2 : 3.5, 0, Math.PI * 2); ctx.fill();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    _buildExtractionPad() {
        const x = 25, z = 35;
        this.extractCenter = { x, z };
        this.extractRadius = 3.0;

        const group = new THREE.Group();
        // 八边形石质台座
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(3.2, 3.5, 0.3, 8),
            new THREE.MeshToonMaterial({ color: 0x6a6280 })
        );
        base.position.y = 0.15;
        base.receiveShadow = true;
        addOutline(base, 0.025);
        group.add(base);
        // 顶部暗盘（深紫石）
        const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(2.6, 2.6, 0.08, 32),
            new THREE.MeshToonMaterial({ color: 0x3a3450 })
        );
        disc.position.y = 0.34;
        group.add(disc);
        // 发光符文盘（贴在盘上，缓慢旋转、激活时更亮）
        const runes = new THREE.Mesh(
            new THREE.CircleGeometry(2.5, 48),
            new THREE.MeshBasicMaterial({
                map: this._makeMagicCircleTexture(), transparent: true, opacity: 0.5,
                blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
            })
        );
        runes.rotation.x = -Math.PI / 2;
        runes.position.y = 0.39;
        group.add(runes);
        this.extractRunes = runes;
        // 发光符文环（状态指示，紫色）
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(2.4, 0.16, 8, 48),
            new THREE.MeshStandardMaterial({
                color: 0x5a3a8a, emissive: 0x2a1a44, emissiveIntensity: 0.3,
            })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.45;
        group.add(ring);
        // 中央魔法光柱（激活时显形，紫青）
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.1, 13, 16, 1, true),
            new THREE.MeshBasicMaterial({
                color: 0x9a5ad6, transparent: true, opacity: 0,
                side: THREE.DoubleSide, depthWrite: false, fog: false,
                blending: THREE.AdditiveBlending,
            })
        );
        beam.position.y = 6.5;
        group.add(beam);
        // 四角符文水晶（八面体）
        this.extractOrbs = [];
        for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const px = Math.cos(ang) * 2.9, pz = Math.sin(ang) * 2.9;
            const pillar = new THREE.Mesh(
                new THREE.CylinderGeometry(0.13, 0.18, 1.4, 6),
                new THREE.MeshToonMaterial({ color: 0x4a4458 })
            );
            pillar.position.set(px, 0.85, pz);
            pillar.castShadow = true;
            addOutline(pillar, 0.04);
            group.add(pillar);
            const orb = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.22),
                new THREE.MeshStandardMaterial({
                    color: 0x9a7ad0, emissive: 0x3a2060, emissiveIntensity: 0.3,
                })
            );
            orb.position.set(px, 1.75, pz);
            group.add(orb);
            this.extractOrbs.push(orb);
        }
        // 招牌
        const signTex = makeSignTexture('魔法阵');
        const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, depthWrite: false }));
        sign.scale.set(2.2, 0.78, 1);
        sign.position.set(0, 3.0, 0);
        group.add(sign);

        group.position.set(x, 0, z);
        this.scene.add(group);
        this.extractRing = ring;
        this.extractBeam = beam;

        // PointLight 激活时点亮场景（紫光）
        this.extractLight = new THREE.PointLight(0xb07cff, 0, 14, 1.3);
        this.extractLight.position.set(x, 3, z);
        this.scene.add(this.extractLight);

        this._buildMagicBird(x, z);
    }

    // 魔法大鸟：定时飞来停在魔法阵上，驮宝藏飞走
    _buildMagicBird(padX, padZ) {
        const g = new THREE.Group();
        const featherMat = new THREE.MeshToonMaterial({ color: 0x7cc8ff, emissive: 0x244a6a, emissiveIntensity: 0.4 });
        const bellyMat = new THREE.MeshToonMaterial({ color: 0xe8f4ff });
        // 身体（蛋形）
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 18, 14), featherMat);
        body.scale.set(1, 1.15, 1.35);
        body.castShadow = true;
        addOutline(body, 0.04);
        g.add(body);
        // 肚子（浅色）
        const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), bellyMat);
        belly.scale.set(0.9, 1.0, 1.1);
        belly.position.set(0, -0.1, 0.35);
        g.add(belly);
        // 头
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), featherMat);
        head.position.set(0, 0.55, 0.55);
        addOutline(head, 0.05);
        g.add(head);
        // 眼睛
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1a1a2e }));
            eye.position.set(sx * 0.16, 0.62, 0.86);
            g.add(eye);
        }
        // 喙
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4), new THREE.MeshToonMaterial({ color: 0xffb43a }));
        beak.position.set(0, 0.5, 0.95);
        beak.rotation.x = Math.PI / 2;
        g.add(beak);
        // 翅膀（两片，会扇）
        this._birdWings = [];
        for (const sx of [-1, 1]) {
            const pivot = new THREE.Group();
            pivot.position.set(sx * 0.5, 0.1, 0);
            const wing = new THREE.Mesh(new THREE.CircleGeometry(1.1, 10, 0, Math.PI), featherMat);
            wing.material.side = THREE.DoubleSide;
            wing.rotation.x = -Math.PI / 2;
            wing.position.set(sx * 0.9, 0, 0);
            pivot.add(wing);
            g.add(pivot);
            this._birdWings.push({ pivot, sx });
        }
        // 尾羽
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 5), featherMat);
        tail.position.set(0, 0, -0.9);
        tail.rotation.x = -Math.PI / 2;
        g.add(tail);
        // 头顶魔法光环
        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(0.4, 0.05, 8, 20),
            new THREE.MeshBasicMaterial({ color: 0xd0a8ff, transparent: true, opacity: 0.8, fog: false, blending: THREE.AdditiveBlending })
        );
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 1.1;
        g.add(halo);
        this._birdHalo = halo;

        g.scale.setScalar(1.5);
        g.visible = false;
        this.scene.add(g);
        this.magicBird = g;
        this._birdPerch = { x: padX, y: 1.4, z: padZ };  // 停在阵中央上方
        this._birdState = 'away';   // away / arriving / landed / leaving
        this._birdT = 0;
        this._birdCarrying = false;
    }

    _startBirdArrive() {
        const b = this.magicBird; if (!b) return;
        this._birdState = 'arriving'; this._birdT = 0;
        const p = this._birdPerch;
        this._birdFrom = { x: p.x + 24, y: 22, z: p.z - 20 };
        b.visible = true;
        b.position.set(this._birdFrom.x, this._birdFrom.y, this._birdFrom.z);
    }

    _startBirdLeave(carrying) {
        const b = this.magicBird; if (!b || this._birdState === 'away') return;
        this._birdState = 'leaving'; this._birdT = 0;
        this._birdCarrying = !!carrying;
        const p = this._birdPerch;
        this._birdFromLeave = { x: b.position.x, y: b.position.y, z: b.position.z };
        this._birdTo = { x: p.x - 26, y: 24, z: p.z + 22 };
    }

    _updateMagicBird(dt) {
        const b = this.magicBird; if (!b || this._birdState === 'away') return;
        const t = performance.now() * 0.001;
        if (this._birdHalo) this._birdHalo.rotation.z += dt * 2;
        const flap = (speed, amp) => {
            const f = Math.sin(t * speed) * amp;
            this._birdWings.forEach(w => { w.pivot.rotation.z = w.sx * (0.2 + f); });
        };
        const p = this._birdPerch;
        if (this._birdState === 'arriving') {
            this._birdT = Math.min(1, this._birdT + dt / 3);
            const ease = 1 - Math.pow(1 - this._birdT, 2);
            const f = this._birdFrom;
            b.position.set(
                f.x + (p.x - f.x) * ease,
                f.y + (p.y - f.y) * ease + Math.sin(this._birdT * Math.PI) * 3,
                f.z + (p.z - f.z) * ease
            );
            b.rotation.y = Math.atan2(p.x - f.x, p.z - f.z);
            flap(20, 0.9);
            if (this._birdT >= 1) this._birdState = 'landed';
        } else if (this._birdState === 'landed') {
            b.position.set(p.x, p.y + Math.sin(t * 2) * 0.12, p.z);
            b.rotation.y = Math.sin(t * 0.6) * 0.3;
            flap(3, 0.25);
        } else if (this._birdState === 'leaving') {
            this._birdT = Math.min(1, this._birdT + dt / 3);
            const ease = this._birdT * this._birdT;
            const f = this._birdFromLeave, to = this._birdTo;
            b.position.set(
                f.x + (to.x - f.x) * ease,
                f.y + (to.y - f.y) * ease,
                f.z + (to.z - f.z) * ease
            );
            b.rotation.y = Math.atan2(to.x - f.x, to.z - f.z);
            flap(22, 1.0);
            if (this._birdT >= 1) { this._birdState = 'away'; b.visible = false; this._birdCarrying = false; }
        }
    }

    _initExtraction() {
        this.extractPhase = 'closed';        // closed=等大鸟 / open=大鸟在
        this.extractPhaseTimer = 25 + Math.random() * 15;  // 首只鸟 25-40s 后到
        this.extractStandT = 0;
        this.extractStandNeed = 5;           // 站满 5 秒起飞
        this.extractOpenDur = 40;            // 大鸟停留 40 秒
        this.extractWinGoal = 80000;         // 宝库存满即"富翁蛋"通关
        this._extractCount = parseInt(localStorage.getItem('eggExtractCount') || '0', 10);
        this._extractChip = document.getElementById('game-extract');
    }

    _updateExtraction(dt) {
        // 状态机：等大鸟 → 大鸟在 → (撤离/超时) → 等下一只
        this.extractPhaseTimer -= dt;
        if (this.extractPhaseTimer <= 0) {
            if (this.extractPhase === 'closed') {
                this.extractPhase = 'open';
                this.extractPhaseTimer = this.extractOpenDur;
                this._playExtractOpen();
                this._startBirdArrive();
                this._showEasterBadge('🦅 大鸟飞来啦！带宝藏站进魔法阵，一起飞回家～');
            } else {
                // 窗口超时没撤 → 大鸟空手飞走，讲清楚"失败"了
                this.extractPhase = 'closed';
                this.extractPhaseTimer = 45 + Math.random() * 25;
                this.extractStandT = 0;
                this._startBirdLeave(false);
                this._showEasterBadge('🦅 大鸟等不及飞走了…下一只待会儿再来');
            }
        }
        // 魔法阵视觉（紫光：激活时符文转、光柱亮、水晶亮）
        const t = performance.now() * 0.001;
        const isOpen = this.extractPhase === 'open';
        if (this.extractRunes) {
            this.extractRunes.rotation.z += dt * (isOpen ? 0.8 : 0.15);
            this.extractRunes.material.opacity = isOpen ? 0.85 + Math.sin(t * 4) * 0.15 : 0.4;
        }
        if (isOpen) {
            this.extractRing.material.emissive.setHex(0xb07cff);
            this.extractRing.material.emissiveIntensity = 1.6 + Math.sin(t * 6) * 0.4;
            this.extractRing.rotation.z = t * 1.5;
            this.extractBeam.material.opacity = 0.12 + Math.sin(t * 4) * 0.04;
            this.extractLight.intensity = 2.4 + Math.sin(t * 5) * 0.5;
            this.extractOrbs.forEach((o, i) => {
                o.material.emissive.setHex(0xb07cff);
                o.material.emissiveIntensity = 2 + Math.sin(t * 8 + i) * 0.5;
                o.rotation.y += dt * 2;
            });
        } else {
            this.extractRing.material.emissive.setHex(0x2a1a44);
            this.extractRing.material.emissiveIntensity = 0.3;
            this.extractBeam.material.opacity = 0;
            this.extractLight.intensity = 0;
            this.extractOrbs.forEach(o => {
                o.material.emissive.setHex(0x3a2060);
                o.material.emissiveIntensity = 0.3;
            });
        }
        // 站阵检测：大鸟在 + 站进阵 + 周围无怪 → 倒数起飞（不再需要凑满金额，带多少走多少）
        this._extractMonsterBlocking = false;
        if (isOpen && !this.dying) {
            const p = this.player.position;
            const dist = Math.hypot(p.x - this.extractCenter.x, p.z - this.extractCenter.z);
            const inZone = dist < this.extractRadius && p.y < 2;
            let monsterBlocking = false;
            if (this.monsters) {
                for (const m of this.monsters) {
                    if (m.state !== 'alive') continue;
                    // 5m 内才算阻拦：守门怪待在老家(5.8m+)不挡，追到阵边才挡
                    if (Math.hypot(m.group.position.x - this.extractCenter.x, m.group.position.z - this.extractCenter.z) < 5) {
                        monsterBlocking = true; break;
                    }
                }
            }
            this._extractMonsterBlocking = monsterBlocking;
            if (inZone && !monsterBlocking) {
                this.extractStandT += dt;
                if (this.extractStandT >= this.extractStandNeed) this._triggerExtraction();
            } else {
                this.extractStandT = Math.max(0, this.extractStandT - dt * 2);
                if (inZone && monsterBlocking) {
                    const now = performance.now();
                    if (!this._lastExtractWarn || now - this._lastExtractWarn > 2200) {
                        this._lastExtractWarn = now;
                        this._showEasterBadge('⚠️ 有怪在阵边！赶走才能起飞');
                    }
                }
            }
        } else {
            this.extractStandT = Math.max(0, this.extractStandT - dt * 3);
        }
        this._renderExtractChip();
    }

    _renderExtractChip() {
        if (!this._extractChip) return;
        const goalTxt = `🏦 ${this.bankedTotal.toLocaleString()}/${this.extractWinGoal.toLocaleString()}`;
        if (this.extractPhase === 'closed') {
            this._extractChip.innerHTML = `🦅 大鸟 <b>${Math.ceil(this.extractPhaseTimer)}s</b> 后到 · ${goalTxt}`;
            this._extractChip.style.background = 'rgba(0, 0, 0, 0.45)';
        } else if (this.extractStandT > 0.05) {
            const remain = Math.max(0, this.extractStandNeed - this.extractStandT);
            this._extractChip.innerHTML = `🦅 起飞准备 <b>${remain.toFixed(1)}s</b> · 别离开魔法阵！`;
            this._extractChip.style.background = 'linear-gradient(90deg, #b07cff, #ffd700)';
        } else if (this._extractMonsterBlocking) {
            this._extractChip.innerHTML = `⚠️ 先赶走怪 · 大鸟还等 <b>${Math.ceil(this.extractPhaseTimer)}s</b>`;
            this._extractChip.style.background = 'linear-gradient(90deg, #ff6b6b, #ffb84d)';
        } else {
            this._extractChip.innerHTML = `🦅 大鸟来了！快站进魔法阵（还停 <b>${Math.ceil(this.extractPhaseTimer)}s</b>）`;
            this._extractChip.style.background = 'rgba(176, 124, 255, 0.55)';
        }
    }

    _playExtractOpen() {
        this._tone(660, 0.4, 'sine', 0.08);
        this._tone(880, 0.4, 'sine', 0.06, 0.15);
        this._tone(1320, 0.6, 'sine', 0.05, 0.30);
    }

    _triggerExtraction() {
        const earned = this.carriedValue;
        this.bankedTotal += earned;
        this._extractCount++;
        try { localStorage.setItem('eggExtractCount', String(this._extractCount)); } catch (e) {}
        this.carriedValue = 0;
        this._renderTreasureChip();
        this._unlockAchievement('first_extract');
        if (this._extractCount >= 3) this._unlockAchievement('three_extract');
        // 大鸟驮着宝藏飞走
        this._startBirdLeave(true);
        this._launchFirework();
        this._launchFirework();
        this._playWin();
        const won = this.bankedTotal >= this.extractWinGoal && !this._treasureWon;
        if (won) {
            this._triggerTreasureWin();
        } else if (this.statusEl) {
            this.statusEl.innerHTML = `✨ <b>大鸟驮着宝藏飞回家啦！</b><br><small style="font-size:18px">这趟带走 💰 ${earned.toLocaleString()} · 宝库已存 ${this.bankedTotal.toLocaleString()} / ${this.extractWinGoal.toLocaleString()}</small>`;
            this.statusEl.style.display = 'block';
            setTimeout(() => { if (this.statusEl) this.statusEl.style.display = 'none'; }, 3000);
        }
        // 立刻进入下一个等待周期（不冻结游戏，继续搜刮）
        this.extractPhase = 'closed';
        this.extractPhaseTimer = 45 + Math.random() * 25;
        this.extractStandT = 0;
        this._renderExtractChip();
    }

    _triggerTreasureWin() {
        this._treasureWon = true;
        for (let i = 0; i < 8; i++) setTimeout(() => this._launchFirework(), i * 220);
        this._playWin();
        this._unlockAchievement && this._unlockAchievement('treasure_tycoon');
        if (this.statusEl) {
            this.statusEl.innerHTML = `🥚✨ <b>富翁蛋！</b><br><small style="font-size:18px">宝库存满 💰 ${this.extractWinGoal.toLocaleString()}！大鸟一趟趟把财富都驮回了家～</small>`;
            this.statusEl.style.display = 'block';
            setTimeout(() => { if (this.statusEl) this.statusEl.style.display = 'none'; }, 5500);
        }
    }

    // ========= 宝箱盲盒 =========
    _buildChests() {
        this.chests = [];
        this.carriedValue = 0;
        this.bankedTotal = 0;      // 每局从 0 攒起，存满 winGoal = 通关
        this._treasureWon = false;

        // 14 种掉落
        this.lootTable = [
            { rarity: 0.20, name: '普通宝石', emoji: '⚪', color: 0xeeeeee, value: 500,    kind: 'gem' },
            { rarity: 0.18, name: '良好宝石', emoji: '🟢', color: 0x66ff66, value: 2000,   kind: 'gem' },
            { rarity: 0.13, name: '稀有宝石', emoji: '🔵', color: 0x66aaff, value: 5000,   kind: 'gem' },
            { rarity: 0.07, name: '史诗宝石', emoji: '🟣', color: 0xc060ff, value: 15000,  kind: 'gem' },
            { rarity: 0.02, name: '传说宝石', emoji: '⭐', color: 0xffaa00, value: 50000,  kind: 'gem' },
            { rarity: 0.04, name: '木剑',     emoji: '🗡️', color: 0x9a6a3a, value: 0,      kind: 'weapon' },
            { rarity: 0.03, name: '小弓',     emoji: '🏹', color: 0x8a5a2e, value: 0,      kind: 'weapon' },
            { rarity: 0.02, name: '魔法书',   emoji: '📕', color: 0xff5050, value: 0,      kind: 'weapon' },
            { rarity: 0.08, name: '破鞋',     emoji: '🥾', color: 0x6a4a2a, value: 0,      kind: 'junk' },
            { rarity: 0.05, name: '烂菜叶',   emoji: '🥬', color: 0x556633, value: 0,      kind: 'junk' },
            { rarity: 0.05, name: '老报纸',   emoji: '📰', color: 0xaaaaaa, value: 0,      kind: 'junk' },
            { rarity: 0.06, name: '诅咒符',   emoji: '💀', color: 0x444444, value: -3000,  kind: 'curse' },
            { rarity: 0.04, name: '黑洞球',   emoji: '🌑', color: 0x222244, value: -5000,  kind: 'curse' },
            { rarity: 0.03, name: '空箱',     emoji: '🕳️', color: 0x666666, value: 0,      kind: 'empty' },
        ];

        for (let i = 0; i < 22; i++) {
            let x, z, ok = false;
            for (let tries = 0; tries < 30; tries++) {
                const ang = Math.random() * Math.PI * 2;
                const r = 10 + Math.random() * 65;
                x = Math.cos(ang) * r;
                z = Math.sin(ang) * r;
                if (this._isValidChestPos(x, z)) { ok = true; break; }
            }
            if (ok) this._addChest(x, z);
        }
        this._renderTreasureChip();
    }

    _isValidChestPos(x, z) {
        if (Math.hypot(x, z) < 8) return false;
        if (Math.hypot(x - 25, z - 35) < 5) return false;
        return true;
    }

    _addChest(x, z) {
        // 外观随机：6 种样式，与 _rollLoot 独立 —— 不能通过外观预判内容
        const styles = [
            { body:0x8a5a2e, lid:0x6a3a1a, band:0xc89020, bands:2, lock:'rect',  lockColor:0xc89020 },  // 经典橡木金边
            { body:0x4a4a52, lid:0x2a2a32, band:0xa0a0a8, bands:2, lock:'rect',  lockColor:0xa0a0a8, studs:true },  // 黑铁箱（铆钉）
            { body:0xb89060, lid:0x9a7048, band:null,     bands:0, lock:'round', lockColor:0x6a4a2a, strap:true },  // 旧皮带木箱
            { body:0xa0c8b0, lid:0x80a890, band:0xddc060, bands:1, lock:'round', lockColor:0xddc060 },  // 玉色镶金
            { body:0x6e2826, lid:0x4a1816, band:0xd4a830, bands:0, lock:'cross', lockColor:0xd4a830, strap:true },  // 暗红海盗
            { body:0xd0c098, lid:0xb09870, band:0x6a4a2a, bands:1, lock:'rect',  lockColor:0x6a4a2a },  // 浅木简朴
        ];
        const s = styles[Math.floor(Math.random() * styles.length)];

        const group = new THREE.Group();
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.55, 0.65),
            new THREE.MeshToonMaterial({ color: s.body })
        );
        body.position.y = 0.275;
        body.castShadow = true;
        addOutline(body, 0.03);
        group.add(body);
        // 横向边带（0/1/2 条）
        if (s.band && s.bands > 0) {
            const bandMat = new THREE.MeshToonMaterial({ color: s.band });
            const band = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.66), bandMat);
            band.position.y = 0.12;
            group.add(band);
            if (s.bands >= 2) {
                const band2 = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.66), bandMat);
                band2.position.y = 0.44;
                group.add(band2);
            }
        }
        // 四角铆钉（铁箱专属）
        if (s.studs) {
            const studMat = new THREE.MeshToonMaterial({ color: s.band || 0xa0a0a8 });
            const studGeo = new THREE.SphereGeometry(0.045, 6, 4);
            for (const [sx, sy] of [[-0.4, 0.07], [0.4, 0.07], [-0.4, 0.47], [0.4, 0.47]]) {
                const stud = new THREE.Mesh(studGeo, studMat);
                stud.position.set(sx, sy, 0.33);
                group.add(stud);
            }
        }
        // 皮带（旧/海盗箱）
        if (s.strap) {
            const strapMat = new THREE.MeshToonMaterial({ color: 0x4a2818 });
            const strapV = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.04), strapMat);
            strapV.position.set(0, 0.275, 0.34);
            group.add(strapV);
            const strapH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.04), strapMat);
            strapH.position.set(0, 0.30, 0.34);
            group.add(strapH);
        }
        // 锁：方/圆/十字
        let lock;
        if (s.lock === 'rect') {
            lock = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.18, 0.08),
                new THREE.MeshToonMaterial({ color: s.lockColor })
            );
        } else if (s.lock === 'round') {
            lock = new THREE.Mesh(
                new THREE.SphereGeometry(0.10, 10, 8),
                new THREE.MeshToonMaterial({ color: s.lockColor })
            );
        } else if (s.lock === 'cross') {
            lock = new THREE.Group();
            const lm = new THREE.MeshToonMaterial({ color: s.lockColor });
            lock.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.04), lm));
            lock.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.04), lm));
        }
        if (lock) {
            lock.position.set(0, 0.42, 0.36);
            group.add(lock);
        }
        // 盖子（pivot 在后铰链处）
        const lidPivot = new THREE.Group();
        lidPivot.position.set(0, 0.55, -0.325);
        const lid = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 0.18, 0.65),
            new THREE.MeshToonMaterial({ color: s.lid })
        );
        lid.position.set(0, 0.09, 0.325);
        lid.castShadow = true;
        addOutline(lid, 0.03);
        lidPivot.add(lid);
        group.add(lidPivot);
        // 内部光（开盖发光）
        const innerLight = new THREE.PointLight(0xffd700, 0, 4, 1.5);
        innerLight.position.set(0, 0.35, 0);
        group.add(innerLight);

        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
        const c = {
            group, lidPivot, light: innerLight, body, lid,
            origBodyHex: s.body, origLidHex: s.lid,
            x, z, state: 'closed', animT: 0,
            rewardSprite: null,
            golden: false, mimic: false, respawnT: 0,
        };
        this.chests.push(c);
        this._rollChestVariant(c);  // 决定本箱是普通/金箱/咬人箱并上色
        // 注册为障碍（防止穿过）— 小一点的 AABB
        this.obstacles.push({
            min: new THREE.Vector3(x - 0.5, 0, z - 0.4),
            max: new THREE.Vector3(x + 0.5, 0.6, z + 0.4),
        });
    }

    // 决定一只箱子的变体（每次刷新都重掷）：金箱一眼识别、咬人箱外观与普通箱无异（不能预判）
    _rollChestVariant(c) {
        const dist = Math.hypot(c.x, c.z);
        const tier = dist < 25 ? 0 : dist < 55 ? 1 : 2;
        // 越远金箱越多、咬人箱也越多（越远越好越危险）
        const goldChance  = [0.05, 0.10, 0.18][tier];
        const mimicChance = [0.06, 0.10, 0.15][tier];
        const roll = Math.random();
        c.golden = roll < goldChance;
        c.mimic = !c.golden && roll < goldChance + mimicChance;
        // 上色
        if (c.golden) {
            c.body.material.color.setHex(0xffcf40);
            c.body.material.emissive = c.body.material.emissive || new THREE.Color();
            c.body.material.emissive.setHex(0x8a6010);
            c.lid.material.color.setHex(0xffe070);
            c.lid.material.emissive = c.lid.material.emissive || new THREE.Color();
            c.lid.material.emissive.setHex(0x8a6010);
        } else {
            // 普通 / 咬人箱外观一致：还原本来的木色（咬人箱故意不露馅）
            c.body.material.color.setHex(c.origBodyHex);
            if (c.body.material.emissive) c.body.material.emissive.setHex(0x000000);
            c.lid.material.color.setHex(c.origLidHex);
            if (c.lid.material.emissive) c.lid.material.emissive.setHex(0x000000);
            c.light.intensity = 0;
        }
    }

    _updateChests(dt) {
        if (!this.chests) return;
        const p = this.player.position;
        const t = performance.now() * 0.001;
        for (const c of this.chests) {
            if (c.state === 'closed') {
                // 金箱：轻飘 + 脉冲金光（一眼识别）
                if (c.golden) {
                    c.group.position.y = Math.sin(t * 2 + c.x) * 0.12 + 0.05;
                    c.group.rotation.y += dt * 0.6;
                    c.light.color.setHex(0xffd23a);
                    c.light.intensity = 1.4 + Math.sin(t * 4) * 0.5;
                }
                const dx = p.x - c.x, dz = p.z - c.z;
                if (Math.hypot(dx, dz) < 1.6 && p.y < 1.6) this._openChest(c);
            } else if (c.state === 'opening') {
                c.animT += dt;
                // 盖子开 0→-1.3 rad
                c.lidPivot.rotation.x = Math.max(-1.3, -c.animT * 2.5);
                c.light.color.setHex(0xffd700);
                c.light.intensity = Math.min(2.2, c.animT * 4);
                if (c.rewardSprite) {
                    c.rewardSprite.position.y = 0.6 + c.animT * 1.2;
                    c.rewardSprite.material.rotation = t * 2;
                    if (c.animT > 1.2) {
                        c.rewardSprite.material.opacity = Math.max(0, 1 - (c.animT - 1.2) * 1.2);
                    }
                }
                if (c.animT > 2.5) {
                    c.state = 'opened';
                    c.respawnT = 22 + Math.random() * 16;  // 22-38s 后重新长出宝箱
                    if (c.rewardSprite) {
                        c.group.remove(c.rewardSprite);
                        c.rewardSprite.material.map?.dispose();
                        c.rewardSprite.material.dispose();
                        c.rewardSprite = null;
                    }
                    c.light.intensity = 0.2;  // 空盒留一点微光
                }
            } else if (c.state === 'opened') {
                // 刷新倒计时：玩家不在近旁时才长出来（别在脚下突然弹箱）
                c.respawnT -= dt;
                if (c.respawnT <= 0) {
                    const near = Math.hypot(p.x - c.x, p.z - c.z) < 4;
                    if (!near) this._respawnChest(c);
                }
            } else if (c.state === 'popping') {
                // 刷新弹出：盖子合上 + 缩放从 0 弹到 1
                c.animT += dt;
                const s = Math.min(1, c.animT * 2.2);
                const ease = 1 - Math.pow(1 - s, 3);
                c.group.scale.setScalar(ease);
                if (c.animT >= 0.5) {
                    c.group.scale.setScalar(1);
                    c.state = 'closed';
                }
            }
        }
    }

    _respawnChest(c) {
        c.lidPivot.rotation.x = 0;
        c.group.position.y = 0;
        c.group.visible = true;        // 咬人箱怪那波把箱体藏了，刷新时恢复
        c.group.scale.setScalar(0.01);
        c.light.intensity = 0;
        c.animT = 0;
        c.state = 'popping';
        this._rollChestVariant(c);   // 重新掷变体：这次可能变成金箱/咬人箱
        this._tone(520, 0.12, 'sine', 0.04);
    }

    _rollLoot(dist = 30) {
        // 距离分层：越远高级宝石越多、垃圾越少，但诅咒也越多（越好越危险）
        const tier = dist < 25 ? 0 : dist < 55 ? 1 : 2;
        const weights = this.lootTable.map(it => {
            let w = it.rarity;
            if (it.kind === 'gem') {
                const lvl = it.value >= 50000 ? 4 : it.value >= 15000 ? 3 : it.value >= 5000 ? 2 : it.value >= 2000 ? 1 : 0;
                w *= Math.pow([1, 1.8, 3.2][tier], lvl / 2);
                if (lvl === 0) w *= [1, 0.7, 0.4][tier];      // 低级宝石远处变少
            } else if (it.kind === 'junk' || it.kind === 'empty') {
                w *= [1, 0.6, 0.3][tier];                      // 垃圾远处变少
            } else if (it.kind === 'curse') {
                w *= [1, 1.1, 1.35][tier];                     // 诅咒远处变多
            }
            return w;
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < this.lootTable.length; i++) {
            if (r < weights[i]) return this.lootTable[i];
            r -= weights[i];
        }
        return this.lootTable[0];
    }

    _triggerMimic(c) {
        // 咬人箱：咬一口（掉血+击退）后站起来变成怪，箱体暂时消失、稍后再刷新成箱
        c.state = 'opened';
        c.respawnT = 26 + Math.random() * 14;
        c.group.visible = false;
        const p = this.player.position;
        this._showEasterBadge('😱 是咬人箱！');
        this._tone(110, 0.18, 'sawtooth', 0.09);
        this._tone(70, 0.3, 'square', 0.07, 0.08);
        if (this._invincible <= 0) this._hurtPlayer(1, p.x - c.x, p.z - c.z);
        this._addMonster(c.x, c.z, 'mimic');
    }

    _openChest(c) {
        if (c.mimic) { this._triggerMimic(c); return; }
        c.state = 'opening';
        c.animT = 0;
        c.group.position.y = 0;  // 金箱落地停转
        const dist = Math.hypot(c.x, c.z);
        let loot;
        if (c.golden) {
            // 金箱保底高级宝石：70% 史诗、30% 传说
            const epic = this.lootTable.find(it => it.value === 15000);
            const legend = this.lootTable.find(it => it.value === 50000);
            loot = Math.random() < 0.3 ? legend : epic;
        } else {
            loot = this._rollLoot(dist);
        }

        // 应用效果
        if (loot.kind === 'gem' || loot.kind === 'curse') {
            this.carriedValue = Math.max(0, this.carriedValue + loot.value);
            this._renderTreasureChip();
        }
        if (loot.kind === 'weapon' || loot.kind === 'junk') {
            this._addToInventory(loot.emoji);
        }

        // 飞出的 emoji 精灵
        const cv = document.createElement('canvas');
        cv.width = 128; cv.height = 128;
        const ctx = cv.getContext('2d');
        ctx.font = '100px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(loot.emoji, 64, 64);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false,
        }));
        sprite.scale.set(0.8, 0.8, 1);
        sprite.position.set(0, 0.5, 0);
        c.group.add(sprite);
        c.rewardSprite = sprite;

        // 文本提示
        const sign = loot.value > 0 ? '+' : (loot.value < 0 ? '' : '');
        const valText = loot.value !== 0 ? ` ${sign}${loot.value.toLocaleString()}` : '';
        this._showEasterBadge(`${loot.emoji} ${loot.name}${valText}`);

        // 音效（按 kind 决定）
        if (loot.kind === 'gem') {
            const pitch = 400 + Math.log2(loot.value / 500 + 1) * 250;
            this._tone(pitch, 0.15, 'sine', 0.07);
            this._tone(pitch * 1.5, 0.2, 'sine', 0.05, 0.08);
            if (loot.value >= 50000) {
                this._launchFirework();
                this._tone(pitch * 2.2, 0.3, 'sine', 0.05, 0.16);
                this._unlockAchievement('legendary_loot');
            } else if (loot.value >= 15000) {
                this._tone(pitch * 1.8, 0.25, 'sine', 0.05, 0.14);
            }
        } else if (loot.kind === 'curse') {
            this._tone(120, 0.4, 'sawtooth', 0.08);
            this._tone(80, 0.5, 'square', 0.06, 0.1);
        } else if (loot.kind === 'weapon') {
            this._tone(700, 0.15, 'square', 0.05);
            this._tone(900, 0.2, 'triangle', 0.04, 0.08);
        } else {
            this._tone(300, 0.2, 'triangle', 0.04);
        }
    }

    _renderTreasureChip() {
        if (!this._treasureChip) this._treasureChip = document.getElementById('game-treasure');
        if (!this._treasureChip) return;
        // 携带=身上(被打倒会丢)；提示带去魔法阵存进宝库才算数
        const carried = this.carriedValue || 0;
        this._treasureChip.innerHTML = carried > 0
            ? `💰 携带 <b>${carried.toLocaleString()}</b> <small>(带去魔法阵才保险)</small>`
            : `💰 携带 <b>0</b> <small>(开宝箱搜刮宝藏)</small>`;
        this._treasureChip.style.background = carried > 0
            ? 'linear-gradient(90deg, #c89020, #ffd700)'
            : 'rgba(0, 0, 0, 0.5)';
    }

    // ========= 怪物 + 玩家血量 + 战斗 =========
    _buildMonsters() {
        this.monsters = [];
        this.playerHP = 5;
        this.playerHPMax = 5;
        this._attackCooldown = 0;
        this._invincible = 0;
        // 头顶血条 + 首画血条延后：此刻 this.player 还没建（_buildPlayer 在 _buildWorld 之后）
        setTimeout(() => { this._buildPlayerHPBar(); this._renderPlayerHP(); }, 50);
        // 按距离分布：近处普通、中圈混快怪、远处大怪镇守（越远越危险）
        const spots = [
            { x: 18, z: -8,  type: 'normal' },   // 东路
            { x: -18, z: -8, type: 'normal' },   // 西路
            { x: 0, z: -25,  type: 'fast' },     // 北路（中圈）
            { x: 22, z: 28,  type: 'normal' },   // 撤离点附近（阻拦）
            { x: 30, z: 38,  type: 'tank' },     // 撤离点外（守门大怪）
            { x: -55, z: 30, type: 'fast' },     // 远·西南
            { x: 50, z: -50, type: 'tank' },     // 远·东北（守好货）
            { x: -45, z: -55, type: 'tank' },    // 远·西北
        ];
        spots.forEach(s => this._addMonster(s.x, s.z, s.type));
    }

    _addMonster(x, z, type = 'normal') {
        const cfg = MONSTER_TYPES[type] || MONSTER_TYPES.normal;
        const group = new THREE.Group();
        const r = cfg.r;
        const isMimic = type === 'mimic';
        // 身体：幽灵类用半透明蛋身；咬人箱用不透明木色蛋身（像箱子站起来）
        const bodyGeo = new THREE.SphereGeometry(r, 20, 16);
        bodyGeo.scale(1, 1.2, 1);
        bodyGeo.translate(0, r * 1.2, 0);
        const body = new THREE.Mesh(
            bodyGeo,
            new THREE.MeshToonMaterial({
                color: cfg.color, transparent: !isMimic, opacity: isMimic ? 1 : 0.92,
            })
        );
        body.castShadow = true;
        addOutline(body, 0.05);
        group.add(body);
        // 大圆眼（白+黑）
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(r * 0.18, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            eye.position.set(sx * r * 0.3, r * 1.55, -r * 0.78);
            group.add(eye);
            const pupil = new THREE.Mesh(
                new THREE.SphereGeometry(r * 0.10, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0x1a0a1a })
            );
            pupil.position.set(sx * r * 0.3, r * 1.55, -r * 0.92);
            group.add(pupil);
        }
        // 牙：普通一颗小尖牙；咬人箱/大怪用一排锯齿（更凶）
        const fangCount = (isMimic || type === 'tank') ? 5 : 1;
        const fangMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let f = 0; f < fangCount; f++) {
            const fang = new THREE.Mesh(new THREE.ConeGeometry(r * 0.1, r * 0.26, 4), fangMat);
            const off = fangCount === 1 ? 0 : (f / (fangCount - 1) - 0.5) * r * 1.1;
            fang.position.set(off, r * 1.02, -r * 0.82);
            fang.rotation.x = Math.PI;
            group.add(fang);
        }
        // 快怪加一对小翅膀（视觉区分）
        if (type === 'fast') {
            const wingMat = new THREE.MeshToonMaterial({ color: 0xffd0dc, side: THREE.DoubleSide });
            for (const sx of [-1, 1]) {
                const wing = new THREE.Mesh(new THREE.CircleGeometry(r * 0.7, 8, 0, Math.PI), wingMat);
                wing.position.set(sx * r * 0.9, r * 1.3, 0);
                wing.rotation.y = sx * 0.6;
                group.add(wing);
                m_wing(group, wing);
            }
        }
        function m_wing(g, w) { (g.userData.wings = g.userData.wings || []).push(w); }

        // 头顶 HP bar
        const hpCv = document.createElement('canvas');
        hpCv.width = 80; hpCv.height = 12;
        const hpTex = new THREE.CanvasTexture(hpCv);
        hpTex.colorSpace = THREE.SRGBColorSpace;
        const hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: hpTex, depthWrite: false, transparent: true,
        }));
        hpSprite.scale.set(1.0 + r, 0.18, 1);
        hpSprite.position.y = r * 2.5 + 0.3;
        group.add(hpSprite);

        group.position.set(x, 0, z);
        this.scene.add(group);
        const m = {
            group, body, hpSprite, hpCv, hpTex, type,
            home: new THREE.Vector3(x, 0, z),
            hp: cfg.hp, maxHp: cfg.hp,
            speed: cfg.speed, dmg: cfg.dmg, knock: cfg.knock, aggro: cfg.aggro, drop: cfg.drop,
            wings: group.userData.wings || null,
            state: 'alive',
            respawnT: 0,
            attackCD: 0,
            phase: Math.random() * Math.PI * 2,
            hitFlash: 0,
            temporary: isMimic,   // 咬人箱怪被打倒后不复活（它本是宝箱）
        };
        this._drawMonsterHP(m);
        this.monsters.push(m);
        return m;
    }

    _drawMonsterHP(m) {
        const ctx = m.hpCv.getContext('2d');
        ctx.clearRect(0, 0, 80, 12);
        // 底
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, 80, 12);
        // 血
        const pct = Math.max(0, m.hp / m.maxHp);
        ctx.fillStyle = pct > 0.6 ? '#66ff66' : (pct > 0.3 ? '#ffd700' : '#ff5050');
        ctx.fillRect(2, 2, 76 * pct, 8);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, 80, 12);
        m.hpTex.needsUpdate = true;
    }

    _updateMonsters(dt) {
        if (!this.monsters) return;
        // 室内 FPS 视角下头顶血条会糊在镜头上，藏起来
        if (this._playerHPBar) this._playerHPBar.visible = !this.isInsideHouse;
        const t = performance.now() * 0.001;
        const p = this.player.position;
        // 刚躲进房子且附近有正在追的怪 → 提示"安全了"
        if (this.isInsideHouse && !this._wasInsideHouse) {
            const chased = this.monsters.some(m => m.state === 'alive' &&
                Math.hypot(m.group.position.x - p.x, m.group.position.z - p.z) < 12);
            if (chased) this._showEasterBadge('🏠 安全了！怪物进不来');
        }
        this._wasInsideHouse = this.isInsideHouse;
        for (const m of this.monsters) {
            if (m.state === 'ko') {
                if (m.temporary) continue;  // 咬人箱怪不复活，等被清出列表
                m.respawnT -= dt;
                if (m.respawnT <= 0) {
                    m.state = 'alive';
                    m.hp = m.maxHp;
                    m.group.visible = true;
                    m.group.position.copy(m.home);
                    m.group.position.y = 0;
                    this._drawMonsterHP(m);
                }
                continue;
            }
            // 漂浮（大怪沉、快怪轻快）
            const bobAmp = m.type === 'tank' ? 0.06 : (m.type === 'fast' ? 0.16 : 0.10);
            const bobSpd = m.type === 'fast' ? 4 : 2;
            m.group.position.y = 0.15 + Math.sin(t * bobSpd + m.phase) * bobAmp;
            // 快怪扇翅
            if (m.wings) {
                const flap = Math.sin(t * 18 + m.phase) * 0.5;
                m.wings.forEach((w, wi) => { w.rotation.y = (wi === 0 ? 1 : -1) * (0.6 + flap); });
            }
            // AI：玩家进 aggro 范围 → 追；但玩家躲进房子里 → 放弃追、回老家（房子=避难所）
            const dx = p.x - m.group.position.x;
            const dz = p.z - m.group.position.z;
            const dist = Math.hypot(dx, dz);
            const SPEED = m.speed;
            const chasing = !this.isInsideHouse && dist < m.aggro && dist > 0.6;
            if (chasing) {
                m.group.position.x += (dx / dist) * SPEED * dt;
                m.group.position.z += (dz / dist) * SPEED * dt;
                m.group.rotation.y = Math.atan2(dx, dz);
            } else {
                // 不追（出 aggro 或玩家在屋内）→ 慢慢晃回老家
                const hx = m.home.x - m.group.position.x;
                const hz = m.home.z - m.group.position.z;
                const hd = Math.hypot(hx, hz);
                if (hd > 0.3) {
                    m.group.position.x += (hx / hd) * SPEED * 0.5 * dt;
                    m.group.position.z += (hz / hd) * SPEED * 0.5 * dt;
                    m.group.rotation.y = Math.atan2(hx, hz);
                }
            }
            // 攻击玩家：1.0m 内 1s 一次，按种类扣血（屋内不挨打）
            m.attackCD -= dt;
            if (!this.isInsideHouse && dist < 1.0 + m.r && m.attackCD <= 0 && this._invincible <= 0) {
                m.attackCD = 1.0;
                this._hurtPlayer(m.dmg, dx, dz);
            }
            // 受击闪光
            if (m.hitFlash > 0) {
                m.hitFlash -= dt;
                m.body.material.emissive = m.body.material.emissive || new THREE.Color();
                m.body.material.emissive.setHex(m.hitFlash > 0 ? 0xff5050 : 0x000000);
            }
        }
        // 清理被打倒的临时怪（咬人箱怪）：从场景和列表移除
        if (this._monsterReap) {
            for (const m of this._monsterReap) {
                this.scene.remove(m.group);
                const idx = this.monsters.indexOf(m);
                if (idx >= 0) this.monsters.splice(idx, 1);
            }
            this._monsterReap.length = 0;
        }
        if (this._attackCooldown > 0) this._attackCooldown -= dt;
        if (this._invincible > 0) this._invincible -= dt;
    }

    _doMeleeAttack() {
        if (this._attackCooldown > 0) return;
        this._attackCooldown = 0.6;
        const p = this.player.position;
        let hit = false;
        for (const m of this.monsters) {
            if (m.state !== 'alive') continue;
            const dx = p.x - m.group.position.x;
            const dz = p.z - m.group.position.z;
            if (Math.hypot(dx, dz) < 1.5) {
                m.hp -= 1;
                m.hitFlash = 0.2;
                this._drawMonsterHP(m);
                this._tone(900, 0.1, 'square', 0.06);
                if (m.hp <= 0) {
                    this._koMonster(m);
                }
                hit = true;
            }
        }
        if (!hit) this._tone(200, 0.08, 'sine', 0.03); // 空挥
    }

    _koMonster(m) {
        m.state = 'ko';
        m.group.visible = false;
        m.respawnT = 30;
        this._launchFirework();
        this._tone(1320, 0.2, 'sine', 0.07);
        this._unlockAchievement('first_ko');
        // 掉落奖励（咬人箱怪打倒给宝石，回报冒险风险）
        if (m.drop > 0) {
            this.carriedValue = Math.max(0, this.carriedValue + m.drop);
            this._renderTreasureChip();
            this._showEasterBadge(`💎 打倒咬人箱！+${m.drop.toLocaleString()}`);
            this._tone(1000, 0.18, 'sine', 0.07, 0.1);
        }
        // 临时怪（咬人箱怪）标记回收，不复活
        if (m.temporary) {
            (this._monsterReap = this._monsterReap || []).push(m);
        }
    }

    _hurtPlayer(dmg, fromDx, fromDz) {
        this.playerHP = Math.max(0, this.playerHP - dmg);
        this._invincible = 1.0;
        this._renderPlayerHP();
        this._hpBarFlash = 0.4;              // 头顶血条放大闪一下
        // 击退
        const norm = Math.hypot(fromDx, fromDz) || 1;
        this.velocity.x += (fromDx / norm) * 6;
        this.velocity.z += (fromDz / norm) * 6;
        this.playerVy = 3;
        this.onGround = false;
        // 蛋身闪红（旧代码作用在 player.children 的 Group 上无效，改为整只蛋的网格 emissive）
        this._hurtFlashT = 0.3;
        // 一眼能懂的受击反馈：全屏红光晕 + 头顶飘 "-N"
        this._flashDamageScreen();
        this._spawnDamageNumber(dmg);
        this._tone(150, 0.2, 'sawtooth', 0.09);
        this._tone(90, 0.25, 'square', 0.06, 0.05);
        if (this.playerHP <= 0) this._playerDown();
    }

    // 受击视觉：蛋身闪红 + 头顶血条脉动（每帧调用）
    _updateHurtFlash(dt) {
        if (!this._playerHurtMeshes && this.player) {
            this._playerHurtMeshes = [];
            this.player.traverse(o => {
                if (o.isMesh && o.material && o.material.emissive) this._playerHurtMeshes.push(o);
            });
        }
        if (this._hurtFlashT > 0) {
            this._hurtFlashT = Math.max(0, this._hurtFlashT - dt);
            const k = this._hurtFlashT / 0.3;
            this._playerHurtMeshes.forEach(m => m.material.emissive.setRGB(0.95 * k, 0, 0));
        }
        if (this._hpBarFlash > 0 && this._playerHPBar) {
            this._hpBarFlash = Math.max(0, this._hpBarFlash - dt);
            const s = 1 + 0.5 * (this._hpBarFlash / 0.4);
            this._playerHPBar.scale.set(1.3 * s, 0.21 * s, 1);
        }
    }

    // 全屏红光晕（DOM 覆盖层，受伤一闪）
    _flashDamageScreen() {
        if (!this._dmgOverlay) {
            const d = document.createElement('div');
            d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:46;opacity:0;' +
                'background:radial-gradient(ellipse at center, rgba(210,0,0,0) 45%, rgba(210,0,0,0.6) 100%);';
            document.body.appendChild(d);
            this._dmgOverlay = d;
        }
        const d = this._dmgOverlay;
        d.style.transition = 'none';
        d.style.opacity = '1';
        void d.offsetWidth;  // 强制重排，让下面的过渡从 1 开始
        d.style.transition = 'opacity 0.45s ease-out';
        d.style.opacity = '0';
    }

    // 头顶飘 "-N" 伤害数字
    _spawnDamageNumber(dmg) {
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 72;
        const ctx = cv.getContext('2d');
        ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 7; ctx.strokeStyle = '#5a0000'; ctx.strokeText('-' + dmg, 64, 38);
        ctx.fillStyle = '#ff5252'; ctx.fillText('-' + dmg, 64, 38);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false,
        }));
        sp.scale.set(1.0, 0.56, 1);
        sp.position.copy(this.player.position);
        sp.position.y += 1.5;
        sp.position.x += (Math.random() - 0.5) * 0.4;
        this.scene.add(sp);
        (this._dmgNumbers = this._dmgNumbers || []).push({ sp, life: 1.0 });
    }

    _updateDamageNumbers(dt) {
        if (!this._dmgNumbers || !this._dmgNumbers.length) return;
        this._dmgNumbers = this._dmgNumbers.filter(d => {
            d.life -= dt;
            if (d.life <= 0) {
                this.scene.remove(d.sp);
                d.sp.material.map.dispose(); d.sp.material.dispose();
                return false;
            }
            d.sp.position.y += dt * 1.2;
            d.sp.material.opacity = Math.min(1, d.life / 0.4);
            return true;
        });
    }

    _playerDown() {
        // 倒下：扔掉宝物，回广场，满血
        this._showEasterBadge(`💀 倒下了！丢失 💰 ${this.carriedValue.toLocaleString()}`);
        this.carriedValue = 0;
        this._renderTreasureChip();
        this.player.position.set(0, 0.6, 6);
        this.velocity.x = 0;
        this.velocity.z = 0;
        this.playerVy = 0;
        this.playerHP = this.playerHPMax;
        this._invincible = 2.0;
        this._renderPlayerHP();
        this._tone(80, 1.0, 'sawtooth', 0.10);
    }

    // 玩家头顶血条（怪物同款，战斗时一眼看清自己血量）
    _buildPlayerHPBar() {
        const cv = document.createElement('canvas');
        cv.width = 100; cv.height = 16;
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, depthWrite: false, transparent: true, fog: false,
        }));
        sprite.scale.set(1.3, 0.21, 1);
        sprite.position.y = 1.75;   // 蛋头顶之上
        this.player.add(sprite);
        this._playerHPBar = sprite;
        this._playerHPCv = cv;
        this._playerHPTex = tex;
    }

    _renderPlayerHP() {
        if (!this._hpChip) this._hpChip = document.getElementById('game-hp');
        if (this._hpChip) {
            const heart = '❤️'.repeat(this.playerHP) + '🖤'.repeat(this.playerHPMax - this.playerHP);
            this._hpChip.textContent = heart;
        }
        // 头顶分段血条
        if (this._playerHPCv) {
            const ctx = this._playerHPCv.getContext('2d');
            const W = 100, H = 16, n = this.playerHPMax;
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(0, 0, W, H, 5); ctx.fill(); }
            else ctx.fillRect(0, 0, W, H);
            const pad = 3, gap = 2;
            const segW = (W - pad * 2 - gap * (n - 1)) / n;
            const pct = this.playerHP / this.playerHPMax;
            const col = pct > 0.6 ? '#66ee66' : (pct > 0.3 ? '#ffd23a' : '#ff5050');
            for (let i = 0; i < n; i++) {
                ctx.fillStyle = i < this.playerHP ? col : 'rgba(255,255,255,0.18)';
                const x = pad + i * (segW + gap);
                if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, pad, segW, H - pad * 2, 2); ctx.fill(); }
                else ctx.fillRect(x, pad, segW, H - pad * 2);
            }
            this._playerHPTex.needsUpdate = true;
        }
    }

    // ========= BGM（Web Audio 合成 ambient pad）=========
    _initBGM() {
        this.bgmMuted = false;
        this.bgmStarted = false;
        // I-vi-IV-V 风格的柔和和弦进行
        this.bgmChords = [
            [261.63, 329.63, 392.00],  // C major
            [220.00, 261.63, 329.63],  // A minor
            [174.61, 220.00, 261.63],  // F major
            [196.00, 246.94, 293.66],  // G major
        ];
        this.bgmChordIdx = 0;
        this.bgmTimer = 0;
    }

    _startBGM() {
        if (this.bgmStarted || this.bgmMuted) return;
        if (!this.audioCtx) return;
        this.bgmStarted = true;
        this.bgmGain = this.audioCtx.createGain();
        this.bgmGain.gain.value = 0.06;  // 安静的环境垫底
        this.bgmGain.connect(this.audioCtx.destination);
        this._playBGMChord();
    }

    _playBGMChord() {
        if (!this.audioCtx || this.bgmMuted || !this.bgmStarted) return;
        const ctx = this.audioCtx;
        const chord = this.bgmChords[this.bgmChordIdx];
        const dur = 4.0;
        chord.forEach((freq, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.frequency.value = freq;
            o.type = 'sine';
            g.gain.setValueAtTime(0, ctx.currentTime);
            g.gain.linearRampToValueAtTime(0.7 - i * 0.15, ctx.currentTime + 0.6);
            g.gain.linearRampToValueAtTime(0.7 - i * 0.15, ctx.currentTime + dur - 0.6);
            g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
            o.connect(g); g.connect(this.bgmGain);
            o.start();
            o.stop(ctx.currentTime + dur);
        });
        this.bgmChordIdx = (this.bgmChordIdx + 1) % this.bgmChords.length;
    }

    _updateBGM(dt) {
        if (!this.bgmStarted || this.bgmMuted) return;
        this.bgmTimer -= dt;
        if (this.bgmTimer <= 0) {
            this.bgmTimer = 4.0;
            this._playBGMChord();
        }
    }

    _toggleBGM() {
        this.bgmMuted = !this.bgmMuted;
        if (this.bgmGain) {
            this.bgmGain.gain.value = this.bgmMuted ? 0 : 0.06;
        }
        this._showEasterBadge(this.bgmMuted ? '🔇 BGM 关' : '🔊 BGM 开');
    }

    // ========= 钓鱼背包 =========
    _initInventory() {
        this.inventory = this._loadInventory();
        this._renderInventory();
    }

    _loadInventory() {
        try {
            const raw = localStorage.getItem('eggGameInventory');
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return [];
    }

    _saveInventory() {
        try { localStorage.setItem('eggGameInventory', JSON.stringify(this.inventory)); } catch (e) {}
    }

    _addToInventory(emoji) {
        if (!this.inventory) return;
        this.inventory.push(emoji);
        if (this.inventory.length > 16) this.inventory.shift();
        this._saveInventory();
        this._renderInventory();
    }

    _renderInventory() {
        let bar = document.getElementById('inventory-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'inventory-bar';
            Object.assign(bar.style, {
                position: 'fixed', bottom: '12px', left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex', gap: '4px',
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.45)',
                borderRadius: '12px',
                zIndex: '6',
                pointerEvents: 'none',
            });
            document.body.appendChild(bar);
        }
        bar.innerHTML = this.inventory.length === 0
            ? '<span style="color:#aaa;font-size:14px">背包空空</span>'
            : this.inventory.map(e =>
                `<span style="font-size:24px;display:inline-block;width:30px;text-align:center;">${e}</span>`
            ).join('');
    }

    // ========= 成就系统 =========
    _initAchievements() {
        this.achievementsAll = [
            { id: 'first_jump',       label: '🦘 第一次跳跃' },
            { id: 'first_swim',       label: '🏊 第一次落水' },
            { id: 'first_fish',       label: '🎣 钓到第一条' },
            { id: 'first_flower',     label: '🌸 第一次浇花' },
            { id: 'first_star',       label: '⭐ 收集第一颗星' },
            { id: 'all_stars',        label: '🌟 24 颗星全收' },
            { id: 'all_greet',        label: '👋 全村好朋友' },
            { id: 'see_meteor',       label: '☄️ 看见流星' },
            { id: 'see_rainbow',      label: '🌈 看见彩虹' },
            { id: 'see_lightning',    label: '⚡ 经历雷雨' },
            { id: 'see_firework',     label: '🎆 看见烟花' },
            { id: 'into_house',       label: '🏠 进过房子' },
            { id: 'into_igloo',       label: '🧊 找到企鹅' },
            { id: 'bridge_treasure',  label: '💎 桥下宝藏' },
            { id: 'fountain_wish',    label: '⛲ 喷泉许愿' },
            { id: 'backyard_gold',    label: '🧚 村屋小精灵' },
            { id: 'konami',           label: '🕹️ Konami 神秘大法' },
            { id: 'hidden_fox',       label: '🦊 树后小狐狸' },
            { id: 'lighthouse_note',  label: '📜 守塔人留言' },
            { id: 'all_seasons',      label: '🌳 四季轮回' },
            { id: 'windmill_kick',    label: '💥 被风车弹飞' },
            { id: 'firework_lover',   label: '🎇 烟花迷（看 5 次）' },
            { id: 'snow_stand',       label: '⛄ 雪地站 10 秒' },
            { id: 'water_player',     label: '💧 浇花专家（10 次）' },
            { id: 'first_extract',    label: '🚁 第一次撤离' },
            { id: 'three_extract',    label: '🚁 撤离 3 次' },
            { id: 'legendary_loot',   label: '✨ 抽到传说级' },
            { id: 'first_ko',         label: '⚔️ 击败第一只怪' },
        ];
        this._seasonsSeen = new Set();
        this._snowStandT = 0;
        this._waterCount = 0;
        this.achievements = this._loadAchievements();
        this._achievementChip = document.getElementById('game-achievements');
        this._updateAchievementChip();
        this._renderAchievementsList();
    }

    _loadAchievements() {
        try {
            const raw = localStorage.getItem('eggGameAchievements');
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return [];
    }

    _saveAchievements() {
        try { localStorage.setItem('eggGameAchievements', JSON.stringify(this.achievements)); } catch (e) {}
    }

    _unlockAchievement(id) {
        if (!this.achievements || !this.achievementsAll) return;  // 初始化前的调用直接吞
        if (this.achievements.includes(id)) return;
        const ach = this.achievementsAll.find(a => a.id === id);
        if (!ach) return;
        this.achievements.push(id);
        this._saveAchievements();
        this._updateAchievementChip();
        this._renderAchievementsList();
        this._showEasterBadge(`🏅 ${ach.label}`);
        this._tone(880, 0.15, 'sine', 0.06);
        this._tone(1320, 0.18, 'sine', 0.05, 0.07);
    }

    _updateAchievementChip() {
        if (this._achievementChip) {
            this._achievementChip.textContent =
                `🏅 ${this.achievements.length}/${this.achievementsAll.length}`;
        }
    }

    _renderAchievementsList() {
        // 暂时只显示 chip，详情面板留给以后
    }

    _toggleAchievementsList() {
        // 占位（如果未来要弹完整成就列表）
    }

    _checkSnowStand(dt) {
        // 雪地区域 z<-60，蛋静止不动累计 10 秒
        const p = this.player.position;
        const inSnow = p.z < -60 && Math.abs(p.x) < 70;
        const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.5;
        if (inSnow && !moving && this.onGround) {
            this._snowStandT = (this._snowStandT || 0) + dt;
            if (this._snowStandT >= 10) this._unlockAchievement('snow_stand');
        } else {
            this._snowStandT = 0;
        }
    }
    _initWatering() {
        this.wateringDrops = [];
        this._wateringCooldown = 0;
    }

    _doWatering() {
        if (this._wateringCooldown > 0) return;
        this._wateringCooldown = 0.5;
        this._unlockAchievement('first_flower');
        this._waterCount = (this._waterCount || 0) + 1;
        if (this._waterCount >= 10) this._unlockAchievement('water_player');
        // 朝面前方向喷一束粒子
        const p = this.player.position;
        const a = this.player.rotation.y;
        const fx = Math.sin(a), fz = -Math.cos(a);
        for (let i = 0; i < 12; i++) {
            const spread = (Math.random() - 0.5) * 0.6;
            const drop = new THREE.Mesh(
                new THREE.SphereGeometry(0.06 + Math.random() * 0.03, 6, 4),
                new THREE.MeshStandardMaterial({
                    color: 0x88c8e8, transparent: true, opacity: 0.85,
                })
            );
            drop.userData = {
                vx: (fx + spread) * (2.5 + Math.random()),
                vy: 1.5 + Math.random() * 1.0,
                vz: (fz + spread * 0.5) * (2.5 + Math.random()),
                life: 0.8, full: 0.8,
            };
            drop.position.set(p.x + fx * 0.5, p.y + 0.3, p.z + fz * 0.5);
            this.scene.add(drop);
            this.landParticles.push(drop);
        }
        this._tone(800, 0.1, 'sine', 0.04);

        // 3m 内的花朵触发闪+长大一下
        if (this.flowers) {
            this.flowers.forEach(f => {
                const dx = p.x - f.x, dz = p.z - f.z;
                if (Math.hypot(dx, dz) < 3) {
                    f.animT = 0;
                    // 临时把花瓣材质设 emissive
                    f.group.children.forEach(c => {
                        if (c.material && c.material.color &&
                            !c.material._origEmiss && c.material.type !== 'MeshBasicMaterial') {
                            c.material._origEmiss = c.material.emissive?.getHex() || 0;
                            c.material.emissive?.setHex(0xffeebb);
                            c.material.emissiveIntensity = 1.5;
                            setTimeout(() => {
                                if (c.material._origEmiss !== undefined) {
                                    c.material.emissive?.setHex(c.material._origEmiss);
                                    c.material.emissiveIntensity = 1;
                                    delete c.material._origEmiss;
                                }
                            }, 800);
                        }
                    });
                }
            });
        }
    }

    // ========= 钓鱼 =========
    _initFishing() {
        this._fishingState = 'idle';  // idle / casting / waiting / bite
        this._fishingTimer = 0;
        this._fishingFloat = null;
    }

    _toggleFishing() {
        const p = this.player.position;
        // 必须靠近湖（半径 12 内）才能钓
        const distLake = Math.hypot(p.x - 48, p.z - (-42));
        const distIce = Math.hypot(p.x - (-30), p.z - (-90));
        const nearLake = distLake < 12 || distIce < 11;
        if (!nearLake) return;

        if (this._fishingState === 'idle') {
            // 抛竿
            this._fishingState = 'waiting';
            this._fishingTimer = 3 + Math.random() * 4;
            this._showEasterBadge('🎣 抛竿中...等一下');
            // 浮漂：一个红白小球在水面
            const target = distLake < distIce ? { x: 48, z: -42 } : { x: -30, z: -90 };
            this._fishingFloat = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 10, 8),
                new THREE.MeshToonMaterial({ color: 0xc83a3a })
            );
            this._fishingFloat.position.set(
                target.x + (Math.random() - 0.5) * 4,
                0.35,
                target.z + (Math.random() - 0.5) * 4
            );
            this.scene.add(this._fishingFloat);
            this._tone(440, 0.15, 'sine', 0.05);
        } else if (this._fishingState === 'waiting') {
            // 取消
            this._fishingState = 'idle';
            if (this._fishingFloat) {
                this.scene.remove(this._fishingFloat);
                this._fishingFloat.geometry.dispose();
                this._fishingFloat.material.dispose();
                this._fishingFloat = null;
            }
        }
    }

    _updateFishing(dt) {
        if (this._fishingState !== 'waiting') return;
        this._fishingTimer -= dt;
        // 浮漂上下晃
        if (this._fishingFloat) {
            const t = performance.now() * 0.001;
            this._fishingFloat.position.y = 0.35 + Math.sin(t * 6) * 0.04;
        }
        if (this._fishingTimer <= 0) {
            // 钓到东西
            const catches = ['🐟', '🐠', '🦐', '🐡', '🌿', '🥾', '⭐'];
            const got = catches[Math.floor(Math.random() * catches.length)];
            this._showEasterBadge(`钓到了 ${got}`);
            this._playWin();
            this._addToInventory(got);
            this._unlockAchievement('first_fish');
            // 浮漂飞起来
            if (this._fishingFloat) {
                this.scene.remove(this._fishingFloat);
                this._fishingFloat.geometry.dispose();
                this._fishingFloat.material.dispose();
                this._fishingFloat = null;
            }
            this._fishingState = 'idle';
        }
    }

    // ========= 季节 =========
    _initSeasons() {
        this.seasons = ['spring', 'summer', 'autumn', 'winter'];
        this.seasonIdx = 0;
        this.seasonTimer = 120;
        this._seasonChip = document.getElementById('game-season');
        this._applySeason(true);  // 首次：不放烟花（避免开局卡）
    }

    _applySeason(initial = false) {
        const s = this.seasons[this.seasonIdx];
        if (this._seasonsSeen) {
            this._seasonsSeen.add(s);
            if (this._seasonsSeen.size === 4) this._unlockAchievement('all_seasons');
        }
        if (this._seasonChip) {
            this._seasonChip.textContent = ({
                spring: '🌸 春',
                summer: '☀️ 夏',
                autumn: '🍂 秋',
                winter: '❄️ 冬',
            })[s];
        }
        // 调环境光偏暖/冷 + 雾色
        const tint = ({
            spring: { ambient: 0xfff5e0, fog: 0xd8ecf5 },
            summer: { ambient: 0xfff099, fog: 0xc8e6ff },
            autumn: { ambient: 0xffd699, fog: 0xeec0a0 },
            winter: { ambient: 0xd8e8f5, fog: 0xe8eef5 },
        })[s];
        // 注意不要硬覆盖 _updateDayNight 的 fog 切换；这里只在切换瞬间提示视觉变化
        if (!initial) this._launchFirework();   // 季节切换烟花（首次不放）
    }

    _updateSeason(dt) {
        this.seasonTimer -= dt;
        if (this.seasonTimer <= 0) {
            this.seasonTimer = 120;
            this.seasonIdx = (this.seasonIdx + 1) % 4;
            this._applySeason();
        }
    }

    // ========= 新彩蛋 =========
    _addTreeHiddenEmoji() {
        // 选一棵树后面藏一只 🦊
        const cv = document.createElement('canvas');
        cv.width = 128; cv.height = 128;
        const ctx = cv.getContext('2d');
        ctx.font = '100px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🦊', 64, 64);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const fox = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false,
        }));
        fox.scale.set(0.9, 0.9, 1);
        // 藏在某棵树旁边
        fox.position.set(-45, 0.5, 10);
        this.scene.add(fox);
        this.hiddenFox = { sprite: fox, found: false };
    }

    _checkHiddenFox() {
        if (!this.hiddenFox || this.hiddenFox.found) return;
        const p = this.player.position;
        const dx = p.x - this.hiddenFox.sprite.position.x;
        const dz = p.z - this.hiddenFox.sprite.position.z;
        if (Math.hypot(dx, dz) < 2.5) {
            this.hiddenFox.found = true;
            this._launchFirework();
            this._playWin();
            this._showEasterBadge('🦊 树后小狐狸发现！');
            this._unlockAchievement('hidden_fox');
        }
    }

    _addLighthouseNote() {
        // 灯塔旁边放一张"小纸条"sprite，靠近发现
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 256;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fafad2';
        if (ctx.roundRect) {
            ctx.beginPath(); ctx.roundRect(10, 10, 236, 236, 14); ctx.fill();
        } else {
            ctx.fillRect(10, 10, 236, 236);
        }
        ctx.strokeStyle = '#8a5a2e';
        ctx.lineWidth = 4;
        if (ctx.roundRect) {
            ctx.beginPath(); ctx.roundRect(10, 10, 236, 236, 14); ctx.stroke();
        } else {
            ctx.strokeRect(10, 10, 236, 236);
        }
        ctx.fillStyle = '#2c2c54';
        ctx.font = 'bold 32px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('守塔人留', 128, 90);
        ctx.font = '24px "Microsoft YaHei", sans-serif';
        ctx.fillText('远方有座岛', 128, 140);
        ctx.fillText('那是后续故事…', 128, 178);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const note = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false,
        }));
        note.scale.set(1.4, 1.4, 1);
        note.position.set(82, 1.0, 64); // 灯塔底
        note.visible = false;
        this.scene.add(note);
        this.lighthouseNote = { sprite: note, found: false };
    }

    _checkLighthouseNote() {
        if (!this.lighthouseNote || this.lighthouseNote.found) return;
        const p = this.player.position;
        const dx = p.x - 82;
        const dz = p.z - 62;
        const dist = Math.hypot(dx, dz);
        if (dist < 4) {
            this.lighthouseNote.sprite.visible = true;
            if (dist < 2.5 && !this.lighthouseNote.found) {
                this.lighthouseNote.found = true;
                this._playWin();
                this._showEasterBadge('📜 守塔人留言！');
                this._unlockAchievement('lighthouse_note');
            }
        }
    }

    // ========= 彩蛋区 =========
    _initKonami() {
        this._konamiSeq = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','KeyB','KeyA'];
        this._konamiProgress = 0;
        this._giantMode = 0;
    }

    _onKonamiKey(code) {
        if (code === this._konamiSeq[this._konamiProgress]) {
            this._konamiProgress++;
            if (this._konamiProgress >= this._konamiSeq.length) {
                this._konamiProgress = 0;
                this._triggerGiantMode();
            }
        } else {
            this._konamiProgress = (code === this._konamiSeq[0]) ? 1 : 0;
        }
    }

    _triggerGiantMode() {
        this._giantMode = 12;
        // 一道大烟花庆贺
        for (let i = 0; i < 3; i++) {
            setTimeout(() => this._launchFirework(), i * 350);
        }
        this._playWin();
        this._unlockAchievement('konami');
        // 闪一下
        this.cameraTarget = this.cameraTarget || new THREE.Vector3();
    }

    _updateGiantMode(dt) {
        // 巨化期间蛋大 3 倍
        if (this._giantMode > 0) {
            this._giantMode -= dt;
            this.player.scale.setScalar(3);
        } else if (this.player.scale.x > 1.01) {
            // 平滑回归
            const s = this.player.scale.x;
            const ns = s + (1 - s) * 4 * dt;
            this.player.scale.setScalar(ns);
        }
    }

    _addIglooPenguin() {
        // 冰屋内坐一只小企鹅（默认隐藏，蛋走近冰屋入口才显形）
        const group = new THREE.Group();
        // 身体（黑色椭球）
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.30, 16, 12),
            new THREE.MeshToonMaterial({ color: 0x1a1a2e })
        );
        body.scale.set(0.9, 1.2, 0.9);
        body.position.y = 0.36;
        body.castShadow = true;
        addOutline(body, 0.05);
        group.add(body);
        // 肚白
        const belly = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 14, 10),
            new THREE.MeshToonMaterial({ color: 0xffffff })
        );
        belly.scale.set(0.8, 1.1, 0.4);
        belly.position.set(0, 0.34, -0.16);
        group.add(belly);
        // 头（小一点）
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 14, 10),
            new THREE.MeshToonMaterial({ color: 0x1a1a2e })
        );
        head.position.set(0, 0.72, -0.05);
        head.castShadow = true;
        addOutline(head, 0.05);
        group.add(head);
        // 眼睛
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(0.025, 6, 4),
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            eye.position.set(sx * 0.06, 0.74, -0.18);
            group.add(eye);
            const pupil = new THREE.Mesh(
                new THREE.SphereGeometry(0.012, 6, 4),
                new THREE.MeshBasicMaterial({ color: 0x000000 })
            );
            pupil.position.set(sx * 0.06, 0.74, -0.20);
            group.add(pupil);
        }
        // 喙
        const beak = new THREE.Mesh(
            new THREE.ConeGeometry(0.05, 0.12, 6),
            new THREE.MeshToonMaterial({ color: 0xff8c42 })
        );
        beak.position.set(0, 0.68, -0.22);
        beak.rotation.x = -Math.PI / 2;
        group.add(beak);
        // 翅膀
        for (const sx of [-1, 1]) {
            const wing = new THREE.Mesh(
                new THREE.SphereGeometry(0.10, 8, 6),
                new THREE.MeshToonMaterial({ color: 0x1a1a2e })
            );
            wing.scale.set(0.5, 1.4, 0.3);
            wing.position.set(sx * 0.22, 0.36, 0);
            group.add(wing);
        }
        // 气泡
        const bTex = makeBubbleTexture('嗨！我住冰屋里');
        const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
            map: bTex, depthWrite: false, transparent: true, opacity: 0,
        }));
        bubble.scale.set(3.2, 0.95, 1);
        bubble.position.y = 1.8;
        group.add(bubble);

        group.position.set(30, 0, -80);  // 冰屋位置
        group.visible = false;
        this.scene.add(group);
        this.penguin = { group, bubble, discovered: false };
    }

    _checkPenguin() {
        if (!this.penguin) return;
        const p = this.player.position;
        // 冰屋入口范围
        const dx = p.x - 30;
        const dz = p.z - 78;  // 入口比中心略偏 +Z
        const dist = Math.hypot(dx, dz);
        if (dist < 4 && !this.penguin.discovered) {
            this.penguin.discovered = true;
            this.penguin.group.visible = true;
            // 第一次发现：彩虹一下
            this._tone(880, 0.15, 'sine', 0.06);
            this._tone(1320, 0.15, 'sine', 0.05, 0.07);
            this._unlockAchievement('into_igloo');
        }
        if (this.penguin.discovered) {
            const opTarget = dist < 3.5 ? Math.min(1, (3.5 - dist) / 0.7) : 0;
            this.penguin.bubble.material.opacity += (opTarget - this.penguin.bubble.material.opacity) * 0.15;
        }
    }

    _addBridgeTreasure() {
        // 桥下藏 1 个 emoji 宝箱 + 3 颗大金币
        const group = new THREE.Group();
        // 宝箱（emoji）
        const cv = document.createElement('canvas');
        cv.width = 128; cv.height = 128;
        const ctx = cv.getContext('2d');
        ctx.font = '100px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💎', 64, 64);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const chest = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, transparent: true, depthWrite: false,
        }));
        chest.scale.set(0.9, 0.9, 1);
        chest.position.set(0, 0.35, 0);
        group.add(chest);
        // 3 颗大金币（环绕宝石）
        for (let i = 0; i < 3; i++) {
            const ang = (i / 3) * Math.PI * 2;
            const coin = new THREE.Mesh(
                new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16),
                new THREE.MeshStandardMaterial({
                    color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.0,
                    metalness: 0.8, roughness: 0.3,
                })
            );
            coin.rotation.x = Math.PI / 2;
            coin.position.set(Math.cos(ang) * 0.55, 0.1, Math.sin(ang) * 0.55);
            group.add(coin);
        }

        // 放在桥下
        group.position.set(45, 0, -16);
        this.scene.add(group);
        this.bridgeTreasure = { group, phase: 0, collected: false };
    }

    _updateBridgeTreasure(dt) {
        if (!this.bridgeTreasure) return;
        if (this.bridgeTreasure.collected) return;
        // 旋转 + 浮动
        this.bridgeTreasure.phase += dt;
        this.bridgeTreasure.group.rotation.y = this.bridgeTreasure.phase * 0.8;
        this.bridgeTreasure.group.position.y = Math.sin(this.bridgeTreasure.phase * 2) * 0.06;
        // 收集
        const p = this.player.position;
        const dx = p.x - 45;
        const dz = p.z + 16;
        if (Math.hypot(dx, dz) < 1.5 && p.y < 0.6) {
            this.bridgeTreasure.collected = true;
            this.scene.remove(this.bridgeTreasure.group);
            // 弹三道烟花 + 胜利和弦
            this._launchFirework();
            this._launchFirework();
            this._playWin();
            // 给一个长存 chip 提示
            this._showEasterBadge('💎 桥下宝藏发现！');
            this._unlockAchievement('bridge_treasure');
        }
    }

    _initFountainWish() {
        this._fountainWished = false;
        this._wishGlow = 0;
    }

    _checkFountainWish(dt) {
        const p = this.player.position;
        const dx = p.x, dz = p.z;
        const inFountain = Math.hypot(dx, dz) < 1.3 && p.y < 1.5;
        if (inFountain && !this._fountainWished) {
            this._fountainWished = true;
            this._wishGlow = 5.0;
            this._launchFirework();
            this._playWin();
            this._showEasterBadge('✨ 喷泉许愿成功！');
            this._unlockAchievement('fountain_wish');
        }
        if (this._wishGlow > 0) {
            this._wishGlow -= dt;
            // 喷泉水变彩
            this.fountainParticles?.forEach(part => {
                const k = (this._wishGlow * 8) % 6;
                const colors = [0xff5050, 0xffa040, 0xffd700, 0x66ff66, 0x66aaff, 0xc060ff];
                part.material.color.setHex(colors[Math.floor(k)]);
                part.material.emissive?.setHex(colors[Math.floor(k)]);
            });
        }
    }

    _addBackyardGold() {
        // 村屋后面 (z > 65) 藏几个堆叠金币 + 一个发光精灵
        const group = new THREE.Group();
        // 5 颗大金币叠起来
        for (let i = 0; i < 5; i++) {
            const coin = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.25, 0.08, 18),
                new THREE.MeshStandardMaterial({
                    color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.8,
                    metalness: 0.8, roughness: 0.3,
                })
            );
            coin.position.y = 0.05 + i * 0.09;
            coin.rotation.y = i * 0.4;
            coin.castShadow = true;
            group.add(coin);
        }
        // 散落几颗
        for (let i = 0; i < 4; i++) {
            const coin = new THREE.Mesh(
                new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16),
                new THREE.MeshStandardMaterial({
                    color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.8,
                })
            );
            coin.rotation.x = Math.PI / 2;
            const ang = Math.random() * Math.PI * 2;
            coin.position.set(Math.cos(ang) * 0.7, 0.04, Math.sin(ang) * 0.7);
            group.add(coin);
        }
        // 发光小精灵（emissive 球+点光）
        const sprite = new THREE.Mesh(
            new THREE.SphereGeometry(0.20, 14, 10),
            new THREE.MeshStandardMaterial({
                color: 0xc060ff, emissive: 0xc060ff, emissiveIntensity: 2.5,
            })
        );
        sprite.position.set(0, 0.9, 0);
        group.add(sprite);
        const light = new THREE.PointLight(0xc060ff, 1.5, 6, 1.5);
        light.position.set(0, 0.9, 0);
        group.add(light);

        group.position.set(-10, 0, 67);  // 村屋后面
        this.scene.add(group);
        this.backyardGold = { group, sprite, collected: false, phase: 0 };
    }

    _updateBackyardGold(dt) {
        if (!this.backyardGold || this.backyardGold.collected) return;
        this.backyardGold.phase += dt;
        // 精灵上下浮
        this.backyardGold.sprite.position.y = 0.9 + Math.sin(this.backyardGold.phase * 2) * 0.15;
        this.backyardGold.sprite.rotation.y = this.backyardGold.phase * 1.5;
        // 收集
        const p = this.player.position;
        const dx = p.x + 10;
        const dz = p.z - 67;
        if (Math.hypot(dx, dz) < 1.8) {
            this.backyardGold.collected = true;
            this.scene.remove(this.backyardGold.group);
            this._launchFirework();
            this._launchFirework();
            this._launchFirework();
            this._playWin();
            this._showEasterBadge('🧚 村屋后小精灵！');
            this._unlockAchievement('backyard_gold');
        }
    }

    _showEasterBadge(text) {
        if (this._destroyed) return;
        // 屏幕中央短暂弹一行金色文字
        if (!this._easterEl) {
            this._easterEl = document.createElement('div');
            this._easterEl.id = 'easter-badge';
            Object.assign(this._easterEl.style, {
                position: 'fixed', top: '40%', left: '50%',
                transform: 'translate(-50%, -50%)',
                padding: '14px 28px',
                background: 'linear-gradient(90deg, #ffd700, #ff66cc)',
                color: '#fff',
                fontSize: '28px', fontWeight: 'bold',
                borderRadius: '999px',
                boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                zIndex: '20',
                pointerEvents: 'none',
                transition: 'opacity 0.5s, transform 0.5s',
                opacity: '0',
            });
            document.body.appendChild(this._easterEl);
        }
        this._easterEl.textContent = text;
        this._easterEl.style.opacity = '1';
        this._easterEl.style.transform = 'translate(-50%, -50%) scale(1.1)';
        clearTimeout(this._easterTimer);
        this._easterTimer = setTimeout(() => {
            this._easterEl.style.opacity = '0';
            this._easterEl.style.transform = 'translate(-50%, -50%) scale(0.9)';
        }, 2200);
    }

    _addBench(x, z, ry) {
        const group = new THREE.Group();
        const mat = new THREE.MeshToonMaterial({ color: 0x8a5a2e });
        // 座板
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.10, 0.42), mat);
        seat.position.y = 0.4;
        seat.castShadow = true;
        addOutline(seat, 0.03);
        group.add(seat);
        // 靠背
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.50, 0.08), mat);
        back.position.set(0, 0.65, -0.18);
        back.castShadow = true;
        addOutline(back, 0.03);
        group.add(back);
        // 腿
        for (const sx of [-0.7, 0.7]) {
            const leg = new THREE.Mesh(
                new THREE.BoxGeometry(0.10, 0.4, 0.4),
                new THREE.MeshToonMaterial({ color: 0x6a3a1a })
            );
            leg.position.set(sx, 0.2, 0);
            leg.castShadow = true;
            addOutline(leg, 0.03);
            group.add(leg);
        }
        group.position.set(x, 0, z);
        group.rotation.y = ry;
        this.scene.add(group);
    }

    _checkCandles(dt) {
        if (!this.candles || this.candles.length === 0) return;
        const p = this.player.position;
        for (const c of this.candles) {
            if (c.cooldown > 0) c.cooldown -= dt;
            const dx = p.x - c.worldX;
            const dz = p.z - c.worldZ;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.9 && c.cooldown <= 0) {
                c.lit = !c.lit;
                c.flame.visible = c.lit;
                c.cooldown = 0.8;
                this._tone(c.lit ? 880 : 220, 0.15, 'sine', 0.05);
            }
        }
    }

    _buildVillageHall() {
        const x = -10, z = 58;
        const group = new THREE.Group();
        const W = 8.5, H = 5.0, D = 7.5;
        const wallT = 0.25;
        const doorW = 2.0, doorH = 3.0;
        const bodyColor = 0xe8d4a8;
        const roofColor = 0x8b4540;
        const fadeables = [];

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(W, D),
            new THREE.MeshToonMaterial({ color: 0xc9925c })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0.05;
        floor.receiveShadow = true;
        group.add(floor);

        const wallMat = () => new THREE.MeshToonMaterial({ color: bodyColor });

        // 后/左/右墙
        const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, wallT), wallMat());
        back.position.set(0, H / 2, -D / 2);
        back.castShadow = true; addOutline(back, 0.025);
        group.add(back); fadeables.push(back);

        const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, D), wallMat());
        left.position.set(-W / 2, H / 2, 0);
        left.castShadow = true; addOutline(left, 0.025);
        group.add(left); fadeables.push(left);

        const right = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, D), wallMat());
        right.position.set(W / 2, H / 2, 0);
        right.castShadow = true; addOutline(right, 0.025);
        group.add(right); fadeables.push(right);

        // 前墙分段（更大门）
        const frontSideW = (W - doorW) / 2;
        const frontL = new THREE.Mesh(new THREE.BoxGeometry(frontSideW, H, wallT), wallMat());
        frontL.position.set(-W / 2 + frontSideW / 2, H / 2, D / 2);
        addOutline(frontL, 0.025);
        group.add(frontL); fadeables.push(frontL);

        const frontR = new THREE.Mesh(new THREE.BoxGeometry(frontSideW, H, wallT), wallMat());
        frontR.position.set(W / 2 - frontSideW / 2, H / 2, D / 2);
        addOutline(frontR, 0.025);
        group.add(frontR); fadeables.push(frontR);

        const frontTopH = H - doorH;
        const frontT = new THREE.Mesh(new THREE.BoxGeometry(doorW, frontTopH, wallT), wallMat());
        frontT.position.set(0, doorH + frontTopH / 2, D / 2);
        addOutline(frontT, 0.025);
        group.add(frontT); fadeables.push(frontT);

        // 屋顶（金字塔锥）
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(W * 0.65, 2.5, 4),
            new THREE.MeshToonMaterial({ color: roofColor })
        );
        roof.position.y = H + 1.25;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        addOutline(roof, 0.04);
        group.add(roof); fadeables.push(roof);

        // 招牌
        const signTex = makeSignTexture('村屋');
        const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, depthWrite: false }));
        sign.scale.set(2.2, 0.78, 1);
        sign.position.set(0, doorH + 0.6, D / 2 + 0.12);
        group.add(sign);

        // 室内：长吧台 + 凳子 + 暖灯
        const bar = new THREE.Mesh(
            new THREE.BoxGeometry(5.0, 1.1, 0.7),
            new THREE.MeshToonMaterial({ color: 0xa67a4a })
        );
        bar.position.set(0, 0.55, -D / 2 + 1.5);
        addOutline(bar, 0.03);
        group.add(bar);
        const barTop = new THREE.Mesh(
            new THREE.BoxGeometry(5.2, 0.1, 0.85),
            new THREE.MeshToonMaterial({ color: 0xc89868 })
        );
        barTop.position.set(0, 1.15, -D / 2 + 1.5);
        addOutline(barTop, 0.03);
        group.add(barTop);

        // 3 个凳子
        for (const sx of [-1.5, 0, 1.5]) {
            const stool = new THREE.Mesh(
                new THREE.CylinderGeometry(0.25, 0.20, 0.7, 12),
                new THREE.MeshToonMaterial({ color: 0xa84030 })
            );
            stool.position.set(sx, 0.35, -D / 2 + 2.5);
            addOutline(stool, 0.04);
            group.add(stool);
        }

        // 长桌 + 2 把椅
        const longTable = new THREE.Mesh(
            new THREE.BoxGeometry(3.0, 0.12, 1.2),
            new THREE.MeshToonMaterial({ color: 0xc89868 })
        );
        longTable.position.set(0, 0.85, D / 2 - 2.0);
        addOutline(longTable, 0.03);
        group.add(longTable);
        for (const lx of [-1.2, 1.2]) for (const lz of [-0.4, 0.4]) {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6),
                new THREE.MeshToonMaterial({ color: 0xa67a4a })
            );
            leg.position.set(lx, 0.42, (D / 2 - 2.0) + lz);
            group.add(leg);
        }

        // 中间挂个发光吊灯
        const chand = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 16, 12),
            new THREE.MeshStandardMaterial({
                color: 0xfff1c8, emissive: 0xffd066, emissiveIntensity: 1.8,
            })
        );
        chand.position.set(0, H - 1.0, 0);
        group.add(chand);
        const chandRope = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6),
            new THREE.MeshBasicMaterial({ color: 0x2c2c54 })
        );
        chandRope.position.set(0, H - 0.5, 0);
        group.add(chandRope);
        // 默认灭；夜里进村屋才自动点亮
        const ceilingLight = new THREE.PointLight(0xffd599, 0, 20, 1.1);
        ceilingLight.position.set(0, H - 1.0, 0);
        group.add(ceilingLight);

        // 大地毯
        const rug = new THREE.Mesh(
            new THREE.CircleGeometry(1.8, 32),
            new THREE.MeshToonMaterial({ color: 0x8a4060 })
        );
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0, 0.07, 0);
        group.add(rug);

        group.position.set(x, 0, z);
        this.scene.add(group);

        // 6 段墙碰撞
        const t = wallT / 2;
        const walls = [
            { min: new THREE.Vector3(x - W/2,          0, z - D/2 - t), max: new THREE.Vector3(x + W/2,             H,  z - D/2 + t) },
            { min: new THREE.Vector3(x - W/2 - t,      0, z - D/2),     max: new THREE.Vector3(x - W/2 + t,         H,  z + D/2) },
            { min: new THREE.Vector3(x + W/2 - t,      0, z - D/2),     max: new THREE.Vector3(x + W/2 + t,         H,  z + D/2) },
            { min: new THREE.Vector3(x - W/2,          0, z + D/2 - t), max: new THREE.Vector3(x - W/2 + frontSideW, H, z + D/2 + t) },
            { min: new THREE.Vector3(x + W/2 - frontSideW, 0, z + D/2 - t), max: new THREE.Vector3(x + W/2,         H,  z + D/2 + t) },
            { min: new THREE.Vector3(x - doorW/2,    doorH, z + D/2 - t), max: new THREE.Vector3(x + doorW/2,       H,  z + D/2 + t) },
        ];
        walls.forEach(w => this.obstacles.push(w));

        this.houses.push({
            // inside 检测放宽到外墙边（不再减 wallT）：站门口就算"屋内"
            min: new THREE.Vector3(x - W/2, 0, z - D/2),
            max: new THREE.Vector3(x + W/2, H, z + D/2),
            fadeables,
            currentOpacity: 1,
            lamp: ceilingLight,   // 夜里进村屋自动开的灯
        });
    }

    _buildWindmill(x, z) {
        const group = new THREE.Group();
        // 圆柱塔身
        const tower = new THREE.Mesh(
            new THREE.CylinderGeometry(0.8, 1.0, 4.5, 12),
            new THREE.MeshToonMaterial({ color: 0xeae0c8 })
        );
        tower.position.y = 2.25;
        tower.castShadow = true;
        addOutline(tower, 0.025);
        group.add(tower);
        // 圆锥顶
        const cap = new THREE.Mesh(
            new THREE.ConeGeometry(1.0, 1.0, 12),
            new THREE.MeshToonMaterial({ color: 0xa84030 })
        );
        cap.position.y = 5.0;
        cap.castShadow = true;
        addOutline(cap, 0.03);
        group.add(cap);
        // 风车叶片（4 片，绑到一个 hub 上方便转）
        const hub = new THREE.Group();
        const bladeMat = new THREE.MeshToonMaterial({ color: 0xf5f5f5 });
        for (let i = 0; i < 4; i++) {
            const blade = new THREE.Mesh(
                new THREE.BoxGeometry(0.18, 2.4, 0.08),
                bladeMat
            );
            blade.position.y = 1.2;
            blade.castShadow = true;
            addOutline(blade, 0.03);
            const armPivot = new THREE.Group();
            armPivot.rotation.z = (i / 4) * Math.PI * 2;
            armPivot.add(blade);
            hub.add(armPivot);
        }
        hub.position.set(0, 4.0, 1.0); // 装在塔正前方
        group.add(hub);
        // 中心轴小球
        const center = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 12, 8),
            new THREE.MeshToonMaterial({ color: 0x6a3a1a })
        );
        center.position.copy(hub.position);
        group.add(center);

        group.position.set(x, 0, z);
        this.scene.add(group);
        this.animDecor.push({ type: 'windmill', hub });

        // 塔身也注册为碰撞
        this.obstacles.push({
            min: new THREE.Vector3(x - 1.0, 0, z - 1.0),
            max: new THREE.Vector3(x + 1.0, 4.5, z + 1.0),
        });
    }

    _buildSwing(x, z) {
        const group = new THREE.Group();
        const poleMat = new THREE.MeshToonMaterial({ color: 0x8a5a2e });
        // 两根 A 字立柱
        for (const sx of [-1.2, 1.2]) {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.10, 3.0, 8),
                poleMat
            );
            pole.position.set(sx, 1.5, 0);
            pole.rotation.z = sx > 0 ? -0.12 : 0.12;
            pole.castShadow = true;
            addOutline(pole, 0.03);
            group.add(pole);
        }
        // 横梁
        const cross = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 2.8, 8),
            poleMat
        );
        cross.position.y = 2.85;
        cross.rotation.z = Math.PI / 2;
        cross.castShadow = true;
        addOutline(cross, 0.03);
        group.add(cross);

        // 摆动 pivot（绳+座椅作为子节点，整体绕 X 轴摆）
        const swingPivot = new THREE.Group();
        swingPivot.position.y = 2.85;
        // 两根绳
        const ropeMat = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });
        for (const sx of [-0.45, 0.45]) {
            const rope = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6),
                ropeMat
            );
            rope.position.set(sx, -0.8, 0);
            swingPivot.add(rope);
        }
        // 座椅
        const seat = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.10, 0.4),
            new THREE.MeshToonMaterial({ color: 0xc89868 })
        );
        seat.position.y = -1.6;
        seat.castShadow = true;
        addOutline(seat, 0.03);
        swingPivot.add(seat);

        group.add(swingPivot);
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI;
        this.scene.add(group);
        this.animDecor.push({
            type: 'swing',
            pivot: swingPivot,
            phase: Math.random() * Math.PI * 2,
        });
    }

    _buildLake(x, z) {
        // 真水面：Reflector 实时反射
        const radius = 8;
        const lakeGeo = new THREE.CircleGeometry(radius, 48);
        const lake = new Reflector(lakeGeo, {
            clipBias: 0.003,
            textureWidth: Math.floor(window.innerWidth * 0.4),
            textureHeight: Math.floor(window.innerHeight * 0.4),
            color: 0x556680,
        });
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(x, 0.06, z);
        this.scene.add(lake);
        this.lake = lake;
        // 远处兜底：便宜的静态水面，离湖远时顶替 Reflector（Reflector 每帧把整个场景重渲一遍）
        const lakeFallback = new THREE.Mesh(
            new THREE.CircleGeometry(radius, 48),
            new THREE.MeshToonMaterial({ color: 0x5b86a8 })
        );
        lakeFallback.rotation.x = -Math.PI / 2;
        lakeFallback.position.set(x, 0.055, z);
        lakeFallback.visible = false;
        this.scene.add(lakeFallback);
        this._lakeFallback = lakeFallback;
        this._lakeCenter = new THREE.Vector3(x, 0, z);

        // 湖边深色环（暗示岸）
        const rim = new THREE.Mesh(
            new THREE.RingGeometry(radius, radius + 0.5, 48),
            new THREE.MeshToonMaterial({ color: 0x2a4858 })
        );
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(x, 0.055, z);
        this.scene.add(rim);

        // 流动碎波光：additive 白色细纹叠在反射面上，缓慢错速流动
        this._lakeGlintTex = makeLakeGlintTexture();
        const glint = new THREE.Mesh(
            new THREE.CircleGeometry(radius * 0.97, 48),
            new THREE.MeshBasicMaterial({
                map: this._lakeGlintTex,
                transparent: true,
                opacity: 0.22,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        );
        glint.rotation.x = -Math.PI / 2;
        glint.position.set(x, 0.072, z);
        this.scene.add(glint);
        this.lakeGlint = glint;
    }

    _updateLakeGlint(dt) {
        if (!this._lakeGlintTex) return;
        this._lakeGlintTex.offset.x += dt * 0.018;
        this._lakeGlintTex.offset.y += dt * 0.011;
        const dayness = this._lastDayness ?? 1;
        // 白天闪、夜里月光下弱闪
        this.lakeGlint.material.opacity = 0.08 + 0.18 * dayness;
    }

    _initLightning() {
        this.lightningTimer = 8 + Math.random() * 10;
        this.lightningFlash = 0;  // 0..1 衰减
        this.lightningLight = new THREE.DirectionalLight(0xffffff, 0);
        this.lightningLight.position.set(0, 60, 0);
        this.scene.add(this.lightningLight);
    }

    _updateLightning(dt) {
        // 只在下雨时打雷
        if (this.weather !== 'rain') {
            this.lightningLight.intensity = 0;
            return;
        }
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
            this.lightningFlash = 1.0;
            this.lightningTimer = 8 + Math.random() * 14;
            // 雷声：低频降调
            this._playThunder();
            this._unlockAchievement('see_lightning');
        }
        if (this.lightningFlash > 0) {
            this.lightningFlash = Math.max(0, this.lightningFlash - dt * 4);
            // 闪光：指数衰减 + 偶尔的二次闪（cartoon 双闪）
            const flicker = (Math.sin(this.lightningFlash * 30) > 0 ? 1 : 0.3);
            this.lightningLight.intensity = this.lightningFlash * 5 * flicker;
        }
    }

    _buildNPCs() {
        this.npcs = [];
        // 各家迎宾 + 秋千旁 + 大屋里的 3 个
        const cfgs = [
            { x: -42, z: -22, body: '#ffa07a', hat: 0x5fb3e5, name: '橙橙', line: '你好呀！进来坐坐？' },
            { x: 50,  z:  26, body: '#7bc4ff', hat: 0xff7e7e, name: '小蓝', line: '蓝色的家欢迎你～' },
            { x: -55, z:  41, body: '#c8a8ff', hat: 0xffe066, name: '紫薇', line: '我家的窗户夜里最亮哦' },
            { x: 35,  z: -45, body: '#ffe066', hat: 0xff3a78, name: '小黄', line: '嘿，你穿这件好看！' },
            { x: -26, z:  32, body: '#7ed5a8', hat: 0x9a4a3a, name: '小翠', line: '想荡秋千吗？' },
            // 大屋里三个 NPC
            { x: -13, z:  55, body: '#ff9ab8', hat: 0xffd966, name: '小桃', line: '欢迎来到村屋' },
            { x: -7,  z:  56, body: '#a8e3a8', hat: 0xc8a8ff, name: '小麦', line: '今天的茶不错' },
            { x: -10, z:  60, body: '#ffa07a', hat: 0x66ddff, name: '老雀', line: '这村子住几辈了' },
        ];
        cfgs.forEach(c => this._addNPC(c.x, c.z, c.body, c.hat, c.name, c.line));
    }

    _addNPC(x, z, bodyColorHex, hatColor, name, line) {
        const group = new THREE.Group();
        const r = 0.45;
        const bodyColor = hexToInt(bodyColorHex);

        // 蛋形身体
        const bodyGeo = new THREE.SphereGeometry(r, 24, 24);
        bodyGeo.scale(1, 1.22, 1);
        bodyGeo.translate(0, r * 1.22, 0);
        const body = new THREE.Mesh(
            bodyGeo,
            new THREE.MeshToonMaterial({ color: bodyColor })
        );
        body.castShadow = true;
        addOutline(body, 0.05);
        group.add(body);

        // 简单眼睛（两个白球+黑瞳）
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(r * 0.15, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            eye.position.set(sx * r * 0.28, r * 1.45, -r * 0.78);
            group.add(eye);
            const pupil = new THREE.Mesh(
                new THREE.SphereGeometry(r * 0.08, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0x2c2c54 })
            );
            pupil.position.set(sx * r * 0.28, r * 1.45, -r * 0.90);
            group.add(pupil);
        }

        // 微笑（一条小弧）
        const mouthGeo = new THREE.TorusGeometry(r * 0.1, r * 0.018, 6, 12, Math.PI);
        const mouth = new THREE.Mesh(mouthGeo, new THREE.MeshBasicMaterial({ color: 0x2c2c54 }));
        mouth.position.set(0, r * 1.15, -r * 0.84);
        mouth.rotation.z = Math.PI;
        group.add(mouth);

        // 锥形小帽
        const hat = new THREE.Mesh(
            new THREE.ConeGeometry(r * 0.55, r * 0.65, 10),
            new THREE.MeshToonMaterial({ color: hatColor })
        );
        hat.position.y = r * 2.48;
        hat.castShadow = true;
        addOutline(hat, 0.04);
        group.add(hat);
        // 帽尖小球
        const tip = new THREE.Mesh(
            new THREE.SphereGeometry(r * 0.10, 10, 8),
            new THREE.MeshToonMaterial({ color: 0xffffff })
        );
        tip.position.y = r * 2.82;
        group.add(tip);

        // 头顶名字浮标
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 72;
        const ctx = cv.getContext('2d');
        ctx.font = 'bold 36px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.strokeText(name, 128, 36);
        ctx.fillStyle = '#2c2c54';
        ctx.fillText(name, 128, 36);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex, depthWrite: false, transparent: true
        }));
        label.scale.set(1.6, 0.45, 1);
        label.position.y = r * 3.45;
        group.add(label);

        // 对话气泡（默认隐藏，靠近才显形）
        let bubble = null;
        if (line) {
            const bTex = makeBubbleTexture(line);
            bubble = new THREE.Sprite(new THREE.SpriteMaterial({
                map: bTex, depthWrite: false, transparent: true, opacity: 0,
            }));
            bubble.scale.set(3.2, 0.95, 1);
            bubble.position.y = r * 4.4;
            bubble.visible = false;
            group.add(bubble);
        }

        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
        this.npcs.push({ group, phase: Math.random() * Math.PI * 2, bubble });

        // 不算 obstacle，让蛋能走过去（NPC 是装饰）
    }

    _updateNPCs() {
        if (!this.npcs) return;
        const t = performance.now() * 0.001;
        const p = this.player.position;
        this.npcs.forEach(n => {
            n.group.position.y = Math.sin(t * 1.4 + n.phase) * 0.10;
            const dx = p.x - n.group.position.x;
            const dz = p.z - n.group.position.z;
            const dist = Math.hypot(dx, dz);
            // 5m 内：转身朝向蛋；远了：随机摇头
            if (dist < 5.5) {
                const targetAngle = Math.atan2(dx, dz);
                let diff = targetAngle - n.group.rotation.y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                n.group.rotation.y += diff * 0.08;
            } else {
                n.group.rotation.y += Math.sin(t * 0.5 + n.phase) * 0.004;
            }
            // 对话气泡：3.5m 内淡入，>3.5m 淡出
            if (n.bubble) {
                const targetOp = dist < 3.5 ? Math.min(1, (3.5 - dist) / 0.7) : 0;
                n.bubble.material.opacity += (targetOp - n.bubble.material.opacity) * 0.15;
                n.bubble.visible = n.bubble.material.opacity > 0.02;
            }
        });
    }

    // ===================== 区域故事角色（不并进打招呼系统）=====================
    // 给一个已建好的视觉 group 挂上名字浮标 + 对话气泡，并登记到 storyNpcs
    _attachStoryNpc(group, name, line, labelY, bubbleY) {
        if (!this.storyNpcs) this.storyNpcs = [];
        const cv = document.createElement('canvas');
        cv.width = 256; cv.height = 72;
        const ctx = cv.getContext('2d');
        ctx.font = 'bold 34px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineJoin = 'round';
        ctx.strokeText(name, 128, 36);
        ctx.fillStyle = '#2c2c54'; ctx.fillText(name, 128, 36);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
        label.scale.set(1.6, 0.45, 1);
        label.position.y = labelY;
        group.add(label);

        const bubble = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeBubbleTexture(line), depthWrite: false, transparent: true, opacity: 0,
        }));
        bubble.scale.set(3.4, 1.0, 1);
        bubble.position.y = bubbleY;
        bubble.visible = false;
        group.add(bubble);

        const rec = { group, bubble, phase: Math.random() * Math.PI * 2, baseY: group.position.y };
        this.storyNpcs.push(rec);
        return rec;
    }

    _setStoryLine(rec, line) {
        if (!rec || !rec.bubble) return;
        const old = rec.bubble.material.map;
        rec.bubble.material.map = makeBubbleTexture(line);
        rec.bubble.material.needsUpdate = true;
        if (old) old.dispose();
    }

    _updateStoryNpcs(dt) {
        if (!this.storyNpcs) return;
        const t = performance.now() * 0.001;
        const p = this.player.position;
        for (const n of this.storyNpcs) {
            n.group.position.y = (n.baseY || 0) + Math.sin(t * 1.4 + n.phase) * 0.08;
            const dx = p.x - n.group.position.x;
            const dz = p.z - n.group.position.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 6) {
                const targetAngle = Math.atan2(dx, dz);
                let diff = targetAngle - n.group.rotation.y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                n.group.rotation.y += diff * 0.06;
            }
            if (n.bubble) {
                const targetOp = dist < 4 ? Math.min(1, (4 - dist) / 0.8) : 0;
                n.bubble.material.opacity += (targetOp - n.bubble.material.opacity) * 0.15;
                n.bubble.visible = n.bubble.material.opacity > 0.02;
            }
        }
    }

    // 冰雪国·小雪精灵（孤单怕冷，火种被冻住）——在冰湖边
    _buildSnowSprite() {
        const group = new THREE.Group();
        // 柔光光晕（billboard，远处也能一眼看到精灵在哪）
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: makeSnowflakeTexture(),
            color: 0x9ed8ff, transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        halo.scale.set(2.6, 2.6, 1);
        halo.position.y = 1.3;
        group.add(halo);
        this._snowSpriteHalo = halo;
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.62, 20, 16),
            new THREE.MeshStandardMaterial({
                color: 0xbfe4ff, emissive: 0x77c8ff, emissiveIntensity: 1.1,
                transparent: true, opacity: 0.92,
            })
        );
        body.position.y = 1.3;
        group.add(body);
        this._snowSpriteBody = body;
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x223355 }));
            eye.position.set(sx * 0.16, 1.42, -0.42);
            group.add(eye);
        }
        // 默认难过的嘴（∩ 倒弧）
        const mouth = new THREE.Mesh(
            new THREE.TorusGeometry(0.08, 0.015, 6, 12, Math.PI),
            new THREE.MeshBasicMaterial({ color: 0x223355 })
        );
        mouth.position.set(0, 1.16, -0.45);
        group.add(mouth);
        this._snowSpriteMouth = mouth;
        // 头顶飘的小雪花
        const flake = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.12),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        flake.position.y = 2.0;
        group.add(flake);
        this._snowSpriteFlake = flake;

        group.position.set(-30, 0, -90);
        this.scene.add(group);
        this._snowSpriteRec = this._attachStoryNpc(
            group, '小雪精灵', '呜…我把暖灯火种冻在冰里了，好冷好孤单…', 2.5, 3.4
        );
    }

    // 月光湖·老乌龟（收着月光石，丢了鱼竿）——在湖边月光石旁
    _buildLakeTurtle() {
        const group = new THREE.Group();
        const shellMat = new THREE.MeshToonMaterial({ color: 0x5a9e5a });
        const shell = new THREE.Mesh(
            new THREE.SphereGeometry(0.55, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
            shellMat
        );
        shell.position.y = 0.35;
        shell.scale.set(1, 0.8, 1.2);
        shell.castShadow = true;
        addOutline(shell, 0.04);
        group.add(shell);
        // 壳上几块深色花纹
        for (const [bx, bz] of [[0, 0], [0.22, 0.1], [-0.22, 0.1], [0, -0.22]]) {
            const patch = new THREE.Mesh(
                new THREE.SphereGeometry(0.12, 8, 6),
                new THREE.MeshToonMaterial({ color: 0x3f7a3f })
            );
            patch.position.set(bx, 0.55, bz);
            patch.scale.set(1, 0.3, 1);
            group.add(patch);
        }
        // 头
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshToonMaterial({ color: 0x7bbf7b }));
        head.position.set(0, 0.42, -0.72);
        group.add(head);
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0x222222 }));
            eye.position.set(sx * 0.08, 0.48, -0.88);
            group.add(eye);
        }
        const legMat = new THREE.MeshToonMaterial({ color: 0x6cae6c });
        for (const [lx, lz] of [[-0.36, -0.28], [0.36, -0.28], [-0.36, 0.3], [0.36, 0.3]]) {
            const leg = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), legMat);
            leg.position.set(lx, 0.12, lz);
            leg.scale.y = 0.7;
            group.add(leg);
        }
        group.position.set(40, 0, -33);
        this.scene.add(group);
        this._turtleRec = this._attachStoryNpc(
            group, '老乌龟', '我的月光石就在那边发亮…帮我把它收好，好吗？', 1.6, 2.4
        );
    }

    // 沙漠绿洲复活（收到清泉之珠后触发）：水洼变大池 + 绿草圈 + 冒花
    _reviveOasis() {
        if (this._oasisRevived) return;
        this._oasisRevived = true;
        const ox = -30, oz = 116;  // 与 _buildDesertBiome 的 oasisX/oasisZ 一致
        const pond = new THREE.Mesh(
            new THREE.CircleGeometry(6, 32),
            new THREE.MeshStandardMaterial({ color: 0x4fc4d8, metalness: 0.1, roughness: 0.35, transparent: true, opacity: 0 })
        );
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(ox, 0.07, oz);
        this.scene.add(pond);
        const grassRing = new THREE.Mesh(
            new THREE.RingGeometry(6, 9, 32),
            new THREE.MeshToonMaterial({ color: 0x6cba5a, transparent: true, opacity: 0, side: THREE.DoubleSide })
        );
        grassRing.rotation.x = -Math.PI / 2;
        grassRing.position.set(ox, 0.06, oz);
        this.scene.add(grassRing);
        const flowerColors = [0xff7ab0, 0xffd24a, 0xff6f5a, 0xc77bff];
        const flowers = [];
        for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, r = 6.4 + Math.random() * 2.4;
            const f = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 8, 6),
                new THREE.MeshToonMaterial({ color: flowerColors[i % 4], transparent: true, opacity: 0 })
            );
            f.position.set(ox + Math.cos(a) * r, 0.2, oz + Math.sin(a) * r);
            f.scale.y = 0.6;
            this.scene.add(f);
            flowers.push(f);
        }
        this._oasisFx = { pond, grassRing, flowers, t: 0 };
        this._playWin();
        this._showEasterBadge('🌿 绿洲活过来啦！清泉重新冒水了～');
    }

    _updateAnimDecor() {
        if (!this.animDecor) return;
        const t = performance.now() * 0.001;
        this.animDecor.forEach(d => {
            if (d.type === 'windmill') {
                d.hub.rotation.z += 0.008;
            } else if (d.type === 'giantWindmill') {
                d.hub.rotation.z += 0.004;
            } else if (d.type === 'swing') {
                d.pivot.rotation.x = Math.sin(t * 0.9 + d.phase) * 0.45;
            }
        });
    }

    // ===== 音效（Web Audio 程序合成，零外部文件）=====
    _initAudio() {
        this.audioReady = false;
        // 浏览器策略：必须用户手势触发后才能 start AudioContext
    }

    _ensureAudio() {
        if (this.audioCtx) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.audioCtx = new Ctx();
            this.audioReady = true;
            this._startBGM();
        } catch (e) {}
    }

    _tone(freq, dur, type = 'sine', gain = 0.08, atStart = 0) {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const t0 = ctx.currentTime + atStart;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = type;
        g.gain.value = 0;
        g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
    }

    _playLand()  { this._tone(80, 0.18, 'triangle', 0.10); }
    _playJump()  { this._tone(420, 0.10, 'square', 0.04); this._tone(640, 0.10, 'sine', 0.03, 0.05); }
    _playWin()   {
        [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.22, 'sine', 0.10, i * 0.10));
    }
    _playDeath() {
        [400, 320, 240, 180].forEach((f, i) => this._tone(f, 0.18, 'sawtooth', 0.06, i * 0.07));
    }
    _playFlower() { this._tone(880, 0.08, 'sine', 0.05); this._tone(1320, 0.10, 'sine', 0.04, 0.05); }
    _playThunder() {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        // 用 noise buffer 当雷声
        const bufLen = ctx.sampleRate * 1.2;
        const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) {
            const envelope = Math.exp(-i / (bufLen * 0.35));
            data[i] = (Math.random() * 2 - 1) * envelope * 0.7;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'lowpass';
        bp.frequency.value = 180;
        const g = ctx.createGain();
        g.gain.value = 0.4;
        src.connect(bp); bp.connect(g); g.connect(ctx.destination);
        src.start();
    }

    _createWindGrass() {
        // 单片草叶：3 段竖向 plane，底固定顶弯
        const bladeGeo = new THREE.PlaneGeometry(0.06, 0.42, 1, 3);
        bladeGeo.translate(0, 0.21, 0); // 底部对齐草根
        const bladeMat = new THREE.MeshToonMaterial({
            color: 0x6cb56c,
            side: THREE.DoubleSide,
        });
        // 风偏移：注入 vertex shader
        bladeMat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uWindStrength = { value: 0.35 };
            // 关键：先在 <common> 后面加 uniform 声明，再替换 begin_vertex
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    `#include <common>
                    uniform float uTime;
                    uniform float uWindStrength;`
                )
                .replace(
                    '#include <begin_vertex>',
                    `
                    vec3 transformed = vec3(position);
                    vec4 wp = instanceMatrix * vec4(position, 1.0);
                    float bend = pow(max(0.0, position.y / 0.42), 1.6);
                    float phase = wp.x * 0.18 + wp.z * 0.22;
                    float wave = sin(uTime * 1.4 + phase) * 0.5 + sin(uTime * 0.6 + phase * 1.7) * 0.3;
                    transformed.x += wave * bend * uWindStrength;
                    transformed.z += wave * bend * uWindStrength * 0.4;
                    `
                );
            bladeMat.userData.shader = shader;
        };

        const inPath = (x, z) => {
            if (Math.hypot(x, z) < 7) return true;
            if (Math.abs(x) < 4 && z < 0 && z > -52) return true;
            if (Math.abs(z) < 4 && x > 0 && x < 52) return true;
            if (Math.abs(z) < 4 && x < 0 && x > -52) return true;
            return false;
        };

        const count = 1000;
        const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, count);
        const dummy = new THREE.Object3D();
        let placed = 0;
        let tries = 0;
        while (placed < count && tries < count * 5) {
            tries++;
            const x = (Math.random() - 0.5) * 150;
            const z = (Math.random() - 0.5) * 150;
            if (inPath(x, z)) continue;
            if (z < -56) continue;  // 雪原里不长草（绿草叶从雪里穿出来很穿帮）
            dummy.position.set(x, 0, z);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.scale.setScalar(0.7 + Math.random() * 0.7);
            dummy.updateMatrix();
            grass.setMatrixAt(placed, dummy.matrix);
            placed++;
        }
        grass.count = placed;
        grass.instanceMatrix.needsUpdate = true;
        grass.castShadow = false;
        grass.receiveShadow = false;
        this.grass = grass;
        this.scene.add(grass);
    }

    _updateCompanion(dt) {
        if (!this.companion) return;
        const t = performance.now() * 0.001;
        const p = this.player.position;
        const tx = p.x + Math.sin(t * 1.6) * 1.4;
        const ty = p.y + 1.8 + Math.sin(t * 2.5) * 0.25;
        const tz = p.z + 1.0 + Math.cos(t * 1.3) * 0.6;
        this.companion.position.x += (tx - this.companion.position.x) * 2.8 * dt;
        this.companion.position.y += (ty - this.companion.position.y) * 2.8 * dt;
        this.companion.position.z += (tz - this.companion.position.z) * 2.8 * dt;
        // 翅膀
        const flap = 0.55 + Math.abs(Math.sin(t * 15)) * 0.45;
        this.companion.scale.x = 0.95 * flap;
        // 跟随光
        if (this.companionLight) this.companionLight.position.copy(this.companion.position);
    }

    _spawnLandingDust3D() {
        const isWet = this.weather === 'rain';
        const color = isWet ? 0xa8d8f0 : 0xa8e3a8;
        const opacity = isWet ? 0.95 : 0.85;
        const count = 7;
        for (let i = 0; i < count; i++) {
            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 6, 5),
                new THREE.MeshBasicMaterial({ color, transparent: true, opacity })
            );
            const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
            const sp = 2.2 + Math.random() * 1.5;
            dot.userData = {
                vx: Math.cos(ang) * sp,
                vy: 2.4 + Math.random() * 1.4,
                vz: Math.sin(ang) * sp,
                life: 0.55,
                full: 0.55,
            };
            dot.position.set(this.player.position.x, 0.1, this.player.position.z);
            this.scene.add(dot);
            this.landParticles.push(dot);
        }
    }

    _updateLandingParticles(dt) {
        if (this.landParticles.length === 0) return;
        this.landParticles = this.landParticles.filter(p => {
            p.userData.life -= dt;
            if (p.userData.life <= 0) {
                this.scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
                return false;
            }
            p.userData.vy -= 12 * dt;
            p.position.x += p.userData.vx * dt;
            p.position.y += p.userData.vy * dt;
            p.position.z += p.userData.vz * dt;
            if (p.position.y < 0.05) { p.position.y = 0.05; p.userData.vy *= -0.3; }
            p.material.opacity = Math.min(1, p.userData.life / p.userData.full);
            return true;
        });
    }

    _updateFootprints(dt) {
        if (!this.onGround || this.dying || this.won) {
            this._fadeFootprints(dt);
            return;
        }
        const p = this.player.position;
        this.footprintCooldown -= dt;
        if (this.footprintCooldown <= 0) {
            const d = this.lastFootprintPos.distanceTo(p);
            if (d > 0.45) {
                this._dropFootprint(p.x, p.z);
                this.lastFootprintPos.copy(p);
                this.footprintCooldown = 0.12;
            }
        }
        this._fadeFootprints(dt);
    }

    _fadeFootprints(dt) {
        this.footprints = this.footprints.filter(f => {
            f.life -= dt;
            if (f.life <= 0) {
                this.scene.remove(f.mesh);
                f.mesh.geometry.dispose();
                f.mesh.material.dispose();
                return false;
            }
            f.mesh.material.opacity = Math.min(0.4, (f.life / f.full) * 0.4);
            return true;
        });
    }

    _dropFootprint(x, z) {
        const isWet = this.weather === 'rain';
        const color = isWet ? 0x3a6478 : 0x4a8a3a;
        const fp = new THREE.Mesh(
            new THREE.CircleGeometry(0.18, 12),
            new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.4, depthWrite: false,
            })
        );
        fp.rotation.x = -Math.PI / 2;
        fp.position.set(x, 0.025, z);
        this.scene.add(fp);
        this.footprints.push({ mesh: fp, life: 4, full: 4 });
    }

    _createStars() {
        const count = 320;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * 0.45 * Math.PI; // 上半球（带点收口避免地平线下）
            const r = 95;
            positions[i*3]   = r * Math.sin(phi) * Math.cos(theta);
            positions[i*3+1] = r * Math.cos(phi);
            positions[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
            // 颜色偏暖白/冷蓝随机
            const k = Math.random();
            colors[i*3]   = 0.85 + 0.15 * k;
            colors[i*3+1] = 0.88 + 0.12 * k;
            colors[i*3+2] = 1.0;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({
            size: 1.5,
            vertexColors: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            sizeAttenuation: true,
            fog: false,
        });
        this.stars = new THREE.Points(geo, mat);
        this.scene.add(this.stars);
    }

    _initWeather() {
        this.weatherTimer = 20;
        this.weather = 'sunny';
        // 雨：真正的雨丝 —— 用 LineSegments，每滴一根短竖线（Points 永远是方块，做不出雨丝）
        const rainCount = 700;
        this._rainLen = 0.85;
        const rainPos = new Float32Array(rainCount * 2 * 3);  // 每滴 2 个端点
        for (let i = 0; i < rainCount; i++) {
            const x = (Math.random() - 0.5) * 90;
            const y = Math.random() * 30;
            const z = (Math.random() - 0.5) * 90;
            rainPos[i*6]   = x; rainPos[i*6+1] = y + this._rainLen; rainPos[i*6+2] = z;  // 顶
            rainPos[i*6+3] = x; rainPos[i*6+4] = y;                 rainPos[i*6+5] = z;  // 底
        }
        const rainGeo = new THREE.BufferGeometry();
        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
        this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
            color: 0xbfe3f5, transparent: true, opacity: 0.5, fog: true,
        }));
        this.rain.visible = false;
        this.scene.add(this.rain);

        // 雪：白色 Points + 柔和圆雪花贴图（不再是方块），慢飘 + 横向漂
        const snowTex = makeSnowflakeTexture();
        const snowCount = 500;
        const snowPos = new Float32Array(snowCount * 3);
        const snowDrift = new Float32Array(snowCount);
        for (let i = 0; i < snowCount; i++) {
            snowPos[i*3]   = (Math.random() - 0.5) * 90;
            snowPos[i*3+1] = Math.random() * 28;
            snowPos[i*3+2] = (Math.random() - 0.5) * 90;
            snowDrift[i] = Math.random() * Math.PI * 2;
        }
        const snowGeo = new THREE.BufferGeometry();
        snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
        this._snowDrift = snowDrift;
        this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
            map: snowTex, color: 0xffffff, size: 0.5, transparent: true, opacity: 0.9,
            depthWrite: false, fog: true,
        }));
        this.snow.visible = false;
        this.scene.add(this.snow);

        this._weatherChip = document.getElementById('game-weather');
        if (this._weatherChip) this._weatherChip.textContent = '☀️ 晴';
    }

    _updateWeather(dt) {
        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) {
            const choices = ['sunny', 'rain', 'snow'].filter(w => w !== this.weather);
            this.weather = choices[Math.floor(Math.random() * choices.length)];
            this.weatherTimer = 45 + Math.random() * 30;
            this.rain.visible = this.weather === 'rain';
            this.snow.visible = this.weather === 'snow';
            if (this._weatherChip) {
                this._weatherChip.textContent =
                    this.weather === 'rain' ? '🌧️ 雨' :
                    this.weather === 'snow' ? '❄️ 雪' : '☀️ 晴';
            }
            // 雨天蛋身湿润：水珠显形 + 身体颜色压暗
            if (this.bodyMesh) {
                const wet = this.weather === 'rain';
                this.bodyMesh.material.color.setHex(wet ? this._bodyColorWet : this._bodyColorDry);
                if (this.waterDrops) this.waterDrops.forEach(d => d.visible = wet);
            }
        }
        if (this.weather === 'rain') this._stepRain(dt);
        else if (this.weather === 'snow') this._stepSnow(dt);
    }

    _stepRain(dt) {
        const pos = this.rain.geometry.attributes.position.array;
        const p = this.player.position;
        const fall = 30;
        const len = this._rainLen;
        // 每滴 2 个端点（顶=i*6+1，底=i*6+4），整根一起下落；底端落地就回收到玩家头顶
        for (let i = 0; i < pos.length; i += 6) {
            pos[i+1] -= fall * dt;
            pos[i+4] -= fall * dt;
            if (pos[i+4] < 0) {
                const x = p.x + (Math.random() - 0.5) * 60;
                const z = p.z + (Math.random() - 0.5) * 60;
                const y = 22 + Math.random() * 8;
                pos[i]   = x; pos[i+1] = y + len; pos[i+2] = z;
                pos[i+3] = x; pos[i+4] = y;       pos[i+5] = z;
            }
        }
        this.rain.geometry.attributes.position.needsUpdate = true;
    }

    _stepSnow(dt) {
        const pos = this.snow.geometry.attributes.position.array;
        const p = this.player.position;
        const fall = 3.5;
        const t = performance.now() * 0.001;
        for (let i = 0, j = 0; i < pos.length; i += 3, j++) {
            pos[i+1] -= fall * dt;
            pos[i]   += Math.sin(t * 0.7 + this._snowDrift[j]) * 0.5 * dt;
            pos[i+2] += Math.cos(t * 0.5 + this._snowDrift[j]) * 0.4 * dt;
            if (pos[i+1] < 0) {
                pos[i]   = p.x + (Math.random() - 0.5) * 60;
                pos[i+1] = 22 + Math.random() * 8;
                pos[i+2] = p.z + (Math.random() - 0.5) * 60;
            }
        }
        this.snow.geometry.attributes.position.needsUpdate = true;
    }

    _checkFlowerTouches(dt) {
        if (!this.flowers || this.flowers.length === 0) return;
        const p = this.player.position;
        for (const f of this.flowers) {
            const dx = p.x - f.x;
            const dz = p.z - f.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.7 && f.cooldown <= 0 && p.y < 1.5) {
                f.cooldown = 1.2;  // 1.2s 才能再触发
                f.animT = 0;
                this._playFlower();
            }
            if (f.animT < 1) {
                f.animT = Math.min(1, f.animT + dt * 3.5);
                // 三角形脉冲：0→1.4→1
                const wave = f.animT < 0.5
                    ? 1 + 0.4 * (f.animT * 2)
                    : 1 + 0.4 * (1 - (f.animT - 0.5) * 2);
                f.group.scale.setScalar(wave);
            } else if (f.group.scale.x !== 1) {
                f.group.scale.setScalar(1);
            }
            if (f.cooldown > 0) f.cooldown -= dt;
        }
    }

    _scatterTrees() {
        const inPath = (x, z) => {
            if (Math.hypot(x, z) < 9) return true;
            if (Math.abs(x) < 5 && z < 0 && z > -55) return true;
            if (Math.abs(z) < 5 && x > 0 && x <  55) return true;
            if (Math.abs(z) < 5 && x < 0 && x > -55) return true;
            // 避开终点周围
            const goalPad = 5;
            if (Math.hypot(x - 0,  z - (-42)) < goalPad) return true;
            if (Math.hypot(x - 42, z - 0)     < goalPad) return true;
            if (Math.hypot(x - (-42), z - 0)  < goalPad) return true;
            return false;
        };
        for (let i = 0; i < 22; i++) {
            const r = 25 + Math.random() * 50;
            const ang = Math.random() * Math.PI * 2;
            const x = Math.cos(ang) * r;
            const z = Math.sin(ang) * r;
            if (inPath(x, z)) continue;
            if (z < -56) { this._addPineTree(x, z); continue; }  // 雪原里只长雪松
            this._addTree(x, z);
        }
    }

    _addTree(x, z) {
        const group = new THREE.Group();
        const trunkH = 1.4 + Math.random() * 1.0;
        const trunkR = 0.18 + Math.random() * 0.08;
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 8),
            new THREE.MeshToonMaterial({ color: 0x8a5a2e })
        );
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        addOutline(trunk, 0.05);
        group.add(trunk);

        const foliageColors = [0x6cb56c, 0x80c280, 0x589f58, 0x9ad086];
        const fColor = foliageColors[Math.floor(Math.random() * foliageColors.length)];
        const foliageMat = new THREE.MeshToonMaterial({ color: fColor });
        const fCount = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < fCount; i++) {
            const r = 0.65 + Math.random() * 0.35;
            const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), foliageMat);
            ball.position.set(
                (Math.random() - 0.5) * 0.45,
                trunkH + r * 0.4 + i * r * 0.85,
                (Math.random() - 0.5) * 0.45
            );
            ball.scale.y = 0.9 + Math.random() * 0.2;
            ball.castShadow = true;
            addOutline(ball, 0.04);
            group.add(ball);
        }

        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
        this._addPropCollider(x, z, 0.5, 2.6);
    }

    _initBirdFlock() {
        this.birds = [];
        this.birdTimer = 2;        // 2 秒后第一群
        this.birdNextWait = 2;
    }

    _spawnBirdFlock() {
        if (!this._birdTex) {
            const c = document.createElement('canvas');
            c.width = 64; c.height = 32;
            const ctx = c.getContext('2d');
            ctx.strokeStyle = '#2c2c54';
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(4, 24);
            ctx.lineTo(20, 8);
            ctx.lineTo(32, 16);
            ctx.lineTo(44, 8);
            ctx.lineTo(60, 24);
            ctx.stroke();
            this._birdTex = new THREE.CanvasTexture(c);
            this._birdTex.colorSpace = THREE.SRGBColorSpace;
        }
        const count = 5 + Math.floor(Math.random() * 4);
        const dirAng = Math.random() * Math.PI * 2;
        const dx = Math.cos(dirAng), dz = Math.sin(dirAng);
        const startX = -dx * 110, startZ = -dz * 110;
        const speed = 6 + Math.random() * 4;
        const altitude = 16 + Math.random() * 4;
        for (let i = 0; i < count; i++) {
            const off = (i - count / 2) * 1.6;
            const px = -dz, pz = dx;
            const m = new THREE.SpriteMaterial({
                map: this._birdTex, transparent: true, depthWrite: false
            });
            const sp = new THREE.Sprite(m);
            const baseScale = 0.7 + Math.random() * 0.25;
            sp.scale.set(baseScale, baseScale * 0.5, 1);
            sp.position.set(
                startX + px * off + (Math.random() - 0.5) * 0.8,
                altitude + (Math.random() - 0.5) * 1.2,
                startZ + pz * off + (Math.random() - 0.5) * 0.8
            );
            sp.userData = {
                vx: dx * speed,
                vz: dz * speed,
                baseScale,
                phase: Math.random() * Math.PI * 2,
            };
            this.scene.add(sp);
            this.birds.push(sp);
        }
    }

    _updateBirdFlock(dt) {
        this.birdTimer -= dt;
        if (this.birdTimer <= 0) {
            this._spawnBirdFlock();
            this.birdNextWait = 12 + Math.random() * 10;
            this.birdTimer = this.birdNextWait;
        }
        const t = performance.now() * 0.001;
        this.birds = this.birds.filter(b => {
            b.position.x += b.userData.vx * dt;
            b.position.z += b.userData.vz * dt;
            // 翅膀拍动
            const flap = 0.5 + 0.5 * Math.abs(Math.sin(t * 9 + b.userData.phase));
            b.scale.y = b.userData.baseScale * 0.5 * flap;
            if (Math.hypot(b.position.x, b.position.z) > 125) {
                this.scene.remove(b);
                b.material.dispose();
                return false;
            }
            return true;
        });
    }

    _scatterDecorations() {
        // 撒 80 个装饰，避开广场和三条路
        const inPath = (x, z) => {
            if (Math.hypot(x, z) < 7) return true;                       // 广场
            if (Math.abs(x) < 4 && z < 0 && z > -52) return true;        // 北
            if (Math.abs(z) < 4 && x > 0 && x <  52) return true;        // 东
            if (Math.abs(z) < 4 && x < 0 && x > -52) return true;        // 西
            return false;
        };
        for (let i = 0; i < 90; i++) {
            const x = (Math.random() - 0.5) * 160;
            const z = (Math.random() - 0.5) * 160;
            if (inPath(x, z)) continue;
            const t = Math.random();
            if (z < -56) { this._addStone(x, z); continue; }  // 雪原里只有石头，花/灌木不长
            if (t < 0.4)       this._addStone(x, z);
            else if (t < 0.75) this._addFlower(x, z);
            else               this._addBush(x, z);
        }
    }

    _addStone(x, z) {
        const size = 0.18 + Math.random() * 0.35;
        const stone = new THREE.Mesh(
            new THREE.SphereGeometry(size, 8, 6),
            new THREE.MeshToonMaterial({ color: 0xaab0a8 })
        );
        stone.scale.y = 0.55;
        stone.position.set(x, size * 0.35, z);
        stone.rotation.y = Math.random() * Math.PI * 2;
        stone.castShadow = true;
        stone.receiveShadow = true;
        addOutline(stone, 0.05);
        this.scene.add(stone);
    }

    _addFlower(x, z) {
        const group = new THREE.Group();
        // 注册到 this.flowers 供踩花动画用
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6),
            new THREE.MeshToonMaterial({ color: 0x4a8a3a })
        );
        stem.position.y = 0.27;
        group.add(stem);

        const petalColors = [0xff9ab8, 0xffd966, 0xc8a8ff, 0xff7e7e, 0xffffff];
        const colorHex = petalColors[Math.floor(Math.random() * petalColors.length)];
        const petalMat = new THREE.MeshToonMaterial({ color: colorHex });
        for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * Math.PI * 2;
            const petal = new THREE.Mesh(new THREE.SphereGeometry(0.10, 6, 6), petalMat);
            petal.position.set(Math.cos(ang) * 0.09, 0.55, Math.sin(ang) * 0.09);
            petal.castShadow = true;
            group.add(petal);
        }
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 8, 6),
            new THREE.MeshToonMaterial({ color: 0xffd966 })
        );
        core.position.y = 0.57;
        group.add(core);

        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(group);
        this.flowers.push({ group, x, z, cooldown: 0, animT: 1 });
    }

    _addBush(x, z) {
        const group = new THREE.Group();
        const colors = [0x6cb56c, 0x80c280, 0x589f58];
        const colorHex = colors[Math.floor(Math.random() * 3)];
        const mat = new THREE.MeshToonMaterial({ color: colorHex });
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
            const r = 0.22 + Math.random() * 0.22;
            const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
            ball.position.set(
                (Math.random() - 0.5) * 0.5,
                r * 0.75,
                (Math.random() - 0.5) * 0.5
            );
            ball.castShadow = true;
            ball.receiveShadow = true;
            addOutline(ball, 0.04);
            group.add(ball);
        }
        group.position.set(x, 0, z);
        this.scene.add(group);
    }

    _createButterflies() {
        const colors = ['#ff66cc', '#ffe066', '#66ddff', '#c8a8ff', '#ff9999', '#a8e3a8'];
        this.butterflies = [];
        for (let i = 0; i < 14; i++) {
            const tex = makeButterflyTexture(colors[i % colors.length]);
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(mat);
            const baseScale = 0.55 + Math.random() * 0.2;
            sprite.scale.set(baseScale, baseScale, 1);
            sprite.userData = {
                home: new THREE.Vector3(
                    (Math.random() - 0.5) * 70,
                    2 + Math.random() * 3.5,
                    (Math.random() - 0.5) * 70
                ),
                phase: Math.random() * Math.PI * 2,
                speed: 0.6 + Math.random() * 0.4,
                radius: 2 + Math.random() * 2.5,
                baseScale,
            };
            sprite.position.copy(sprite.userData.home);
            this.scene.add(sprite);
            this.butterflies.push(sprite);
        }
    }

    _updateButterflies() {
        const t = performance.now() * 0.001;
        this.butterflies.forEach(b => {
            const d = b.userData;
            b.position.x = d.home.x + Math.sin(t * d.speed * 0.5 + d.phase) * d.radius;
            b.position.y = d.home.y + Math.sin(t * d.speed * 0.9 + d.phase) * 0.5;
            b.position.z = d.home.z + Math.cos(t * d.speed * 0.6 + d.phase) * d.radius;
            // 翅膀拍动：横向缩放模拟（精灵不能真翻翅）
            const flap = 0.55 + Math.abs(Math.sin(t * 14 + d.phase)) * 0.45;
            b.scale.x = d.baseScale * flap;
        });
    }

    _createSkyClouds() {
        const cloudTex = makeCloudTexture();
        this.skyClouds = [];
        for (let i = 0; i < 10; i++) {
            const mat = new THREE.SpriteMaterial({
                map: cloudTex, transparent: true, opacity: 0.75, depthWrite: false
            });
            const cloud = new THREE.Sprite(mat);
            const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
            const r = 50 + Math.random() * 25;
            cloud.position.set(Math.cos(ang) * r, 18 + Math.random() * 6, Math.sin(ang) * r);
            const sc = 10 + Math.random() * 6;
            cloud.scale.set(sc, sc * 0.55, 1);
            cloud.userData = { angle: ang, speed: 0.012 + Math.random() * 0.015, r };
            this.scene.add(cloud);
            this.skyClouds.push(cloud);
        }
    }

    _updateSkyClouds(dt) {
        this.skyClouds.forEach(c => {
            c.userData.angle += c.userData.speed * dt;
            c.position.x = Math.cos(c.userData.angle) * c.userData.r;
            c.position.z = Math.sin(c.userData.angle) * c.userData.r;
        });
    }

    _addDistantHills() {
        // 一圈远景地貌：北雪山 / 东西绿林山 / 南沙丘，形状颜色都对得上各区，不再是看不懂的球
        const snowRock = new THREE.MeshToonMaterial({ color: 0x9fb0c8 });
        const snowCap  = new THREE.MeshToonMaterial({ color: 0xf3f8ff });
        const green    = new THREE.MeshToonMaterial({ color: 0x6aa85a });
        const greenFar = new THREE.MeshToonMaterial({ color: 0x86c074 });
        const sand     = new THREE.MeshToonMaterial({ color: 0xe3c489 });
        const sandFar  = new THREE.MeshToonMaterial({ color: 0xeed3a3 });
        for (let i = 0; i < 22; i++) {
            const angle = (i / 22) * Math.PI * 2;
            const radius = 132 + Math.random() * 16;
            const size = 10 + Math.random() * 8;
            const cx = Math.cos(angle) * radius;
            const cz = Math.sin(angle) * radius;
            const near = Math.random() > 0.5;
            if (cz < -70) {
                this._addPeakMountain(cx, cz, size, snowRock, snowCap);   // ❄️ 雪山：岩锥 + 白雪顶
            } else if (cz > 80) {
                this._addSandDune(cx, cz, size, near ? sand : sandFar);   // 🏜️ 沙丘：低矮宽圆
            } else {
                this._addPeakMountain(cx, cz, size, near ? green : greenFar, null);  // 🌲 绿林山
            }
        }
    }

    // 圆锥山峰（可选白雪顶）——清晰的"山"轮廓
    _addPeakMountain(cx, cz, size, bodyMat, capMat) {
        const h = size * 1.5, rBase = size * 0.95;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(rBase, h, 7), bodyMat);
        const yBase = -size * 0.15;                 // 山脚略陷进地里
        cone.position.set(cx, yBase + h / 2, cz);
        cone.rotation.y = Math.random() * Math.PI;
        this.scene.add(cone);
        if (capMat) {
            const capH = h * 0.42;
            const cap = new THREE.Mesh(new THREE.ConeGeometry(rBase * 0.5, capH, 7), capMat);
            cap.position.set(cx, yBase + h - capH / 2, cz);
            cap.rotation.y = cone.rotation.y;
            this.scene.add(cap);
        }
        const r = rBase * 0.92;   // 贴合山体底盘，蛋停在山脚而不是陷进去（旧 0.7 会走进裙边约 30%）
        this.obstacles.push({
            min: new THREE.Vector3(cx - r, 0, cz - r),
            max: new THREE.Vector3(cx + r, h * 0.8, cz + r),
        });
    }

    // 沙丘：低矮、宽、圆滑的沙堆（明显比山矮平，一看就是沙丘不是山）
    _addSandDune(cx, cz, size, mat) {
        const dune = new THREE.Mesh(new THREE.SphereGeometry(size * 0.9, 14, 8), mat);
        dune.scale.set(1.5, 0.4, 1.05);
        dune.rotation.y = Math.random() * Math.PI;
        dune.position.set(cx, -size * 0.08, cz);
        this.scene.add(dune);
        const r = size * 0.95;
        this.obstacles.push({
            min: new THREE.Vector3(cx - r, 0, cz - r),
            max: new THREE.Vector3(cx + r, size * 0.32, cz + r),
        });
    }

    // 区域接缝羽化：让雪地↔草地、沙地↔草地交错咬合，不再是一刀切的硬边
    _blendBiomeEdges() {
        // 地面贴片（扁圆斑）——撒在接缝两侧，离缝越远越稀（random*random 偏向 0）
        const addPatch = (mat, x, z, rad) => {
            const patch = new THREE.Mesh(new THREE.CircleGeometry(rad, 12), mat);
            patch.rotation.x = -Math.PI / 2;
            patch.rotation.z = Math.random() * Math.PI;
            patch.scale.set(1, 0.7 + Math.random() * 0.6, 1);
            patch.position.set(x, 0.045 + Math.random() * 0.01, z);
            patch.receiveShadow = true;
            this.scene.add(patch);
        };
        // 草地里冒出的小堆（扁球）——草丛/枯草，戳进对面地貌
        const addTuft = (mat, x, z, rad) => {
            const tuft = new THREE.Mesh(new THREE.SphereGeometry(rad, 8, 6), mat);
            tuft.scale.set(1, 0.5, 1);
            tuft.position.set(x, 0.08, z);
            this.scene.add(tuft);
        };

        const snowMat = new THREE.MeshToonMaterial({ color: 0xeef4fb });
        const grassMat = new THREE.MeshToonMaterial({ color: 0x6cae5a });
        const sandMat = new THREE.MeshToonMaterial({ color: 0xe7cd96 });
        const dryMat = new THREE.MeshToonMaterial({ color: 0xc3ad62 });

        // —— 雪地↔草地 接缝（雪原南缘约 z=-55）——
        for (let i = 0; i < 46; i++) {                       // 草地上的雪斑：往南渐疏
            const x = (Math.random() - 0.5) * 152;
            const z = -55 + Math.random() * Math.random() * 18;
            addPatch(snowMat, x, z, 0.8 + Math.random() * 2.4);
        }
        for (let i = 0; i < 24; i++) {                       // 雪地里的草丛：往北渐疏
            const x = (Math.random() - 0.5) * 150;
            const z = -57 - Math.random() * Math.random() * 15;
            addTuft(grassMat, x, z, 0.35 + Math.random() * 0.3);
        }

        // —— 沙地↔草地 接缝（沙漠北缘约 z=78）——
        for (let i = 0; i < 46; i++) {                       // 草地上的沙斑：往北渐疏
            const x = (Math.random() - 0.5) * 162;
            const z = 78 - Math.random() * Math.random() * 18;
            addPatch(sandMat, x, z, 0.8 + Math.random() * 2.4);
        }
        for (let i = 0; i < 22; i++) {                       // 沙地里的枯草丛：往南渐疏
            const x = (Math.random() - 0.5) * 160;
            const z = 80 + Math.random() * Math.random() * 15;
            addTuft(dryMat, x, z, 0.3 + Math.random() * 0.3);
        }
    }

    _buildPlayer() {
        this.player = new THREE.Group();
        this.player.position.set(0, PLAYER_RADIUS, 6);

        // 内层 animRoot：锚点放在"蛋底"，缩放从底部起（挤压时不悬空）
        this.animRoot = new THREE.Group();
        this.animRoot.position.y = -PLAYER_RADIUS;
        this.player.add(this.animRoot);

        const r = PLAYER_RADIUS;
        const bodyColor = hexToInt(this.style.bodyColor);
        const eyeColor = hexToInt(this.style.eyeColor);

        // ===== 蛋形身体 =====
        // 球拉伸成蛋（Y 方向 1.25 倍）+ 几何下移让底部对齐 animRoot 原点
        const bodyGeo = new THREE.SphereGeometry(r, 32, 32);
        bodyGeo.scale(1, 1.25, 1);
        bodyGeo.translate(0, r * 1.25, 0);
        const body = new THREE.Mesh(
            bodyGeo,
            new THREE.MeshToonMaterial({ color: bodyColor })
        );
        body.castShadow = true;
        addOutline(body, 0.06);
        this.animRoot.add(body);
        this.bodyMesh = body;
        this._bodyColorDry = bodyColor;
        // 雨天用的湿身颜色（压暗 25%）
        this._bodyColorWet = darkenHex(bodyColor, 0.75);

        // 雨天的水珠（默认隐藏）
        this.waterDrops = [];
        for (let i = 0; i < 6; i++) {
            const dropR = r * 0.045 + Math.random() * r * 0.04;
            const drop = new THREE.Mesh(
                new THREE.SphereGeometry(dropR, 8, 6),
                new THREE.MeshToonMaterial({
                    color: 0xa8d8f0, transparent: true, opacity: 0.85,
                })
            );
            // 球面上半部随机一点（避免脸正中和底部）
            const u = Math.random() * Math.PI * 2;
            const v = Math.PI * 0.2 + Math.random() * Math.PI * 0.5;
            drop.position.set(
                Math.sin(v) * Math.cos(u) * r * 0.95,
                r * 1.25 + Math.cos(v) * r * 1.20,
                Math.sin(v) * Math.sin(u) * r * 0.95
            );
            drop.visible = false;
            this.animRoot.add(drop);
            this.waterDrops.push(drop);
        }

        // ===== 眼睛（蛋脸上半）=====
        const eyeR = r * 0.22;
        const eyeWhiteMat = new THREE.MeshToonMaterial({ color: 0xffffff });
        const pupilMat = new THREE.MeshToonMaterial({ color: eyeColor });
        for (const sx of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 16, 16), eyeWhiteMat);
            eye.position.set(sx * r * 0.32, r * 1.55, -r * 0.78);
            this.animRoot.add(eye);
            const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.55, 12, 12), pupilMat);
            pupil.position.set(sx * r * 0.32, r * 1.55, -r * 0.93);
            this.animRoot.add(pupil);
        }

        // ===== 腮红 =====
        const cheekMat = new THREE.MeshBasicMaterial({
            color: 0xff8fb8, transparent: true, opacity: 0.6
        });
        for (const sx of [-1, 1]) {
            const cheek = new THREE.Mesh(new THREE.CircleGeometry(r * 0.18, 14), cheekMat);
            cheek.position.set(sx * r * 0.5, r * 1.22, -r * 0.6);
            cheek.lookAt(sx * r * 5, r * 1.22, -r * 5);
            this.animRoot.add(cheek);
        }

        // ===== 嘴（笑脸半圆环）=====
        const mouthGeo = new THREE.TorusGeometry(r * 0.13, r * 0.02, 6, 16, Math.PI);
        const mouth = new THREE.Mesh(
            mouthGeo,
            new THREE.MeshBasicMaterial({ color: 0x2c2c54 })
        );
        mouth.position.set(0, r * 1.05, -r * 0.86);
        mouth.rotation.z = Math.PI; // 翻成 U 形 = 微笑
        this.animRoot.add(mouth);

        // ===== 头顶装饰 =====
        this._addAccessory(this.style.accessory, r);

        // 动画状态
        this._animScaleXZ = 1;
        this._animScaleY = 1;
        this._landImpact = 0;
        this._wasInAir = false;

        this.scene.add(this.player);
    }

    _addAccessory(type, r) {
        // 装饰加在 animRoot 里，跟着挤压拉伸一起动；y 都基于"蛋顶在 2.5r"
        const top = r * 2.5;
        if (type === 'bow') {
            const bowMat = new THREE.MeshToonMaterial({ color: 0xff3a78 });
            const left = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, r * 0.32, r * 0.16), bowMat);
            left.position.set(-r * 0.18, top + r * 0.05, 0);
            left.rotation.z = -0.25;
            left.castShadow = true;
            this.animRoot.add(left);
            const right = new THREE.Mesh(new THREE.BoxGeometry(r * 0.35, r * 0.32, r * 0.16), bowMat);
            right.position.set(r * 0.18, top + r * 0.05, 0);
            right.rotation.z = 0.25;
            right.castShadow = true;
            this.animRoot.add(right);
            const knot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 12, 12), bowMat);
            knot.position.y = top + r * 0.05;
            this.animRoot.add(knot);
        } else if (type === 'leaf') {
            const stemMat = new THREE.MeshToonMaterial({ color: 0x4a8a3a });
            const leafMat = new THREE.MeshToonMaterial({ color: 0x86d96a });
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.04, r * 0.04, r * 0.35, 8), stemMat);
            stem.position.y = top + r * 0.12;
            this.animRoot.add(stem);
            for (const sx of [-1, 1]) {
                const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.18, 10, 10), leafMat);
                leaf.scale.set(0.55, 1.5, 0.55);
                leaf.position.set(sx * r * 0.16, top + r * 0.22, 0);
                leaf.rotation.z = sx * 0.65;
                leaf.castShadow = true;
                this.animRoot.add(leaf);
            }
        } else if (type === 'crown') {
            const crownMat = new THREE.MeshToonMaterial({ color: 0xffd700 });
            const band = new THREE.Mesh(
                new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 0.20, 16),
                crownMat
            );
            band.position.y = top - r * 0.05;
            band.castShadow = true;
            this.animRoot.add(band);
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const cone = new THREE.Mesh(
                    new THREE.ConeGeometry(r * 0.10, r * 0.28, 6),
                    crownMat
                );
                cone.position.set(
                    Math.cos(angle) * r * 0.55,
                    top + r * 0.18,
                    Math.sin(angle) * r * 0.55
                );
                cone.castShadow = true;
                this.animRoot.add(cone);
            }
            const gem = new THREE.Mesh(
                new THREE.SphereGeometry(r * 0.09, 12, 12),
                new THREE.MeshToonMaterial({ color: 0xff3a78, emissive: 0x550022 })
            );
            gem.position.set(0, top - r * 0.02, -r * 0.55);
            this.animRoot.add(gem);
        }
    }

    _setupInput() {
        // ===== 鼠标视角（pointer lock）=====
        this.cameraYaw = 0;
        this.cameraPitch = -0.15;
        this.mouseLocked = false;

        this._onCanvasClick = () => {
            if (!this.mouseLocked && !this.won && !this.dying) {
                this.renderer.domElement.requestPointerLock?.();
            }
        };
        this.renderer.domElement.addEventListener('click', this._onCanvasClick);

        this._onPointerLockChange = () => {
            this.mouseLocked = document.pointerLockElement === this.renderer.domElement;
        };
        document.addEventListener('pointerlockchange', this._onPointerLockChange);

        this._onMouseMove = (e) => {
            if (!this.mouseLocked) return;
            const sens = 0.0028;
            this.cameraYaw += e.movementX * sens;
            this.cameraPitch -= e.movementY * sens;
            const lim = Math.PI / 2 - 0.1;
            if (this.cameraPitch >  lim) this.cameraPitch =  lim;
            if (this.cameraPitch < -lim) this.cameraPitch = -lim;
        };
        document.addEventListener('mousemove', this._onMouseMove);

        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            this._ensureAudio();  // 首次按键解锁 AudioContext
            if (e.code === 'KeyC' && this.onOpenCustomize) {
                e.preventDefault();
                this.onOpenCustomize();
            }
            if (this.dying && e.code === 'Space') {
                e.preventDefault();
                this._restart();
            }
            // 数字键切时段
            if (e.code === 'Digit1') this.dayPhase = 0.5;   // 正午
            if (e.code === 'Digit2') this.dayPhase = 0.78;  // 日落
            if (e.code === 'Digit3') this.dayPhase = 0.0;   // 半夜
            if (e.code === 'Digit4') this.dayPhase = 0.25;  // 日出
            // 彩蛋：Konami 输入序列追踪
            if (this._konamiSeq) this._onKonamiKey(e.code);
            // 互动键
            if (e.code === 'KeyE') { e.preventDefault(); this._doWatering(); }
            if (e.code === 'KeyF') { e.preventDefault(); this._toggleFishing(); }
            if (e.code === 'KeyM') { e.preventDefault(); this._toggleBGM(); }
            if (e.code === 'KeyJ') { e.preventDefault(); this._doMeleeAttack(); }
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
        };
        this._onKeyUp = (e) => { this.keys[e.code] = false; };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);

        // ===== 触屏控制（仅触屏设备显示）=====
        this.touchMove = { x: 0, y: 0 };
        this._setupTouchControls();
    }

    _setupTouchControls() {
        const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
        if (!isTouch) return;

        const ui = document.createElement('div');
        Object.assign(ui.style, {
            position: 'fixed', inset: '0', zIndex: '12',
            touchAction: 'none', userSelect: 'none',
        });
        document.body.appendChild(ui);
        this._touchUI = ui;

        // 左下虚拟摇杆（按下才出现）
        const base = document.createElement('div');
        Object.assign(base.style, {
            position: 'fixed', width: '130px', height: '130px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.4)',
            display: 'none', zIndex: '12', pointerEvents: 'none',
        });
        const knob = document.createElement('div');
        Object.assign(knob.style, {
            position: 'absolute', left: '40px', top: '40px', width: '50px', height: '50px',
            borderRadius: '50%', background: 'rgba(255,255,255,0.55)', pointerEvents: 'none',
        });
        base.appendChild(knob);
        ui.appendChild(base);

        // 右下动作按钮
        const mkBtn = (label, bottom, color, onDown, onUp) => {
            const btn = document.createElement('div');
            Object.assign(btn.style, {
                position: 'fixed', right: '24px', bottom: bottom + 'px',
                width: '74px', height: '74px', borderRadius: '50%',
                background: color, color: '#fff', fontSize: '15px', fontWeight: 'bold',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: '13', textAlign: 'center',
            });
            btn.textContent = label;
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault(); e.stopPropagation();
                this._ensureAudio();
                btn.style.transform = 'scale(0.92)';
                onDown && onDown();
            }, { passive: false });
            const up = (e) => { e.stopPropagation(); btn.style.transform = ''; onUp && onUp(); };
            btn.addEventListener('touchend', up);
            btn.addEventListener('touchcancel', up);
            ui.appendChild(btn);
            return btn;
        };
        mkBtn('⤴︎\n跳', 200, 'rgba(120,200,120,0.85)',
            () => { this.keys['Space'] = true; }, () => { this.keys['Space'] = false; });
        mkBtn('👊\n打', 290, 'rgba(230,140,120,0.85)', () => this._doMeleeAttack());
        mkBtn('💧\n浇花', 110, 'rgba(120,180,230,0.85)', () => this._doWatering());
        mkBtn('🎣\n钓鱼', 20, 'rgba(180,150,230,0.85)', () => this._toggleFishing());

        // 多点触控：左半屏=摇杆，右半屏=转视角
        let joyId = null, joyCx = 0, joyCy = 0, camId = null, camLX = 0, camLY = 0;
        const R = 55;
        ui.addEventListener('touchstart', (e) => {
            this._ensureAudio();
            for (const t of e.changedTouches) {
                if (t.clientX < window.innerWidth * 0.45 && joyId === null) {
                    joyId = t.identifier; joyCx = t.clientX; joyCy = t.clientY;
                    base.style.left = (joyCx - 65) + 'px';
                    base.style.top = (joyCy - 65) + 'px';
                    base.style.display = 'block';
                } else if (camId === null) {
                    camId = t.identifier; camLX = t.clientX; camLY = t.clientY;
                }
            }
        }, { passive: false });
        ui.addEventListener('touchmove', (e) => {
            e.preventDefault();
            for (const t of e.changedTouches) {
                if (t.identifier === joyId) {
                    let dx = t.clientX - joyCx, dy = t.clientY - joyCy;
                    const len = Math.hypot(dx, dy);
                    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
                    knob.style.transform = `translate(${dx}px,${dy}px)`;
                    this.touchMove.x = dx / R;
                    this.touchMove.y = -dy / R;   // 屏幕往下 = 后退
                } else if (t.identifier === camId) {
                    const sens = 0.005;
                    this.cameraYaw += (t.clientX - camLX) * sens;
                    this.cameraPitch -= (t.clientY - camLY) * sens;
                    const lim = Math.PI / 2 - 0.1;
                    this.cameraPitch = Math.max(-lim, Math.min(lim, this.cameraPitch));
                    camLX = t.clientX; camLY = t.clientY;
                }
            }
        }, { passive: false });
        const endTouch = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier === joyId) {
                    joyId = null; this.touchMove.x = 0; this.touchMove.y = 0;
                    base.style.display = 'none'; knob.style.transform = '';
                }
                if (t.identifier === camId) camId = null;
            }
        };
        ui.addEventListener('touchend', endTouch);
        ui.addEventListener('touchcancel', endTouch);

        // 触屏不需要"点屏幕锁鼠标"，更新提示
        if (this.hintEl) this.hintEl.textContent = '左下摇杆走 · 右半屏拖动看 · 右下按钮跳/打/浇花/钓鱼';
    }

    _setupStatusUI() {
        this.statusEl = document.getElementById('game-status');
        if (this.statusEl) this.statusEl.style.display = 'none';
        this.hintEl = document.getElementById('game-hint');
        if (this.hintEl) {
            this.hintEl.style.display = 'block';
            this.hintEl.textContent = '点屏幕锁鼠标 · WASD 走 · 鼠标看 · 空格跳 · J 攻击 · E 浇花 · F 钓鱼 · M 音乐 · C 换造型 · ESC 释放';
        }
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
        if (this.bloomPass) this.bloomPass.setSize(window.innerWidth, window.innerHeight);
    }

    _tick() {
        const dt = Math.min(this.clock.getDelta(), 0.05);

        if (!this.won && !this.dying) {
            this._updatePlayer(dt);
            this._resolveObstacleCollisions();
            this._checkSpikes();
        }
        this._updatePlayerAnimation(dt);
        this._updateHurtFlash(dt);
        this._updateDamageNumbers(dt);
        this._updateButterflies();
        this._updateSkyClouds(dt);
        this._updateBirdFlock(dt);
        this._updateWeather(dt);
        this._updateDayNight(dt);
        this._updateLandingParticles(dt);
        this._updateFootprints(dt);
        this._updateCompanion(dt);
        this._updateAnimDecor();
        this._updateNPCs();
        this._updateStoryNpcs(dt);
        this._updateLightning(dt);
        this._updateHouseTransparency(dt);
        this._checkBeds(dt);
        this._checkCandles(dt);
        this._updateSmoke(dt);
        this._updateFireflies(dt);
        this._updateDayMotes(dt);
        this._updateLakeGlint(dt);
        this._updateSnowFX(dt);
        this._updateDesertFX(dt);
        this._updateBunnies(dt);
        this._updateRipples(dt);
        this._updateLampposts();
        this._updateCollectStars(dt);
        this._updateQuest(dt);
        this._updateHotAirBalloon(dt);
        this._updateSnowmen();
        this._updateHolidayLights();
        this._updateFountain(dt);
        this._updateBellTower(dt);
        this._updateChickens(dt);
        this._updateFireworks(dt);
        this._updateBats(dt);
        this._updateWind(dt);
        this._updateFishingBoat();
        this._updateLighthouse(dt);
        this._checkGreets();
        this._updateRainbow(dt);
        this._updateShootingStars(dt);
        if (!this.dying && !this.won) {
            this._checkSwimming(dt);
            this._checkIceSlide(dt);
            this._checkPenguin();
            this._updateBridgeTreasure(dt);
            this._checkFountainWish(dt);
            this._updateBackyardGold(dt);
        }
        this._updateGiantMode(dt);
        this._updateFishing(dt);
        this._updateSeason(dt);
        this._updateBGM(dt);
        this._updateExtraction(dt);
        this._updateMagicBird(dt);
        if (!this.dying && !this.won) {
            this._updateChests(dt);
            this._updateMonsters(dt);
        }
        if (this._wateringCooldown > 0) this._wateringCooldown -= dt;
        if (!this.dying && !this.won) {
            this._checkHiddenFox();
            this._checkLighthouseNote();
            this._checkSnowStand(dt);
        }
        // 风车撞飞冷却
        if (this._knockbackCooldown > 0) {
            this._knockbackCooldown -= dt;
            if (this._knockbackCooldown <= 0) this._knockbackCooldown = 0;
        }
        if (!this.dying && !this.won) this._checkWindmillKnockback();
        // toon ramp 兜底：每 2 秒扫一遍，补上"先入场景后挂材质"的漏网之鱼
        this._rampPatchT = (this._rampPatchT || 0) + dt;
        if (this._rampPatchT > 2) {
            this._rampPatchT = 0;
            this._patchToon(this.scene);
        }
        // 草地风偏移 shader uniform
        if (this.grass && this.grass.material.userData.shader) {
            this.grass.material.userData.shader.uniforms.uTime.value =
                performance.now() * 0.001;
        }
        if (!this.dying && !this.won) this._checkFlowerTouches(dt);
        this._updateRegionFeel(dt);
        this._updateCamera();

        // 湖面 LOD：离湖远了换静态水面，关掉每帧重渲整场景的 Reflector
        if (this.lake && this._lakeFallback) {
            const near = this.player.position.distanceTo(this._lakeCenter) < 45;
            this.lake.visible = near;
            this._lakeFallback.visible = !near;
        }

        // 阴影每 3 帧刷一次（autoUpdate 已关）
        this._shadowTick = ((this._shadowTick || 0) + 1) % 3;
        if (this._shadowTick === 0) this.sun.shadow.needsUpdate = true;

        this.composer.render();
        this.animId = requestAnimationFrame(this._tick);
    }

    _updatePlayer(dt) {
        // 计算目标方向（原始 WASD 输入）
        let ix = 0, iz = 0;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) iz += 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) iz -= 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) ix -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) ix += 1;
        // 触屏虚拟摇杆
        if (this.touchMove && (this.touchMove.x || this.touchMove.y)) {
            ix += this.touchMove.x; iz += this.touchMove.y;
        }
        const mag = Math.hypot(ix, iz);
        if (mag > 0) { ix /= mag; iz /= mag; }

        // 把输入旋转到相机坐标：W = 相机正前方
        const yaw = this.cameraYaw;
        const fwdX = Math.sin(yaw), fwdZ = -Math.cos(yaw);
        const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
        const tx = ix * rightX + iz * fwdX;
        const tz = ix * rightZ + iz * fwdZ;

        // 朝目标速度平滑加/减速（不再瞬时启停）
        const targetVx = tx * MOVE_SPEED;
        const targetVz = tz * MOVE_SPEED;
        const step = (mag > 0 ? ACCEL : DECEL) * dt;
        this.velocity.x = approach(this.velocity.x, targetVx, step);
        this.velocity.z = approach(this.velocity.z, targetVz, step);

        this.player.position.x += this.velocity.x * dt;
        this.player.position.z += this.velocity.z * dt;

        // 朝向：鼠标锁定时跟相机；否则跟速度方向
        if (this.mouseLocked) {
            this.player.rotation.y = lerpAngle(this.player.rotation.y, yaw, 0.25);
        } else {
            const vmag = Math.hypot(this.velocity.x, this.velocity.z);
            if (vmag > 0.5) {
                const targetAngle = Math.atan2(this.velocity.x, -this.velocity.z);
                this.player.rotation.y = lerpAngle(this.player.rotation.y, targetAngle, 0.18);
            }
        }

        if (this.keys['Space'] && this.onGround) {
            this.playerVy = JUMP_SPEED;
            this.onGround = false;
            this._playJump();
            this._unlockAchievement?.('first_jump');
        }

        this.playerVy -= GRAVITY * dt;
        this.player.position.y += this.playerVy * dt;

        const groundY = PLAYER_RADIUS * (this.player.scale.x || 1);  // 巨化时落地高度同步，别陷地
        if (this.player.position.y <= groundY) {
            this.player.position.y = groundY;
            this.playerVy = 0;
            this.onGround = true;
        }
    }

    _resolveObstacleCollisions() {
        let landedOnTop = false;
        const pr = PLAYER_RADIUS * (this.player.scale.x || 1);  // 巨化时碰撞半径同步放大，别穿墙
        for (const obs of this.obstacles) {
            const hit = sphereVsAABB(this.player.position, pr, obs.min, obs.max);
            if (hit) {
                this.player.position.x += hit.nx * hit.depth;
                this.player.position.y += hit.ny * hit.depth;
                this.player.position.z += hit.nz * hit.depth;
                if (hit.ny > 0.5 && this.playerVy < 0) {
                    this.playerVy = 0;
                    landedOnTop = true;
                }
            }
        }
        if (landedOnTop) this.onGround = true;
    }

    // 给道具登记一个方形碰撞体（树/雪人/路灯/喷泉等，玩家撞上去会被挡，不再穿过）
    _addPropCollider(x, z, r, h = 2.4) {
        this.obstacles.push({
            min: new THREE.Vector3(x - r, 0, z - r),
            max: new THREE.Vector3(x + r, h, z + r),
        });
    }

    _checkSpikes() {
        for (const spk of this.spikes) {
            if (sphereVsAABB(this.player.position, PLAYER_RADIUS, spk.min, spk.max)) {
                this._triggerDeath();
                return;
            }
        }
    }

    _updatePlayerAnimation(dt) {
        // 12 原则的"挤压拉伸"：所有非物理形变都在 animRoot 上做
        const t = performance.now() * 0.001;
        const vmag = Math.hypot(this.velocity.x, this.velocity.z);

        let targetXZ = 1;
        let targetY = 1;

        // 落地后短暂压扁（impact 从 1 衰减到 0） + 溅起粒子 + 落地音
        if (this._wasInAir && this.onGround) {
            this._landImpact = 1;
            this._spawnLandingDust3D();
            this._playLand();
        }
        this._wasInAir = !this.onGround;

        if (this._landImpact > 0.01) {
            targetXZ = 1 + 0.28 * this._landImpact;
            targetY  = 1 - 0.32 * this._landImpact;
            this._landImpact = Math.max(0, this._landImpact - dt * 6);
        } else if (!this.onGround) {
            // 跳起/下落：纵向拉长
            const stretch = this.playerVy > 0 ? 0.20 : 0.12;
            targetXZ = 1 - stretch * 0.55;
            targetY  = 1 + stretch;
        } else if (vmag > 1) {
            // 走路：身体上下颠 + 微微 wobble
            const bob = Math.sin(t * 12) * 0.06;
            targetXZ = 1 + bob * 0.6;
            targetY  = 1 - bob;
        } else {
            // 待机：轻呼吸
            const breathe = Math.sin(t * 1.8) * 0.03;
            targetXZ = 1 + breathe * 0.4;
            targetY  = 1 - breathe;
        }

        // 平滑过渡，不要突变
        this._animScaleXZ = approach(this._animScaleXZ, targetXZ, 14 * dt);
        this._animScaleY  = approach(this._animScaleY,  targetY,  14 * dt);
        this.animRoot.scale.set(this._animScaleXZ, this._animScaleY, this._animScaleXZ);
    }

    _updateDayNight(dt) {
        // 白天(0.25~0.75)正常走→约5分钟；夜里加速5倍→约1分钟（仍保留星空/流星时段）
        const nightSpeedup = (this.dayPhase < 0.25 || this.dayPhase > 0.75) ? 5 : 1;
        this.dayPhase = (this.dayPhase + (dt / this.dayDuration) * nightSpeedup) % 1;
        // 太阳轨迹：phase 0 = 半夜，0.25 = 日出，0.5 = 正午，0.75 = 日落
        const ang = this.dayPhase * Math.PI * 2 - Math.PI / 2; // 半夜时 sin=-1
        const sunHeight = Math.sin(ang);        // -1..1
        const dayness = Math.max(0, sunHeight); // 0..1（白天程度）

        // 太阳位置（绕场景画弧）
        this.sun.position.set(
            Math.cos(ang) * 35,
            Math.max(-8, sunHeight * 38),
            18
        );
        this.sun.intensity = 0.15 + 0.85 * dayness;

        // 太阳光色：正午白，日出/日落暖橙，夜里偏冷
        const c = this._tmpColor;
        if (sunHeight >= 0) {
            // 朝阳/正午：从橙(地平线)到白(头顶)
            const k = Math.min(1, sunHeight * 2.2);
            c.setRGB(1, 0.6 + 0.4 * k, 0.3 + 0.65 * k);
        } else {
            // 夜：暗淡冷蓝
            c.setRGB(0.25, 0.35, 0.55);
        }
        this.sun.color.copy(c);

        // 环境光：白天满，夜里压到 0.08
        this.ambient.intensity = 0.08 + 0.42 * dayness;
        this.hemi.intensity   = 0.10 + 0.30 * dayness;

        // 曝光：白天 1.1，夜里 0.45；黄金时刻额外提亮（否则日出日落死暗）
        const goldenLift = Math.pow(Math.max(0, 1 - Math.abs(sunHeight) / 0.34), 1.4);
        this.renderer.toneMappingExposure = 0.45 + 0.7 * dayness + 0.35 * goldenLift;

        // 星星：日落后淡入，午夜全亮，缓慢自转
        if (this.stars) {
            this.stars.material.opacity = Math.max(0, -sunHeight * 1.4);
            this.stars.rotation.y += 0.008 * dt;
        }

        // 太阳和月亮位置（远端绕场景画弧）
        const skyR = 75;
        if (this.sunMesh) {
            const sx = Math.cos(ang) * skyR;
            const sy = sunHeight * skyR;
            const sz = -22;
            this.sunMesh.position.set(sx, sy, sz);
            this.sunGlow.position.set(sx, sy, sz);
            const sunUp = sunHeight > -0.05;
            this.sunMesh.visible = sunUp;
            this.sunGlow.visible = sunUp;
        }
        if (this.moonMesh) {
            const mx = -Math.cos(ang) * skyR;
            const my = -sunHeight * skyR;
            const mz = -22;
            this.moonMesh.position.set(mx, my, mz);
            this.moonGlow.position.set(mx, my, mz);
            const moonUp = sunHeight < 0.10;
            this.moonMesh.visible = moonUp;
            this.moonGlow.visible = moonUp;
        }

        // ===== 天空穹顶 + 雾色（连续插值，无档位跳变）=====
        // skyDay：比光照 dayness 更平滑的过渡（日出前就开始泛蓝）
        const skyDay = THREE.MathUtils.smoothstep(sunHeight, -0.14, 0.38);
        // setness：太阳贴近地平线时达到峰值（日出日落的暖晕浓度）
        const setness = Math.pow(Math.max(0, 1 - Math.abs(sunHeight) / 0.34), 1.4);
        this._lastDayness = dayness;
        if (this.skyDome) {
            const u = this._skyUniforms;
            u.uDayness.value = skyDay;
            u.uSetness.value = setness;
            u.uSunDir.value.copy(this.sun.position).normalize();
            this.skyDome.position.copy(this.camera.position);
        }
        // 雾色 = 天空地平线色（同一套混色公式，远景与天空无缝衔接）
        if (!this._tmpColor2) this._tmpColor2 = new THREE.Color();
        const fogC = this._tmpColor2;
        fogC.copy(this._skyUniforms.uHorNight.value)
            .lerp(this._skyUniforms.uHorDay.value, skyDay)
            .lerp(this._skyUniforms.uHorSet.value, setness * 0.85);
        // 雪原冷雾：人走进北边雪区，雾色渐渐转成冰蓝（空气也"变冷"）
        const pz = this.player ? this.player.position.z : 0;
        const snowK = THREE.MathUtils.smoothstep(-pz, 50, 66);
        if (snowK > 0) {
            if (!this._tmpColor4) this._tmpColor4 = new THREE.Color();
            const icy = this._tmpColor4.setRGB(0.80, 0.88, 0.97)
                .multiplyScalar(0.25 + 0.75 * skyDay);  // 夜里冷雾也得是暗的
            fogC.lerp(icy, snowK * 0.75);
        }
        this.scene.fog.color.copy(fogC);
        // 云染色：白天白、黄昏橘粉、夜里暗蓝
        if (this.skyClouds) {
            if (!this._tmpColor3) this._tmpColor3 = new THREE.Color();
            const cloudC = this._tmpColor3;
            cloudC.setRGB(0.36, 0.40, 0.55)                            // 夜
                .lerp(this._tmpColor.setRGB(0.93, 0.95, 0.98), skyDay) // 昼（压低于 bloom 阈值）
                .lerp(this._tmpColor.setRGB(1, 0.74, 0.58), setness * 0.6); // 霞（轻染，别成血块）
            this.skyClouds.forEach(cl => cl.material.color.copy(cloudC));
        }
        // 补光跟着太阳走对侧；夜里就是月光
        if (this.fillLight) {
            this.fillLight.position.set(-this.sun.position.x, 26, -this.sun.position.z);
            this.fillLight.intensity = 0.12 + 0.16 * dayness;
        }

        // 时段提示
        if (this._timeChip) {
            let label;
            if (sunHeight >= 0.55)      label = '☀️ 正午';
            else if (sunHeight >= 0.05) label = '🌤️ 白天';
            else if (sunHeight >= -0.1) label = (this.dayPhase < 0.5 ? '🌅 日出' : '🌇 日落');
            else                        label = '🌙 夜晚';
            if (this._timeChip.textContent !== label) {
                this._timeChip.textContent = label;
            }
        }
    }

    _updateCamera() {
        if (this._fpsT === undefined) {
            this._fpsT = 0;
            this._tmpLook = new THREE.Vector3();
        }
        const target = this.isInsideHouse ? 1 : 0;
        this._fpsT += (target - this._fpsT) * 0.18;

        const p = this.player.position;
        const yaw = this.cameraYaw;
        const pitch = this.cameraPitch;
        const fwdX = Math.sin(yaw), fwdZ = -Math.cos(yaw);

        // 室外：相机在 lookDir 反方向 13m + 上方 11m（蛋面对相机的反方向走，即蛋朝相机前方走）
        const outRadius = 13, outHeight = 11;
        const outX = p.x - fwdX * outRadius;
        const outY = p.y + outHeight;
        const outZ = p.z - fwdZ * outRadius;
        const outLX = p.x, outLY = p.y + 0.4, outLZ = p.z;

        // FPS：相机在蛋眼睛位置（沿 lookDir 前方 0.8m + 上 0.33m，避开描边壳）
        const fpsX = p.x + fwdX * 0.8;
        const fpsY = p.y + 0.33;
        const fpsZ = p.z + fwdZ * 0.8;
        // 朝相机 yaw + pitch 看 10m 远
        const cp = Math.cos(pitch);
        const lookFx = Math.sin(yaw) * cp;
        const lookFy = Math.sin(pitch);
        const lookFz = -Math.cos(yaw) * cp;
        const fpsLX = fpsX + lookFx * 10;
        const fpsLY = fpsY + lookFy * 10;
        const fpsLZ = fpsZ + lookFz * 10;

        const t = this._fpsT;
        this.camera.position.set(
            outX * (1 - t) + fpsX * t,
            outY * (1 - t) + fpsY * t,
            outZ * (1 - t) + fpsZ * t
        );
        this._tmpLook.set(
            outLX * (1 - t) + fpsLX * t,
            outLY * (1 - t) + fpsLY * t,
            outLZ * (1 - t) + fpsLZ * t
        );
        this.camera.lookAt(this._tmpLook);
    }

    _triggerDeath() {
        if (this.dying) return;
        this.dying = true;
        this._playDeath();
        if (this.statusEl) {
            this.statusEl.innerHTML = `哎呀！踩到红刺了<br><small style="font-size:18px">按 空格 再来一次</small>`;
            this.statusEl.style.display = 'block';
        }
    }

    _restart() {
        // 简单粗暴：销毁后让外层重新创建
        if (this.onRestart) this.onRestart();
    }

    destroy() {
        this._destroyed = true;
        cancelAnimationFrame(this.animId);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('pointerlockchange', this._onPointerLockChange);
        document.removeEventListener('mousemove', this._onMouseMove);
        if (document.pointerLockElement) document.exitPointerLock?.();
        // 清掉自建的 DOM 浮层 + 待触发定时器，避免重开后叠屏 / 野回调访问已销毁实例
        [this._questChip, this._feelChip, this._tintEl, this._easterEl, this._dmgOverlay, this._winEl, this._touchUI]
            .forEach(el => el && el.remove());
        [this._easterTimer, this._feelTimer].forEach(t => clearTimeout(t));
        this.scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        this.renderer.dispose();
        if (this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        if (this.statusEl) this.statusEl.style.display = 'none';
        if (this.hintEl) this.hintEl.style.display = 'none';
    }
}

function approach(current, target, maxStep) {
    if (current < target) return Math.min(target, current + maxStep);
    if (current > target) return Math.max(target, current - maxStep);
    return current;
}

function sphereVsAABB(p, r, min, max) {
    const cx = Math.max(min.x, Math.min(p.x, max.x));
    const cy = Math.max(min.y, Math.min(p.y, max.y));
    const cz = Math.max(min.z, Math.min(p.z, max.z));
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return null;
    let dist = Math.sqrt(d2);
    if (dist < 1e-5) {
        // 球心正好在 AABB 内：找最近边推出（沿 Y 上推）
        return { nx: 0, ny: 1, nz: 0, depth: r };
    }
    return {
        nx: dx / dist,
        ny: dy / dist,
        nz: dz / dist,
        depth: r - dist,
    };
}

function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
}
