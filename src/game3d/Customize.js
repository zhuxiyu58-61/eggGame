import {
    HAIR_COLOR_OPTIONS,
    HAIR_STYLE_OPTIONS,
    DRESS_COLOR_OPTIONS,
    SKIN_OPTIONS,
    HEADWEAR_OPTIONS,
    loadStyle,
    saveStyle,
} from './style';

export class Customize {
    constructor(container, onStart) {
        this.container = container;
        this.onStart = onStart;
        this.style = loadStyle();
        this.resumeInfo = this._getResumeInfo();
        this._render();
    }

    _getResumeInfo() {
        try {
            const save = JSON.parse(localStorage.getItem('eggGameSaveV1')) || null;
            const progress = JSON.parse(localStorage.getItem('eggGameProgress')) || {};
            const achievements = JSON.parse(localStorage.getItem('eggGameAchievements')) || [];
            const inventory = JSON.parse(localStorage.getItem('eggGameInventory')) || [];
            const hasProgress = !!save || (progress.stars || 0) > 0 || (progress.quest || []).length > 0 || achievements.length > 0 || inventory.length > 0;
            if (!hasProgress) return null;
            return {
                savedAt: save?.savedAt || null,
                stars: progress.stars || 0,
                quests: (progress.quest || []).length,
                achievements: achievements.length,
            };
        } catch (e) { return null; }
    }

    _render() {
        this.container.innerHTML = `
            <div class="customize-panel">
                <h1>装扮小女孩 · 选你喜欢的样子</h1>
                <div class="preview-wrap">
                    <canvas id="preview-canvas" width="180" height="240"></canvas>
                    <div class="preview-shadow"></div>
                </div>
                <div class="row">
                    <label>发型</label>
                    <div class="options" id="hairstyle-options"></div>
                </div>
                <div class="row">
                    <label>发色</label>
                    <div class="options" id="haircolor-options"></div>
                </div>
                <div class="row">
                    <label>裙子颜色</label>
                    <div class="options" id="dress-options"></div>
                </div>
                <div class="row">
                    <label>肤色</label>
                    <div class="options" id="skin-options"></div>
                </div>
                <div class="row">
                    <label>头饰</label>
                    <div class="options" id="headwear-options"></div>
                </div>
                ${this.resumeInfo ? `
                  <div style="margin:10px 0;padding:10px 14px;border-radius:14px;background:rgba(80,170,100,.14);color:#39734a;font-size:14px">
                    💾 已找到上次存档 &middot; ⭐ ${this.resumeInfo.stars} &middot; 🏅 ${this.resumeInfo.achievements} &middot; 🗺️ ${this.resumeInfo.quests}
                  </div>
                  <button class="start-btn" id="continue-btn" style="background:linear-gradient(90deg,#53b96d,#8bd35e);margin-bottom:8px">继续上次冒险 ▶</button>
                ` : ''}
                <button class="start-btn" id="start-btn">${this.resumeInfo ? '保存装扮并继续' : '开始 3D 冒险 ▶'}</button>
            </div>
        `;

        this._buildLabelRow('hairstyle-options', HAIR_STYLE_OPTIONS, 'hairStyle');
        this._buildColorRow('haircolor-options', HAIR_COLOR_OPTIONS, 'hairColor');
        this._buildColorRow('dress-options', DRESS_COLOR_OPTIONS, 'dressColor');
        this._buildColorRow('skin-options', SKIN_OPTIONS, 'skin');
        this._buildLabelRow('headwear-options', HEADWEAR_OPTIONS, 'headwear');

        this._canvas = document.getElementById('preview-canvas');

        const enterGame = (saveCurrentStyle) => {
            if (saveCurrentStyle) saveStyle(this.style);
            this.container.style.display = 'none';
            this.container.innerHTML = '';
            this.onStart();
        };
        document.getElementById('start-btn').onclick = () => enterGame(true);
        const continueBtn = document.getElementById('continue-btn');
        if (continueBtn) continueBtn.onclick = () => enterGame(false);

        this._updatePreview();
    }

    _buildColorRow(elId, options, field) {
        const el = document.getElementById(elId);
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'opt color-opt';
            btn.style.background = opt.color;
            btn.title = opt.label;
            btn.dataset.value = opt.color;
            if (this.style[field] === opt.color) btn.classList.add('selected');
            btn.onclick = () => {
                this.style[field] = opt.color;
                el.querySelectorAll('.opt').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this._updatePreview();
            };
            el.appendChild(btn);
        });
    }

    _buildLabelRow(elId, options, field) {
        const el = document.getElementById(elId);
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'opt label-opt';
            btn.textContent = opt.label;
            btn.dataset.value = opt.id;
            if (this.style[field] === opt.id) btn.classList.add('selected');
            btn.onclick = () => {
                this.style[field] = opt.id;
                el.querySelectorAll('.opt').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this._updatePreview();
            };
            el.appendChild(btn);
        });
    }

    _updatePreview() {
        if (!this._canvas) return;
        drawGirl(this._canvas.getContext('2d'), this.style);
    }
}

