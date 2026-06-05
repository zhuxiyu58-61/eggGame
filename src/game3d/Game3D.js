import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { loadStyle, hexToInt } from './style';

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
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8fcf8f';
    ctx.fillRect(0, 0, 256, 256);
    // 深绿斑块
    ctx.fillStyle = '#6cb56c';
    for (let i = 0; i < 90; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const r = 3 + Math.random() * 9;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 亮绿点
    ctx.fillStyle = '#aae5aa';
    for (let i = 0; i < 70; i++) {
        const x = Math.random() * 256, y = Math.random() * 256;
        const r = 2 + Math.random() * 4;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 野花碎点（黄/白/粉）
    const flowerColors = ['#ffd966', '#ffffff', '#ffb6c1'];
    for (let i = 0; i < 50; i++) {
        ctx.fillStyle = flowerColors[i % 3];
        const x = Math.random() * 256, y = Math.random() * 256;
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(22, 22);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function makeSkyGradientTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0,    '#5fb3e5'); // 天顶深蓝
    grad.addColorStop(0.45, '#a3d7ee'); // 高空浅蓝
    grad.addColorStop(0.55, '#d8ecf5'); // 地平线雾色
    grad.addColorStop(0.7,  '#ffd9c2'); // 远天暖
    grad.addColorStop(1,    '#ffb997'); // 视线下方（地面挡住看不到）
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
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
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(12, 18, 360, 72, 18); ctx.fill();
    } else {
        ctx.fillRect(12, 18, 360, 72);
    }
    // 白底
    ctx.fillStyle = '#ffffff';
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(8, 14, 360, 68, 18); ctx.fill();
    } else {
        ctx.fillRect(8, 14, 360, 68);
    }
    // 边框
    ctx.strokeStyle = '#2c2c54';
    ctx.lineWidth = 3;
    if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(8, 14, 360, 68, 18); ctx.stroke();
    } else {
        ctx.strokeRect(8, 14, 360, 68);
    }
    // 气泡小尖（下边中间）
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(178, 82);
    ctx.lineTo(192, 102);
    ctx.lineTo(206, 82);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(178, 82);
    ctx.lineTo(192, 102);
    ctx.lineTo(206, 82);
    ctx.stroke();
    // 文字
    ctx.fillStyle = '#2c2c54';
    ctx.font = 'bold 26px "Microsoft YaHei", sans-serif';
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

        this._initThree();
        this._buildWorld();
        this._buildPlayer();
        this._setupInput();
        this._setupStatusUI();

        this._onResize = this._onResize.bind(this);
        window.addEventListener('resize', this._onResize);

        // 关键：预编译所有 shader + 上传所有 texture，消除首次走动时的编译卡顿
        this._warmup();

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

        // 2) 多帧渲染（每帧轻微转一下相机角度，让 frustum 覆盖到更多东西）
        const origPos = this.camera.position.clone();
        const origRot = this.camera.rotation.clone();
        for (let i = 0; i < 4; i++) {
            this.camera.position.set(20 - i * 13, 12, 13 + i * 7);
            this.camera.lookAt(0, 0, 0);
            this.renderer.compile(this.scene, this.camera);
            try {
                if (this.composer) this.composer.render();
                else this.renderer.render(this.scene, this.camera);
            } catch (e) {}
        }
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
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = makeSkyGradientTexture(); // 渐变天空（天顶蓝→地平线暖）
        this.scene.fog = new THREE.Fog('#d8ecf5', 40, 110);

        this.camera = new THREE.PerspectiveCamera(
            72, window.innerWidth / window.innerHeight, 0.1, 200
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
        this.sun.shadow.mapSize.set(2048, 2048);
        const s = 55;
        this.sun.shadow.camera.left = -s;
        this.sun.shadow.camera.right = s;
        this.sun.shadow.camera.top = s;
        this.sun.shadow.camera.bottom = -s;
        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 120;
        this.sun.shadow.bias = -0.0005;
        this.scene.add(this.sun);
        // 反光（蓝天→草地）
        this.hemi = new THREE.HemisphereLight(0xbde0ff, 0x5a8a3a, 0.35);
        this.scene.add(this.hemi);

        // 昼夜循环状态
        this.dayPhase = 0.35;     // 开局时间：上午（0=半夜，0.25=日出，0.5=正午，0.75=日落）
        this.dayDuration = 90;    // 90 秒一个完整白天-黑夜循环
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
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.85,  // strength
            0.5,   // radius
            0.72   // threshold（只让"亮过 0.72"的像素晕染）
        );
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(new OutputPass());
    }

    _buildWorld() {
        // 大地面：草地噪声纹理 + 重复 22 次
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(220, 220),
            new THREE.MeshToonMaterial({ map: makeGrassTexture() })
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

        // 路口指示牌
        this._addSignpost(0, -7, '北 · 红刺密林');
        this._addSignpost(7, 0, '东 · 跳跳台阶');
        this._addSignpost(-7, 0, '西 · 混合冒险');

        // 障碍/倒刺布局
        // 北：纯红刺挑战
        this._createSpikeCluster(0, -13, 1, 3);
        this._createSpikeCluster(0, -22, 2, 3);
        this._createSpikeCluster(0, -32, 1, 4);
        // 东：跳跳台阶
        this._createBlock(13, 0, 2, 1.0, 2);
        this._createBlock(20, 0, 2, 1.6, 2);
        this._createBlock(28, 0, 2, 1.0, 2);
        this._createSpikeCluster(35, 0, 1, 3);
        // 西：混合
        this._createBlock(-14, 0, 2, 1.2, 2);
        this._createSpikeCluster(-21, 0, 2, 2);
        this._createBlock(-30, 0, 2, 1.6, 2);

        // 三个终点（不同颜色）
        this._createGoal(0, -42, 0xffd700, '北方金星');
        this._createGoal(42, 0, 0xff66cc, '东方粉星');
        this._createGoal(-42, 0, 0x66ddff, '西方蓝星');

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

        // 通关标记应用到已完成的路 + 全通后解锁伙伴
        this._applyWonGoals();
        this._maybeSpawnCompanion();
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
        cfgs.forEach(c => this._addHouse(c.x, c.z, c.body, c.roof, c.sign));
        this._buildVillageHall();
    }

    _addHouse(x, z, bodyColor, roofColor, signText) {
        const group = new THREE.Group();
        const W = 5.5, H = 4.5, D = 5.5;
        const wallT = 0.22;
        const doorW = 1.7, doorH = 2.7;
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

        // 门头招牌
        if (signText) {
            const signTex = makeSignTexture(signText);
            const sign = new THREE.Sprite(new THREE.SpriteMaterial({
                map: signTex, depthWrite: false,
            }));
            sign.scale.set(2.0, 0.7, 1);
            sign.position.set(0, doorH + 0.55, D / 2 + 0.12);
            group.add(sign);
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

        // 室内暖灯（夜里营造"家的灯火"）
        const lamp = new THREE.PointLight(0xffd599, 1.1, 9, 1.5);
        lamp.position.set(0, H - 1.0, 0);
        group.add(lamp);

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
            min: new THREE.Vector3(x - W/2 + wallT, 0, z - D/2 + wallT),
            max: new THREE.Vector3(x + W/2 - wallT, H, z + D/2 - wallT),
            fadeables,
            currentOpacity: 1,
        });
    }

    _updateHouseTransparency(dt) {
        if (!this.houses) return;
        const p = this.player.position;
        for (const h of this.houses) {
            const inside =
                p.x > h.min.x && p.x < h.max.x &&
                p.z > h.min.z && p.z < h.max.z;
            // 进门/出门音效
            if (inside !== h.wasInside) {
                this._playChime();
                h.wasInside = inside;
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
    }

    _playChime() {
        this._tone(660, 0.2, 'sine', 0.05);
        this._tone(880, 0.25, 'sine', 0.04, 0.1);
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
        // 烟囱位置（house cfg 已知）+ 村屋有自己一个
        this.chimneyPoses = [
            { x: -42 + 5.5 * 0.28, y: 4.5 + 1.4, z: -28 + -5.5 * 0.22 },
            { x:  50 + 5.5 * 0.28, y: 4.5 + 1.4, z:  20 + -5.5 * 0.22 },
            { x: -55 + 5.5 * 0.28, y: 4.5 + 1.4, z:  35 + -5.5 * 0.22 },
            { x:  35 + 5.5 * 0.28, y: 4.5 + 1.4, z: -52 + -5.5 * 0.22 },
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
        this.starsCollected = 0;
        const inPath = (x, z) => {
            if (Math.hypot(x, z) < 7) return false;  // 让广场也能撒
            // 避开房子和障碍区域
            return Math.abs(x) > 3 || Math.abs(z) > 3;
        };
        for (let i = 0; i < 24; i++) {
            const x = (Math.random() - 0.5) * 100;
            const z = (Math.random() - 0.5) * 100;
            // 注：碰撞简单避一下中心区
            this._addCollectStar(x, z);
        }
        this._starsChip = document.getElementById('game-stars');
        if (this._starsChip) this._starsChip.textContent = '⭐ 0 / 24';
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
                }
            }
        }
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
            { x: -42, z: -28, W: 5.5, D: 5.5, H: 4.5 },
            { x:  50, z:  20, W: 5.5, D: 5.5, H: 4.5 },
            { x: -55, z:  35, W: 5.5, D: 5.5, H: 4.5 },
            { x:  35, z: -52, W: 5.5, D: 5.5, H: 4.5 },
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
            }
        }
    }

    _buildSnowBiome() {
        // 北金星后面 (z < -60) 进入雪地，白色地+白顶松+冰湖+冰屋
        const snowGround = new THREE.Mesh(
            new THREE.PlaneGeometry(160, 60),
            new THREE.MeshToonMaterial({ color: 0xf0f4f8 })
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

        // 冰湖（半径 7 的椭圆）
        const icePond = new THREE.Mesh(
            new THREE.CircleGeometry(7, 32),
            new THREE.MeshStandardMaterial({
                color: 0xb8e0f0, metalness: 0.3, roughness: 0.1,
                transparent: true, opacity: 0.85,
            })
        );
        icePond.rotation.x = -Math.PI / 2;
        icePond.position.set(-30, 0.06, -90);
        this.scene.add(icePond);
        const iceRim = new THREE.Mesh(
            new THREE.RingGeometry(7, 7.6, 32),
            new THREE.MeshToonMaterial({ color: 0xa0c0d0 })
        );
        iceRim.rotation.x = -Math.PI / 2;
        iceRim.position.set(-30, 0.05, -90);
        this.scene.add(iceRim);

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
        // 3 层圆锥（深绿+白顶）
        const greenMat = new THREE.MeshToonMaterial({ color: 0x2a6a3a });
        const snowMat = new THREE.MeshToonMaterial({ color: 0xffffff });
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
            // 雪盖：略薄一层在锥体上方
            const snowCap = new THREE.Mesh(
                new THREE.ConeGeometry(r * 0.45, h * 0.35, 10),
                snowMat
            );
            snowCap.position.y = y + h * 0.85;
            group.add(snowCap);
            y += h * 0.8;
        }
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        group.scale.setScalar(0.9 + Math.random() * 0.4);
        this.scene.add(group);
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
        }
        if (!inLake && this.swimming) {
            this.swimming = false;
            // 上岸恢复颜色
            if (this.bodyMesh && !this._bodyColorWasWet) {
                this.bodyMesh.material.color.setHex(this._bodyColorDry);
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
        this._meteorTimer = 12 + Math.random() * 10;
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
                if (m.trail) {
                    this.scene.remove(m.trail);
                    m.trail.geometry.dispose(); m.trail.material.dispose();
                }
                return false;
            }
            m.head.position.x += m.vx * dt;
            m.head.position.y += m.vy * dt;
            m.head.position.z += m.vz * dt;
            // 拉尾巴朝运动方向
            if (m.trail) {
                m.trail.position.copy(m.head.position);
                m.trail.lookAt(
                    m.head.position.x - m.vx,
                    m.head.position.y - m.vy,
                    m.head.position.z - m.vz
                );
            }
            const k = 1 - m.life / m.full;
            m.head.material.opacity = 1 - k;
            if (m.trail) m.trail.material.opacity = (1 - k) * 0.6;
            return true;
        });
    }

    _spawnMeteor() {
        const startAng = Math.random() * Math.PI * 2;
        const r = 80;
        const startX = Math.cos(startAng) * r;
        const startZ = Math.sin(startAng) * r;
        const dirAng = startAng + Math.PI + (Math.random() - 0.5) * 0.4;
        const speed = 30 + Math.random() * 10;
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 12, 10),
            new THREE.MeshStandardMaterial({
                color: 0xfff5a0, emissive: 0xfff099, emissiveIntensity: 3,
                transparent: true, opacity: 1,
            })
        );
        head.position.set(startX, 32 + Math.random() * 8, startZ);
        this.scene.add(head);
        // 尾迹（细长圆柱）
        const trail = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.3, 6.0, 8),
            new THREE.MeshBasicMaterial({
                color: 0xfff099, transparent: true, opacity: 0.6,
            })
        );
        trail.position.copy(head.position);
        this.scene.add(trail);
        this.shootingStars.push({
            head, trail,
            vx: Math.cos(dirAng) * speed,
            vy: -8 - Math.random() * 4,
            vz: Math.sin(dirAng) * speed,
            life: 2.0, full: 2.0,
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

    // ========= 浇花 =========
    _initWatering() {
        this.wateringDrops = [];
        this._wateringCooldown = 0;
    }

    _doWatering() {
        if (this._wateringCooldown > 0) return;
        this._wateringCooldown = 0.5;
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
        this._applySeason();
    }

    _applySeason() {
        const s = this.seasons[this.seasonIdx];
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
        this._launchFirework();   // 季节切换烟花
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
        }
    }

    _showEasterBadge(text) {
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
        const ceilingLight = new THREE.PointLight(0xffd599, 1.6, 12, 1.4);
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
            min: new THREE.Vector3(x - W/2 + wallT, 0, z - D/2 + wallT),
            max: new THREE.Vector3(x + W/2 - wallT, H, z + D/2 - wallT),
            fadeables,
            currentOpacity: 1,
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

        // 湖边深色环（暗示岸）
        const rim = new THREE.Mesh(
            new THREE.RingGeometry(radius, radius + 0.5, 48),
            new THREE.MeshToonMaterial({ color: 0x2a4858 })
        );
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(x, 0.055, z);
        this.scene.add(rim);
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

    _maybeSpawnCompanion() {
        const won = this._loadWonGoals();
        if (won.length < this.goals.length) return;

        const tex = makeButterflyTexture('#ffe066');
        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
        });
        this.companion = new THREE.Sprite(mat);
        this.companion.scale.set(0.95, 0.95, 1);
        this.companion.position.copy(this.player.position);
        this.scene.add(this.companion);

        // 跟随的金色软光
        this.companionLight = new THREE.PointLight(0xffd966, 1.0, 5, 1.6);
        this.scene.add(this.companionLight);
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
        // 雨：浅蓝细长 Points，快下落
        const rainCount = 700;
        const rainPos = new Float32Array(rainCount * 3);
        for (let i = 0; i < rainCount; i++) {
            rainPos[i*3]   = (Math.random() - 0.5) * 90;
            rainPos[i*3+1] = Math.random() * 30;
            rainPos[i*3+2] = (Math.random() - 0.5) * 90;
        }
        const rainGeo = new THREE.BufferGeometry();
        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
        this.rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
            color: 0xa8d8f0, size: 0.25, transparent: true, opacity: 0.55,
            depthWrite: false, fog: true,
        }));
        this.rain.visible = false;
        this.scene.add(this.rain);

        // 雪：白色 Points，慢飘 + 横向漂
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
            color: 0xffffff, size: 0.35, transparent: true, opacity: 0.85,
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
        const fall = 28;
        for (let i = 0; i < pos.length; i += 3) {
            pos[i+1] -= fall * dt;
            if (pos[i+1] < 0) {
                pos[i]   = p.x + (Math.random() - 0.5) * 60;
                pos[i+1] = 22 + Math.random() * 8;
                pos[i+2] = p.z + (Math.random() - 0.5) * 60;
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

    _applyWonGoals() {
        const won = this._loadWonGoals();
        if (won.length === 0) return;
        // 把已通关的星调暗 + 对应路染金
        this.goals.forEach(g => {
            if (won.includes(g.name)) {
                g.star.material.emissiveIntensity = 0.4;
                g.star.material.color.setHex(0xeed694);
                g.won = true;
            }
        });
        Object.entries(this.paths || {}).forEach(([name, mesh]) => {
            if (won.includes(name)) {
                mesh.material.color.setHex(0xf5d36a);
            }
        });
    }

    _loadWonGoals() {
        try {
            return JSON.parse(localStorage.getItem('eggGameWonGoals') || '[]');
        } catch (e) { return []; }
    }

    _saveWonGoal(name) {
        const won = this._loadWonGoals();
        if (!won.includes(name)) {
            won.push(name);
            try { localStorage.setItem('eggGameWonGoals', JSON.stringify(won)); } catch (e) {}
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

    _addSignpost(x, z, label) {
        // 木牌：暖木色底（亮度低于 bloom 阈值，不发光）+ 粗黑字 + 深棕边框
        const canvas = document.createElement('canvas');
        canvas.width = 384; canvas.height = 144;
        const ctx = canvas.getContext('2d');
        // 木色底（高斯下采样减轻bloom）
        ctx.fillStyle = '#c89868';
        ctx.fillRect(0, 0, 384, 144);
        // 木纹斜线
        ctx.strokeStyle = '#a67a4a';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
            const y = 20 + i * 22;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(384, y + 4); ctx.stroke();
        }
        // 深棕边框（双层显厚）
        ctx.strokeStyle = '#5a3a1a';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 376, 136);
        // 字：粗黑 + 描白边提高对比
        ctx.font = 'bold 50px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.strokeText(label, 192, 76);
        ctx.fillStyle = '#1a1a2e';
        ctx.fillText(label, 192, 76);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprMat = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
        const sprite = new THREE.Sprite(sprMat);
        sprite.scale.set(3.6, 1.35, 1);
        sprite.position.set(x, 2.6, z);
        this.scene.add(sprite);

        // 木杆
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8),
            new THREE.MeshToonMaterial({ color: 0x8a5a2e })
        );
        pole.position.set(x, 1.3, z);
        pole.castShadow = true;
        addOutline(pole, 0.04);
        this.scene.add(pole);
    }

    _addDistantHills() {
        const hillMat = new THREE.MeshToonMaterial({ color: 0x9d8acc });
        const hillMatFar = new THREE.MeshToonMaterial({ color: 0xbaa6db });
        for (let i = 0; i < 14; i++) {
            const angle = (i / 14) * Math.PI * 2;
            const radius = 90 + Math.random() * 15;
            const size = 8 + Math.random() * 6;
            const hill = new THREE.Mesh(
                new THREE.SphereGeometry(size, 12, 8),
                Math.random() > 0.5 ? hillMat : hillMatFar
            );
            hill.position.set(
                Math.cos(angle) * radius,
                -size * 0.4,
                Math.sin(angle) * radius
            );
            this.scene.add(hill);
        }
    }

    _createBlock(x, z, sx, sy, sz) {
        const mat = new THREE.MeshToonMaterial({ color: 0x9aa0a8 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
        mesh.position.set(x, sy / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        addOutline(mesh);
        this.scene.add(mesh);
        this.obstacles.push({
            min: new THREE.Vector3(x - sx / 2, 0, z - sz / 2),
            max: new THREE.Vector3(x + sx / 2, sy, z + sz / 2),
        });
    }

    _createSpikeCluster(cx, cz, sizeX, sizeZ) {
        const spikeMat = new THREE.MeshToonMaterial({ color: 0xd63031 });
        const baseMat = new THREE.MeshToonMaterial({ color: 0x4a0e0e });
        const spacing = 1.0;
        const h = 1.0;
        const baseR = 0.38;

        for (let i = 0; i < sizeX; i++) {
            for (let j = 0; j < sizeZ; j++) {
                const x = cx + (i - (sizeX - 1) / 2) * spacing;
                const z = cz + (j - (sizeZ - 1) / 2) * spacing;
                // 底座小圆台
                const base = new THREE.Mesh(
                    new THREE.CylinderGeometry(baseR * 1.05, baseR * 1.05, 0.06, 12), baseMat
                );
                base.position.set(x, 0.03, z);
                this.scene.add(base);
                // 红刺锥
                const cone = new THREE.Mesh(
                    new THREE.ConeGeometry(baseR, h, 6), spikeMat
                );
                cone.position.set(x, h / 2 + 0.06, z);
                cone.castShadow = true;
                addOutline(cone, 0.08);
                this.scene.add(cone);
            }
        }
        // hitbox 比可视稍小，留容错
        const halfX = (sizeX - 1) * spacing / 2 + baseR * 0.7;
        const halfZ = (sizeZ - 1) * spacing / 2 + baseR * 0.7;
        this.spikes.push({
            min: new THREE.Vector3(cx - halfX, 0, cz - halfZ),
            max: new THREE.Vector3(cx + halfX, h * 0.8, cz + halfZ),
        });
    }

    _createGoal(x, z, colorHex, name) {
        const group = new THREE.Group();
        // 终点星：强发光，让 bloom 捕捉到
        const mat = new THREE.MeshStandardMaterial({
            color: colorHex,
            emissive: colorHex,
            emissiveIntensity: 1.8,
            roughness: 0.4,
            metalness: 0.2,
        });
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.95), mat);
        star.position.y = 1.4;
        star.castShadow = true;
        addOutline(star, 0.05);
        group.add(star);

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(1.4, 2.0, 32),
            new THREE.MeshBasicMaterial({
                color: colorHex, transparent: true, opacity: 0.55, side: THREE.DoubleSide
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        group.add(ring);

        // 地上一个发光光晕（同色，半透明）
        const glow = new THREE.PointLight(colorHex, 1.2, 8, 1.5);
        glow.position.y = 1.4;
        group.add(glow);

        group.position.set(x, 0, z);
        this.scene.add(group);
        this.goals.push({ x, z, name, star, group });
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
        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            this._ensureAudio();  // 首次按键解锁 AudioContext
            if (e.code === 'KeyC' && this.onOpenCustomize) {
                e.preventDefault();
                this.onOpenCustomize();
            }
            if ((this.won || this.dying) && e.code === 'Space') {
                e.preventDefault();
                this._restart();
            }
            // 到达终点后按 ESC 继续逛
            if (this.won && e.code === 'Escape') {
                e.preventDefault();
                this._dismissWin();
            }
            if (this.won && e.code === 'KeyR') {
                e.preventDefault();
                try { localStorage.removeItem('eggGameWonGoals'); } catch (err) {}
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
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
        };
        this._onKeyUp = (e) => { this.keys[e.code] = false; };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    _setupStatusUI() {
        this.statusEl = document.getElementById('game-status');
        if (this.statusEl) this.statusEl.style.display = 'none';
        this.hintEl = document.getElementById('game-hint');
        if (this.hintEl) {
            this.hintEl.style.display = 'block';
            this.hintEl.textContent = 'WASD 走 · 空格跳 · E 浇花 · F 钓鱼 · C 换造型 · 1/2/3/4 切时段';
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
            this._checkGoals();
        }
        this._updatePlayerAnimation(dt);
        this._updateGoals();
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
        this._updateLightning(dt);
        this._updateHouseTransparency(dt);
        this._checkBeds(dt);
        this._checkCandles(dt);
        this._updateSmoke(dt);
        this._updateFireflies(dt);
        this._updateBunnies(dt);
        this._updateRipples(dt);
        this._updateLampposts();
        this._updateCollectStars(dt);
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
        if (this._wateringCooldown > 0) this._wateringCooldown -= dt;
        if (!this.dying && !this.won) {
            this._checkHiddenFox();
            this._checkLighthouseNote();
        }
        // 风车撞飞冷却
        if (this._knockbackCooldown > 0) {
            this._knockbackCooldown -= dt;
            if (this._knockbackCooldown <= 0) this._knockbackCooldown = 0;
        }
        if (!this.dying && !this.won) this._checkWindmillKnockback();
        // 草地风偏移 shader uniform
        if (this.grass && this.grass.material.userData.shader) {
            this.grass.material.userData.shader.uniforms.uTime.value =
                performance.now() * 0.001;
        }
        if (!this.dying && !this.won) this._checkFlowerTouches(dt);
        this._updateCamera();

        this.composer.render();
        this.animId = requestAnimationFrame(this._tick);
    }

    _updatePlayer(dt) {
        // 计算目标方向
        let tx = 0, tz = 0;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) tz -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) tz += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) tx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) tx += 1;
        const mag = Math.hypot(tx, tz);
        if (mag > 0) { tx /= mag; tz /= mag; }

        // 朝目标速度平滑加/减速（不再瞬时启停）
        const targetVx = tx * MOVE_SPEED;
        const targetVz = tz * MOVE_SPEED;
        const step = (mag > 0 ? ACCEL : DECEL) * dt;
        this.velocity.x = approach(this.velocity.x, targetVx, step);
        this.velocity.z = approach(this.velocity.z, targetVz, step);

        this.player.position.x += this.velocity.x * dt;
        this.player.position.z += this.velocity.z * dt;

        // 朝向只在确实在动时跟，避免松键瞬间甩头
        const vmag = Math.hypot(this.velocity.x, this.velocity.z);
        if (vmag > 0.5) {
            const targetAngle = Math.atan2(this.velocity.x, -this.velocity.z);
            this.player.rotation.y = lerpAngle(this.player.rotation.y, targetAngle, 0.18);
        }

        if (this.keys['Space'] && this.onGround) {
            this.playerVy = JUMP_SPEED;
            this.onGround = false;
            this._playJump();
        }

        this.playerVy -= GRAVITY * dt;
        this.player.position.y += this.playerVy * dt;

        if (this.player.position.y <= PLAYER_RADIUS) {
            this.player.position.y = PLAYER_RADIUS;
            this.playerVy = 0;
            this.onGround = true;
        }
    }

    _resolveObstacleCollisions() {
        let landedOnTop = false;
        for (const obs of this.obstacles) {
            const hit = sphereVsAABB(this.player.position, PLAYER_RADIUS, obs.min, obs.max);
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

    _checkSpikes() {
        for (const spk of this.spikes) {
            if (sphereVsAABB(this.player.position, PLAYER_RADIUS, spk.min, spk.max)) {
                this._triggerDeath();
                return;
            }
        }
    }

    _checkGoals() {
        for (const goal of this.goals) {
            const dx = this.player.position.x - goal.x;
            const dz = this.player.position.z - goal.z;
            if (dx * dx + dz * dz < 2.5 * 2.5) {
                this._triggerWin(goal);
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

    _updateGoals() {
        const t = performance.now() * 0.001;
        this.goals.forEach((g, i) => {
            g.star.rotation.y = t * 1.5;
            g.star.position.y = 1.4 + Math.sin(t * 2 + i) * 0.18;
        });
    }

    _updateDayNight(dt) {
        this.dayPhase = (this.dayPhase + dt / this.dayDuration) % 1;
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

        // 曝光：白天 1.1，夜里 0.45
        this.renderer.toneMappingExposure = 0.45 + 0.7 * dayness;

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

        // 雾色随时间变（黄昏暖、夜里深蓝、白天淡蓝）
        if (sunHeight >= 0.25) {
            this.scene.fog.color.setHex(0xd8ecf5);
        } else if (sunHeight >= -0.05) {
            // 日出/日落
            this.scene.fog.color.setHex(0xeec0a0);
        } else {
            this.scene.fog.color.setHex(0x2a3556);
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
        // 关键反晕：相机刚性跟随，不再 lerp 漂移（眼睛不再"追"画面）
        const p = this.player.position;
        this.camera.position.set(p.x, p.y + 11, p.z + 13);
        this.camera.lookAt(p.x, p.y + 0.4, p.z);
    }

    _triggerWin(goal) {
        if (goal.triggeredThisRun) return;  // 同一 session 内不再重复触发
        goal.triggeredThisRun = true;
        this.won = true;
        this._saveWonGoal(goal.name);
        this._playWin();
        // 星暗化，提示"已通过"
        goal.star.material.emissiveIntensity = 0.4;
        goal.star.material.color.setHex(0xeed694);
        const allWon = this._loadWonGoals();
        const totalGoals = this.goals.length;
        const allCleared = allWon.length >= totalGoals;
        if (this.statusEl) {
            const extra = allCleared
                ? '<br><small style="font-size:16px;color:#888">三方全通！按 R 重置探险记录</small>'
                : `<br><small style="font-size:16px;color:#888">已通 ${allWon.length}/${totalGoals}</small>`;
            this.statusEl.innerHTML = `🎉 你到达「${goal.name}」啦！${extra}<br><small style="font-size:18px">ESC 继续逛 · 空格 重玩 · C 换造型</small>`;
            this.statusEl.style.display = 'block';
        }
    }

    _dismissWin() {
        this.won = false;
        if (this.statusEl) this.statusEl.style.display = 'none';
        // 星已经标了 triggeredThisRun，不会再弹
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
        cancelAnimationFrame(this.animId);
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('resize', this._onResize);
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
