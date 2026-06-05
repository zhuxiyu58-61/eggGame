import {
    BODY_COLOR_OPTIONS,
    EYE_COLOR_OPTIONS,
    ACCESSORY_OPTIONS,
    loadStyle,
    saveStyle,
} from './style';

export class Customize {
    constructor(container, onStart) {
        this.container = container;
        this.onStart = onStart;
        this.style = loadStyle();
        this._render();
    }

    _render() {
        this.container.innerHTML = `
            <div class="customize-panel">
                <h1>捏脸 · 选你喜欢的样子</h1>
                <div class="preview-wrap">
                    <div class="preview-egg" id="preview-egg">
                        <div class="eye left"></div>
                        <div class="eye right"></div>
                        <div class="cheek left"></div>
                        <div class="cheek right"></div>
                        <div class="mouth"></div>
                        <div class="accessory" id="preview-accessory"></div>
                    </div>
                    <div class="preview-shadow"></div>
                </div>
                <div class="row">
                    <label>身体颜色</label>
                    <div class="options" id="body-options"></div>
                </div>
                <div class="row">
                    <label>头顶装饰</label>
                    <div class="options" id="accessory-options"></div>
                </div>
                <div class="row">
                    <label>眼睛颜色</label>
                    <div class="options" id="eye-options"></div>
                </div>
                <button class="start-btn" id="start-btn">开始 3D 冒险 ▶</button>
            </div>
        `;

        this._buildColorRow('body-options', BODY_COLOR_OPTIONS, 'bodyColor');
        this._buildLabelRow('accessory-options', ACCESSORY_OPTIONS, 'accessory');
        this._buildColorRow('eye-options', EYE_COLOR_OPTIONS, 'eyeColor');

        document.getElementById('start-btn').onclick = () => {
            saveStyle(this.style);
            this.container.style.display = 'none';
            this.container.innerHTML = '';
            this.onStart();
        };

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
        const egg = document.getElementById('preview-egg');
        egg.style.background = `radial-gradient(circle at 35% 30%, #ffffff66 0%, transparent 35%), ${this.style.bodyColor}`;

        egg.querySelectorAll('.eye').forEach(e => {
            e.style.background = `radial-gradient(circle, ${this.style.eyeColor} 0% 55%, white 55% 100%)`;
        });

        const acc = document.getElementById('preview-accessory');
        acc.className = 'accessory acc-' + this.style.accessory;
    }
}
