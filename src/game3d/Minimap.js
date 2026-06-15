// 独立小地图：自建 DOM + 自跑 rAF 循环，只读 window.__game，完全不耦合 Game3D.js。
// 这样在 Game3D.js 被并行编辑时也能安全添加/调试。

const SIZE = 158;            // 屏幕上的像素直径
const WORLD_R = 58;          // 显示玩家周围多少米半径
const SNOW_Z = -58;          // 雪区边界（world z < 此值）

export class Minimap {
    constructor() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cv = document.createElement('canvas');
        cv.width = SIZE * dpr;
        cv.height = SIZE * dpr;
        Object.assign(cv.style, {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            width: SIZE + 'px',
            height: SIZE + 'px',
            zIndex: '40',
            pointerEvents: 'none',
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.4))',
        });
        document.body.appendChild(cv);
        this.cv = cv;
        this.ctx = cv.getContext('2d');
        this.dpr = dpr;
        this.scale = (SIZE / 2 - 6) / WORLD_R;   // 世界米 → 画布像素
        this._loop = this._loop.bind(this);
        requestAnimationFrame(this._loop);
    }

    _loop() {
        try { this._draw(); } catch (e) { /* 游戏切换/重建时容错 */ }
        requestAnimationFrame(this._loop);
    }

    _draw() {
        const g = window.__game;
        const ctx = this.ctx;
        // 捏脸界面 / 游戏未建：隐藏
        const overlay = document.getElementById('customize-overlay');
        const onCustomize = overlay && overlay.style.display !== 'none';
        if (!g || !g.player || onCustomize) { this.cv.style.display = 'none'; return; }
        this.cv.style.display = 'block';

        const dpr = this.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);

        const cx = SIZE / 2, cy = SIZE / 2;
        const R = SIZE / 2 - 6;
        const s = this.scale;
        const px = g.player.position.x, pz = g.player.position.z;

        // 世界坐标 → 地图坐标（北 = -z = 上）
        const mapX = (wx) => cx + (wx - px) * s;
        const mapY = (wz) => cy + (wz - pz) * s;

        // ===== 圆形裁剪 =====
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();

        // 草地底
        ctx.fillStyle = '#5e9e54';
        ctx.fillRect(0, 0, SIZE, SIZE);

        // 雪区（world z < SNOW_Z 的那一片 → 地图上方）
        const snowY = mapY(SNOW_Z);
        if (snowY > 0) {
            ctx.fillStyle = '#e8eef6';
            ctx.fillRect(0, 0, SIZE, Math.min(SIZE, snowY));
            // 过渡边
            ctx.fillStyle = 'rgba(200,214,232,0.6)';
            ctx.fillRect(0, snowY - 2, SIZE, 4);
        }

        // 湖（蓝点）
        if (g.lake && g.lake.position) {
            const lx = mapX(g.lake.position.x), ly = mapY(g.lake.position.z);
            ctx.fillStyle = '#5aa6d8';
            ctx.beginPath(); ctx.arc(lx, ly, 8 * s, 0, Math.PI * 2); ctx.fill();
        }
        // 冰湖（雪区里的浅青点）—— 固定在 (-30,-90)
        {
            const ix = mapX(-30), iy = mapY(-90);
            ctx.fillStyle = '#aad6ea';
            ctx.beginPath(); ctx.arc(ix, iy, 7 * s, 0, Math.PI * 2); ctx.fill();
        }

        // 中央广场（原点）暖色小环，帮助找"家"
        {
            const ox = mapX(0), oy = mapY(0);
            ctx.strokeStyle = 'rgba(255,228,170,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(ox, oy, 5 * s, 0, Math.PI * 2); ctx.stroke();
        }

        const t = performance.now() * 0.001;

        // ===== 宝箱 =====
        if (g.chests) {
            for (const c of g.chests) {
                if (c.state !== 'closed') continue;       // 已开/刷新中不显示
                if (c.golden) {
                    this._blipOrEdge(ctx, cx, cy, R, mapX(c.x), mapY(c.z), () => {
                        ctx.fillStyle = '#ffd23a';
                        ctx.shadowColor = '#ffcf40'; ctx.shadowBlur = 6;
                        ctx.beginPath(); ctx.arc(0, 0, 4 + Math.sin(t * 5) * 0.8, 0, Math.PI * 2); ctx.fill();
                        ctx.shadowBlur = 0;
                    });
                } else {
                    // 普通箱（咬人箱外观一致，不在地图泄密）
                    const bx = mapX(c.x), by = mapY(c.z);
                    if (Math.hypot(bx - cx, by - cy) <= R) {
                        ctx.fillStyle = '#b9863f';
                        ctx.fillRect(bx - 2.2, by - 2.2, 4.4, 4.4);
                    }
                }
            }
        }

        // ===== 撤离点（始终醒目：虚线指引 + 实心徽标 + 越界箭头）=====
        if (g.extractCenter) {
            const open = g.extractPhase === 'open';
            let tx = mapX(g.extractCenter.x), ty = mapY(g.extractCenter.z);
            const dx = tx - cx, dy = ty - cy;
            const dist = Math.hypot(dx, dy) || 1;
            const rimR = R - 10;
            const outOfRange = dist > rimR;
            const ux = dx / dist, uy = dy / dist;   // 指向撤离点的单位向量

            // 1) 从玩家拉一条虚线指过去（"往这边走"）
            ctx.save();
            ctx.strokeStyle = open ? 'rgba(176,124,255,0.9)' : 'rgba(176,124,255,0.5)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.lineDashOffset = -t * 12;   // 流动感，更像"路线"
            const lead = Math.min(dist, rimR);
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ux * lead, cy + uy * lead); ctx.stroke();
            ctx.restore();

            // 2) 徽标位置：在范围内就画在原处，越界则贴到圆环边缘
            if (outOfRange) { tx = cx + ux * rimR; ty = cy + uy * rimR; }
            const pulse = open ? (1 + Math.sin(t * 6) * 0.25) : 1;
            // 底色实心圆（魔法阵：紫色，在绿地上也跳出来）
            ctx.fillStyle = open ? '#8a4fd0' : '#3a2d50';
            ctx.strokeStyle = open ? '#e0c4ff' : '#b9a0d8';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(tx, ty, 7 * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // 魔法符号
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('✦', tx, ty + 0.5);
            // 开启时外圈脉动光环
            if (open) {
                ctx.strokeStyle = `rgba(176,124,255,${0.6 - 0.4 * Math.sin(t * 6)})`;
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(tx, ty, 11 + Math.sin(t * 6) * 2, 0, Math.PI * 2); ctx.stroke();
            }
            // 越界时在徽标外侧加个小箭头，强调方向
            if (outOfRange) {
                ctx.save();
                ctx.translate(tx + ux * 9, ty + uy * 9);
                ctx.rotate(Math.atan2(uy, ux));
                ctx.fillStyle = open ? '#b07cff' : '#b9a0d8';
                ctx.beginPath();
                ctx.moveTo(4, 0); ctx.lineTo(-3, 3); ctx.lineTo(-3, -3); ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
        }

        // ===== 怪物 =====
        if (g.monsters) {
            const col = { normal: '#b066e0', fast: '#ff6488', tank: '#5fbf52', mimic: '#c98a3a' };
            for (const m of g.monsters) {
                if (m.state !== 'alive') continue;
                const mx = mapX(m.group.position.x), my = mapY(m.group.position.z);
                if (Math.hypot(mx - cx, my - cy) > R) continue;
                const rad = m.type === 'tank' ? 3.6 : (m.type === 'fast' ? 2.4 : 3);
                ctx.fillStyle = col[m.type] || '#c0392b';
                ctx.beginPath(); ctx.arc(mx, my, rad, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
            }
        }

        // ===== 玩家（中心三角，朝向 = cameraYaw）=====
        {
            const yaw = g.cameraYaw || 0;
            const fx = Math.sin(yaw), fy = -Math.cos(yaw);   // 地图上的前方向量
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(Math.atan2(fx, -fy));   // 让三角尖朝 (fx,fy)
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(0, -6.5);
            ctx.lineTo(4.5, 5);
            ctx.lineTo(0, 2.5);
            ctx.lineTo(-4.5, 5);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.restore();
        }

        ctx.restore(); // 解除圆裁剪

        // ===== 外环 + 指北 =====
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc(cx, 7, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff6b6b';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('N', cx, 8);
    }

    // 在地图内就正常画；超出范围就贴到圆环边缘（重要目标始终指向，撤离点/金箱用）
    _blipOrEdge(ctx, cx, cy, R, mx, my, drawFn) {
        const dx = mx - cx, dy = my - cy;
        const dist = Math.hypot(dx, dy);
        ctx.save();
        if (dist <= R - 4) {
            ctx.translate(mx, my);
        } else {
            const k = (R - 6) / (dist || 1);
            ctx.translate(cx + dx * k, cy + dy * k);
        }
        drawFn();
        ctx.restore();
    }
}