// ===== 2D 女孩肖像预览：随选择实时变 =====
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function ell(ctx, x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function darken(hex, f) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = ((n >> 16) & 255) * f, g = ((n >> 8) & 255) * f, b = (n & 255) * f;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function drawGirl(ctx, s) {
    ctx.clearRect(0, 0, 180, 240);
    const cx = 90, hy = 84, hR = 42;
    const hair = s.hairColor, skin = s.skin, dress = s.dressColor;
    const dark = darken(dress, 0.78);

    // —— 后方头发 / 长发披后 ——
    ctx.fillStyle = hair;
    if (s.hairStyle !== 'short') ell(ctx, cx, hy + 22, hR + 5, hR + 16);
    if (s.hairStyle === 'twin') {            // 双马尾（脑后两束）
        ell(ctx, cx - 50, hy + 30, 18, 44);
        ell(ctx, cx + 50, hy + 30, 18, 44);
    }

    // —— 腿 + 鞋 ——
    ctx.fillStyle = skin;
    rrect(ctx, cx - 17, 198, 13, 32, 5);
    rrect(ctx, cx + 4, 198, 13, 32, 5);
    ctx.fillStyle = darken(dress, 0.5);
    ell(ctx, cx - 10, 230, 13, 7);
    ell(ctx, cx + 11, 230, 13, 7);

    // —— 连衣裙（梯形）+ 裙摆 ——
    ctx.fillStyle = dress;
    ctx.beginPath();
    ctx.moveTo(cx - 22, 126); ctx.lineTo(cx + 22, 126);
    ctx.lineTo(cx + 48, 204); ctx.lineTo(cx - 48, 204);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(cx - 48, 204); ctx.lineTo(cx + 48, 204);
    ctx.lineTo(cx + 44, 196); ctx.lineTo(cx - 44, 196);
    ctx.closePath(); ctx.fill();

    // —— 手臂 ——
    ctx.fillStyle = skin;
    rrect(ctx, cx - 42, 130, 11, 42, 5);
    rrect(ctx, cx + 31, 130, 11, 42, 5);
    ctx.fillStyle = dress;   // 泡泡袖
    circle(ctx, cx - 30, 132, 9);
    circle(ctx, cx + 30, 132, 9);

    // —— 麻花辫（前侧垂下，盖在裙子上）——
    if (s.hairStyle === 'braids') {
        ctx.fillStyle = hair;
        for (const sx of [-1, 1]) {
            for (let i = 0; i < 4; i++) ell(ctx, cx + sx * 44, hy + 26 + i * 16, 9 - i, 9);
            ctx.fillStyle = darken(hair, 0.6);  // 发尾扎带
            circle(ctx, cx + sx * 44, hy + 26 + 4 * 16, 5);
            ctx.fillStyle = hair;
        }
    }

    // —— 头（肤色）——
    ctx.fillStyle = skin;
    circle(ctx, cx, hy, hR);

    // —— 刘海（盖住额头，波浪边）——
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(cx, hy, hR + 2, 0, Math.PI, true);       // 头顶半圆
    ctx.lineTo(cx - hR * 0.62, hy - hR * 0.08);
    ctx.quadraticCurveTo(cx - hR * 0.3, hy + hR * 0.16, cx, hy - hR * 0.04);
    ctx.quadraticCurveTo(cx + hR * 0.3, hy + hR * 0.16, cx + hR * 0.62, hy - hR * 0.08);
    ctx.lineTo(cx + hR + 2, hy);
    ctx.closePath(); ctx.fill();

    // 丸子头：头顶发髻
    if (s.hairStyle === 'bun') { ctx.fillStyle = hair; circle(ctx, cx, hy - hR - 4, 15); }

    // —— 脸 ——
    const ex = hR * 0.4, ey = hy + hR * 0.16;
    ctx.fillStyle = '#fff';
    ell(ctx, cx - ex, ey, 8, 10); ell(ctx, cx + ex, ey, 8, 10);
    ctx.fillStyle = s.eyeColor || '#3a2a22';
    ell(ctx, cx - ex, ey + 1, 5, 7); ell(ctx, cx + ex, ey + 1, 5, 7);
    ctx.fillStyle = '#fff';
    circle(ctx, cx - ex - 2, ey - 2, 2.2); circle(ctx, cx + ex - 2, ey - 2, 2.2);
    ctx.fillStyle = 'rgba(255,120,160,0.5)';   // 腮红
    ell(ctx, cx - hR * 0.6, hy + hR * 0.45, 7, 4); ell(ctx, cx + hR * 0.6, hy + hR * 0.45, 7, 4);
    ctx.strokeStyle = '#7a4a3a'; ctx.lineWidth = 2.5;  // 微笑
    ctx.beginPath(); ctx.arc(cx, hy + hR * 0.42, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

    // —— 头饰 ——
    if (s.headwear && s.headwear !== 'none') {
        const emoji = s.headwear === 'bow' ? '🎀' : (s.headwear === 'flower' ? '🌸' : '👑');
        ctx.font = '34px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const onBraid = s.hairStyle === 'braids' && s.headwear !== 'crown';
        const ty = onBraid ? hy + 50 : (s.hairStyle === 'bun' ? hy - hR - 20 : hy - hR - 6);
        if (onBraid) {
            ctx.fillText(emoji, cx - 44, ty);
            ctx.fillText(emoji, cx + 44, ty);
        } else {
            ctx.fillText(emoji, cx, ty);
        }
    }
}
