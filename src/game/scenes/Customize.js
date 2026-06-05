import { Scene } from 'phaser';
import {
    BODY_COLOR_OPTIONS,
    EYE_COLOR_OPTIONS,
    ACCESSORY_OPTIONS,
    loadStyle,
    saveStyle,
    drawCuteEgg,
    hexToInt,
} from '../style';

const PREVIEW_KEY = 'previewEgg';

export class Customize extends Scene
{
    constructor ()
    {
        super('Customize');
    }

    create ()
    {
        this.cameras.main.setBackgroundColor('#ffe6f0');

        this.style = loadStyle();
        this.previewR = 80;

        // 背景两层柔和山头（伪 3D 深度感）
        this.drawSoftHill(540, 70, 0xffc4d6, 0.7);
        this.drawSoftHill(580, 50, 0xff96b8, 0.55);

        this.add.text(512, 60, '捏脸 · 选你喜欢的样子', {
            fontFamily: 'Arial Black', fontSize: 40, color: '#ff3a78',
            stroke: '#ffffff', strokeThickness: 6
        }).setOrigin(0.5);

        // 预览：底部椭圆影子 + 上方悬浮的小蛋
        this.previewShadow = this.add.ellipse(512, 325, 150, 24, 0x000000, 0.22);
        this.tweens.add({
            targets: this.previewShadow,
            scaleX: 0.85,
            scaleY: 0.85,
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        this.preview = this.add.image(512, 220, PREVIEW_KEY);
        this.tweens.add({
            targets: this.preview,
            y: 215,
            duration: 1100,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.bodyColorSelectors = this.buildColorRow(380, '身体颜色', BODY_COLOR_OPTIONS, (opt) => {
            this.style.bodyColor = opt.color;
        }, () => this.style.bodyColor);

        this.accessorySelectors = this.buildLabelRow(460, '头顶装饰', ACCESSORY_OPTIONS, (opt) => {
            this.style.accessory = opt.id;
        }, () => this.style.accessory, (opt) => opt.id);

        this.eyeColorSelectors = this.buildColorRow(540, '眼睛颜色', EYE_COLOR_OPTIONS, (opt) => {
            this.style.eyeColor = opt.color;
        }, () => this.style.eyeColor);

        // 开始按钮
        const startBg = this.add.rectangle(512, 670, 280, 76, 0xff3a78);
        startBg.setStrokeStyle(4, 0xffffff);
        const startLabel = this.add.text(512, 670, '开始冒险 ▶', {
            fontFamily: 'Arial Black', fontSize: 34, color: '#ffffff'
        }).setOrigin(0.5);
        startBg.setInteractive({ useHandCursor: true });
        startBg.on('pointerover', () => { startBg.setScale(1.05); startLabel.setScale(1.05); });
        startBg.on('pointerout', () => { startBg.setScale(1); startLabel.setScale(1); });
        startBg.on('pointerdown', () => {
            saveStyle(this.style);
            this.scene.start('Game');
        });

        this.refresh();
    }

    drawSoftHill (baseY, amplitude, color, alpha)
    {
        const g = this.add.graphics();
        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(0, 768);
        g.lineTo(0, baseY);
        for (let x = 0; x <= 1024; x += 20) {
            const wave = Math.sin(x * 0.008) * amplitude + Math.sin(x * 0.018) * amplitude * 0.3;
            g.lineTo(x, baseY - wave);
        }
        g.lineTo(1024, 768);
        g.closePath();
        g.fillPath();
    }

    buildColorRow (y, title, options, onPick, getCurrent)
    {
        this.add.text(120, y, title, {
            fontFamily: 'Arial Black', fontSize: 24, color: '#333333'
        }).setOrigin(0, 0.5);

        const startX = 320;
        const gap = 70;
        const selectors = [];
        options.forEach((opt, i) => {
            const x = startX + i * gap;
            const swatch = this.add.circle(x, y, 24, hexToInt(opt.color));
            swatch.setStrokeStyle(3, 0xffffff);
            swatch.setInteractive({ useHandCursor: true });
            swatch.on('pointerdown', () => {
                onPick(opt);
                this.refresh();
            });
            selectors.push({ obj: swatch, value: opt.color });
        });
        return { selectors, getCurrent };
    }

    buildLabelRow (y, title, options, onPick, getCurrent, valueOf)
    {
        this.add.text(120, y, title, {
            fontFamily: 'Arial Black', fontSize: 24, color: '#333333'
        }).setOrigin(0, 0.5);

        const startX = 320;
        const gap = 145;
        const selectors = [];
        options.forEach((opt, i) => {
            const x = startX + i * gap;
            const bg = this.add.rectangle(x, y, 130, 50, 0xffffff, 0.9);
            bg.setStrokeStyle(3, 0xffcce0);
            const label = this.add.text(x, y, opt.label, {
                fontFamily: 'Arial Black', fontSize: 22, color: '#ff3a78'
            }).setOrigin(0.5);
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', () => {
                onPick(opt);
                this.refresh();
            });
            selectors.push({ obj: bg, label, value: valueOf(opt) });
        });
        return { selectors, getCurrent };
    }

    refresh ()
    {
        drawCuteEgg(this, PREVIEW_KEY, this.style, this.previewR);
        this.preview.setTexture(PREVIEW_KEY);

        const highlightColorSel = (group) => {
            const current = group.getCurrent();
            group.selectors.forEach(({ obj, value }) => {
                const selected = value === current;
                obj.setStrokeStyle(selected ? 5 : 3, selected ? 0xff3a78 : 0xffffff);
                obj.setScale(selected ? 1.25 : 1);
            });
        };
        highlightColorSel(this.bodyColorSelectors);
        highlightColorSel(this.eyeColorSelectors);

        // accessory 是矩形按钮，单独画
        const currentAcc = this.accessorySelectors.getCurrent();
        this.accessorySelectors.selectors.forEach(({ obj, value }) => {
            const selected = value === currentAcc;
            obj.setStrokeStyle(selected ? 4 : 3, selected ? 0xff3a78 : 0xffcce0);
            obj.setFillStyle(selected ? 0xffe6f0 : 0xffffff, 0.95);
        });
    }
}
