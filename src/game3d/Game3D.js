import * as THREE from 'three';
import { loadStyle, hexToInt } from './style';

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

        this.clock = new THREE.Clock();
        this._tick = this._tick.bind(this);
        this.animId = requestAnimationFrame(this._tick);
    }

    _initThree() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#bde0ff');
        this.scene.fog = new THREE.Fog('#bde0ff', 35, 100);

        this.camera = new THREE.PerspectiveCamera(
            72, window.innerWidth / window.innerHeight, 0.1, 200
        );
        this.cameraTarget = new THREE.Vector3();
        this.velocity = { x: 0, z: 0 };

        // 软环境光
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        // 主光（暖太阳，投影）
        const sun = new THREE.DirectionalLight(0xfff1d4, 0.95);
        sun.position.set(22, 32, 18);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const s = 55;
        sun.shadow.camera.left = -s;
        sun.shadow.camera.right = s;
        sun.shadow.camera.top = s;
        sun.shadow.camera.bottom = -s;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 120;
        sun.shadow.bias = -0.0005;
        this.scene.add(sun);
        // 反光（蓝天→草地）
        this.scene.add(new THREE.HemisphereLight(0xbde0ff, 0x5a8a3a, 0.35));
    }

    _buildWorld() {
        // 大地面
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(220, 220),
            new THREE.MeshLambertMaterial({ color: 0x8fcf8f })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // 中央广场（暖沙色）
        const plaza = new THREE.Mesh(
            new THREE.CircleGeometry(5, 32),
            new THREE.MeshLambertMaterial({ color: 0xffe4b5 })
        );
        plaza.rotation.x = -Math.PI / 2;
        plaza.position.y = 0.02;
        plaza.receiveShadow = true;
        this.scene.add(plaza);

        // 三条放射状的路（淡草色与地面区分）
        const pathMat = new THREE.MeshLambertMaterial({ color: 0xc9ecb0 });
        const paths = [
            { sx: 6, sz: 48, x: 0, z: -28 },   // 北
            { sx: 48, sz: 6, x: 28, z: 0 },    // 东
            { sx: 48, sz: 6, x: -28, z: 0 },   // 西
        ];
        paths.forEach(p => {
            const path = new THREE.Mesh(new THREE.PlaneGeometry(p.sx, p.sz), pathMat);
            path.rotation.x = -Math.PI / 2;
            path.position.set(p.x, 0.015, p.z);
            path.receiveShadow = true;
            this.scene.add(path);
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
    }

    _addSignpost(x, z, label) {
        // 用 canvas 文字贴图（Three 文字一般不内建，用 Sprite + canvas 最省事）
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 96;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 256, 96);
        ctx.strokeStyle = '#ff3a78';
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, 250, 90);
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 128, 48);
        const tex = new THREE.CanvasTexture(canvas);
        const sprMat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(sprMat);
        sprite.scale.set(3.2, 1.2, 1);
        sprite.position.set(x, 2.5, z);
        this.scene.add(sprite);

        // 木杆
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8),
            new THREE.MeshLambertMaterial({ color: 0x8a5a2e })
        );
        pole.position.set(x, 1.25, z);
        pole.castShadow = true;
        this.scene.add(pole);
    }

    _addDistantHills() {
        const hillMat = new THREE.MeshLambertMaterial({ color: 0x9d8acc });
        const hillMatFar = new THREE.MeshLambertMaterial({ color: 0xbaa6db });
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
        const mat = new THREE.MeshLambertMaterial({ color: 0x808080 });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
        mesh.position.set(x, sy / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.obstacles.push({
            min: new THREE.Vector3(x - sx / 2, 0, z - sz / 2),
            max: new THREE.Vector3(x + sx / 2, sy, z + sz / 2),
        });
    }

    _createSpikeCluster(cx, cz, sizeX, sizeZ) {
        const spikeMat = new THREE.MeshLambertMaterial({ color: 0xd63031 });
        const baseMat = new THREE.MeshLambertMaterial({ color: 0x4a0e0e });
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
        const mat = new THREE.MeshLambertMaterial({
            color: colorHex,
            emissive: colorHex,
            emissiveIntensity: 0.35,
        });
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.95), mat);
        star.position.y = 1.4;
        star.castShadow = true;
        group.add(star);

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(1.4, 2.0, 32),
            new THREE.MeshBasicMaterial({
                color: colorHex, transparent: true, opacity: 0.45, side: THREE.DoubleSide
            })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.03;
        group.add(ring);

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
            new THREE.MeshLambertMaterial({ color: bodyColor })
        );
        body.castShadow = true;
        this.animRoot.add(body);

        // ===== 眼睛（蛋脸上半）=====
        const eyeR = r * 0.22;
        const eyeWhiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const pupilMat = new THREE.MeshLambertMaterial({ color: eyeColor });
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
            const bowMat = new THREE.MeshLambertMaterial({ color: 0xff3a78 });
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
            const stemMat = new THREE.MeshLambertMaterial({ color: 0x4a8a3a });
            const leafMat = new THREE.MeshLambertMaterial({ color: 0x86d96a });
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
            const crownMat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
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
                new THREE.MeshLambertMaterial({ color: 0xff3a78, emissive: 0x550022 })
            );
            gem.position.set(0, top - r * 0.02, -r * 0.55);
            this.animRoot.add(gem);
        }
    }

    _setupInput() {
        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            if (e.code === 'KeyC' && this.onOpenCustomize) {
                e.preventDefault();
                this.onOpenCustomize();
            }
            if ((this.won || this.dying) && e.code === 'Space') {
                e.preventDefault();
                this._restart();
            }
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
            this.hintEl.textContent = 'WASD / 方向键移动 · 空格跳 · C 换造型';
        }
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
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
        this._updateCamera();

        this.renderer.render(this.scene, this.camera);
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

        // 落地后短暂压扁（impact 从 1 衰减到 0）
        if (this._wasInAir && this.onGround) {
            this._landImpact = 1;
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

    _updateCamera() {
        // 关键反晕：相机刚性跟随，不再 lerp 漂移（眼睛不再"追"画面）
        const p = this.player.position;
        this.camera.position.set(p.x, p.y + 11, p.z + 13);
        this.camera.lookAt(p.x, p.y + 0.4, p.z);
    }

    _triggerWin(goal) {
        this.won = true;
        if (this.statusEl) {
            this.statusEl.innerHTML = `🎉 你到达「${goal.name}」啦！<br><small style="font-size:18px">按 空格 再玩一次 · 按 C 换造型</small>`;
            this.statusEl.style.display = 'block';
        }
    }

    _triggerDeath() {
        if (this.dying) return;
        this.dying = true;
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
