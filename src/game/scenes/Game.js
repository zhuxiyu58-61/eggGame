import { Scene } from 'phaser';
import { gameConfig } from '../config';
import {
    drawCuteEgg,
    drawSurprisedEgg,
    drawHappyEgg,
    loadStyle,
    hexToInt,
} from '../style';

function lerp(a, b, t) {
    return a + (b - a) * t;
}

export class Game extends Scene
{
    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.gameWon = false;
        this.dying = false;

        const worldWidth = gameConfig.worldWidth;
        const worldHeight = 768;
        this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

        this.cameras.main.setBackgroundColor(gameConfig.skyColor);
        this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

        // ===== 伪 3D 背景：视差远近层（越远滚得越慢，模拟透视）=====
        this.buildParallax(worldWidth);

        const r = gameConfig.playerRadius;
        const style = loadStyle();
        drawCuteEgg(this, 'egg', style, r);
        drawSurprisedEgg(this, 'egg_surprise', style, r);
        drawHappyEgg(this, 'egg_happy', style, r);

        // 地面：上层草绿+下层泥土，做出地平线感
        this.ground = this.add.rectangle(worldWidth / 2, 740, worldWidth, 56, hexToInt(gameConfig.groundColor));
        this.physics.add.existing(this.ground, true);
        this.ground.setDepth(-5);
        const grassEdge = this.add.rectangle(worldWidth / 2, 715, worldWidth, 4, 0x4f6e1a);
        grassEdge.setDepth(-4);
        const groundShade = this.add.rectangle(worldWidth / 2, 758, worldWidth, 20, 0x000000, 0.18);
        groundShade.setDepth(-4);

        const ow = gameConfig.obstacleWidth;
        const oh = gameConfig.obstacleHeight;
        this.obstacles = this.physics.add.staticGroup();
        [600, 1300, 1800].forEach(x => {
            const obs = this.add.rectangle(x, 712 - oh / 2, ow, oh, hexToInt(gameConfig.obstacleColor));
            this.physics.add.existing(obs, true);
            this.obstacles.add(obs);
        });

        this.spikes = this.physics.add.staticGroup();
        this.createSpikeRow(1000, 2);
        this.createSpikeRow(1500, 3);
        this.createSpikeRow(2100, 4);

        const gs = gameConfig.goalSize;
        const goalX = worldWidth - 120;
        this.goal = this.add.rectangle(goalX, 712 - gs / 2, gs, gs, hexToInt(gameConfig.goalColor));
        this.goal.setStrokeStyle(3, 0xffffff);
        this.physics.add.existing(this.goal, true);
        this.tweens.add({
            targets: this.goal,
            scaleX: 1.15,
            scaleY: 1.15,
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // 静态物体投影（贴在地上，给立体感）
        this.obstacles.getChildren().forEach(obs => {
            const sh = this.add.ellipse(obs.x, 712, ow * 1.4, 14, 0x000000, 0.32);
            sh.setDepth(-3);
        });
        this.spikes.getChildren().forEach(spk => {
            const sh = this.add.ellipse(spk.x, 712, spk.width * 1.25, 12, 0x000000, 0.28);
            sh.setDepth(-3);
        });
        const goalShadow = this.add.ellipse(goalX, 712, gs * 1.4, 14, 0x000000, 0.28);
        goalShadow.setDepth(-3);

        // 小蛋：canvas 高 2.5r（上面 0.5r 给装饰），物理圆要 offset
        this.player = this.physics.add.sprite(150, 100, 'egg');
        this.player.setCircle(r, 0, r * 0.5);
        this.player.setBounce(0.2);
        this.player.setCollideWorldBounds(true);
        this.player.setDepth(2);
        this.wasInAir = false;

        // 小蛋脚下的影子：跳越高影子越小越淡（深度线索）
        this.playerShadow = this.add.ellipse(150, 712, r * 1.8, r * 0.55, 0x000000, 0.4);
        this.playerShadow.setDepth(-2);

        this.breathingTween = this.tweens.add({
            targets: this.player,
            scaleX: 1.04,
            scaleY: 0.96,
            duration: 900,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

        this.physics.add.collider(this.player, this.ground);
        this.physics.add.collider(this.player, this.obstacles);
        this.physics.add.overlap(this.player, this.goal, this.onWin, null, this);
        this.physics.add.overlap(this.player, this.spikes, this.onSpikeHit, null, this);

        this.cursors = this.input.keyboard.createCursorKeys();

        this.add.text(512, 50, gameConfig.hintText, {
            fontFamily: 'Arial Black', fontSize: 24, color: '#ffffff',
            stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5).setScrollFactor(0);

        this.add.text(1014, 754, '按 C 回捏脸', {
            fontFamily: 'Arial Black', fontSize: 16, color: '#ffffff',
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(1, 1).setScrollFactor(0);

        this.input.keyboard.on('keydown-C', () => {
            this.scene.start('Customize');
        });
    }

    buildParallax (worldWidth)
    {
        // 黄昏暖色横条（地平线辉光），固定在屏幕（不滚）
        const horizonGlow = this.add.rectangle(512, 470, 1024, 280, hexToInt('#ffd5e5'), 0.45);
        horizonGlow.setScrollFactor(0);
        horizonGlow.setDepth(-100);

        // 太阳：几乎不动（最远）
        const sunX = 850, sunY = 130;
        const sunGlow = this.add.circle(sunX, sunY, 95, 0xffd966, 0.28);
        const sun = this.add.circle(sunX, sunY, 55, 0xffe989, 0.95);
        sunGlow.setScrollFactor(0.04); sunGlow.setDepth(-95);
        sun.setScrollFactor(0.04);     sun.setDepth(-95);

        // 远山：紫色剪影，慢滚
        this.createHillLayer(worldWidth, 0.20, 0x9d8acc, 540, 70, 0.005, -90);
        // 云：中速漂浮
        this.createCloudLayer(worldWidth, 0.30, -85);
        // 中景山：淡紫
        this.createHillLayer(worldWidth, 0.45, 0xb8a3d8, 595, 60, 0.007, -80);
        // 近景山：浅绿，几乎跟脚
        this.createHillLayer(worldWidth, 0.75, 0x9dc483, 660, 50, 0.009, -70);
    }

    createHillLayer (worldWidth, scrollFactor, color, baseY, amplitude, freq, depth)
    {
        const g = this.add.graphics();
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(0, 768);
        g.lineTo(0, baseY);
        const step = 20;
        for (let x = 0; x <= worldWidth; x += step) {
            const wave = Math.sin(x * freq) * amplitude + Math.sin(x * freq * 2.3) * amplitude * 0.3;
            g.lineTo(x, baseY - wave);
        }
        g.lineTo(worldWidth, 768);
        g.closePath();
        g.fillPath();
        g.setScrollFactor(scrollFactor);
        g.setDepth(depth);
    }

    createCloudLayer (worldWidth, scrollFactor, depth)
    {
        const positions = [
            [200, 130], [600, 100], [1100, 150],
            [1500, 120], [1900, 100], [2300, 140]
        ];
        positions.forEach(([x, y]) => {
            const g = this.add.graphics();
            g.fillStyle(0xffffff, 0.9);
            g.fillCircle(x, y, 28);
            g.fillCircle(x + 26, y + 4, 22);
            g.fillCircle(x - 24, y + 6, 20);
            g.fillCircle(x + 8, y - 14, 16);
            g.setScrollFactor(scrollFactor);
            g.setDepth(depth);
        });
    }

    createSpikeRow (x, count)
    {
        const sw = gameConfig.spikeWidth;
        const sh = gameConfig.spikeHeight;
        const groundTop = 712;
        const color = hexToInt(gameConfig.spikeColor);

        const g = this.add.graphics();
        for (let i = 0; i < count; i++) {
            const baseX = x + i * sw;
            const tipX = baseX + sw / 2;
            const tipY = groundTop - sh;
            g.fillStyle(0x4a0e0e, 1);
            g.fillTriangle(baseX, groundTop, baseX + sw, groundTop, tipX, tipY);
            g.fillStyle(color, 1);
            g.fillTriangle(baseX + 3, groundTop, baseX + sw - 3, groundTop, tipX, tipY + 5);
            g.fillStyle(0xffd0d0, 0.7);
            g.fillTriangle(tipX - 2, tipY + 6, tipX + 1, groundTop - 5, tipX - 1, groundTop - 5);
        }

        const totalWidth = sw * count;
        const body = this.add.rectangle(
            x + totalWidth / 2,
            groundTop - sh / 2 + 4,
            totalWidth - 4,
            sh - 8,
            0xff0000,
            0
        );
        this.physics.add.existing(body, true);
        this.spikes.add(body);
    }

    spawnLandingDust (x, y)
    {
        for (let i = 0; i < 6; i++) {
            const offsetX = (i - 2.5) * 8;
            const dust = this.add.circle(x + offsetX, y, 5, 0xffffff, 0.85);
            this.tweens.add({
                targets: dust,
                x: x + offsetX * 2.5,
                y: y - 6,
                scale: 0.2,
                alpha: 0,
                duration: 380,
                ease: 'Quad.easeOut',
                onComplete: () => dust.destroy()
            });
        }
    }

    onSpikeHit ()
    {
        if (this.gameWon || this.dying) return;
        this.dying = true;

        this.breathingTween?.stop();
        this.player.setVelocity(0, 0);
        this.physics.pause();
        this.player.setTint(0xff5050);
        this.player.setScale(0.85, 1.15);

        this.cameras.main.shake(280, 0.012);
        this.cameras.main.flash(180, 255, 80, 80);

        const deathLabel = this.add.text(512, 384, gameConfig.deathText, {
            fontFamily: 'Arial Black', fontSize: 56, color: '#ffffff',
            stroke: '#a01010', strokeThickness: 8
        }).setOrigin(0.5).setScale(0).setScrollFactor(0);

        this.tweens.add({
            targets: deathLabel,
            scale: 1,
            duration: 280,
            ease: 'Back.easeOut'
        });

        this.time.delayedCall(900, () => this.scene.restart());
    }

    onWin ()
    {
        if (this.gameWon) return;
        this.gameWon = true;

        this.player.setVelocity(0, 0);
        this.physics.pause();

        this.breathingTween?.stop();
        this.player.setScale(1, 1);
        this.player.setAngle(0);
        this.player.setTexture('egg_happy');
        this.tweens.add({
            targets: this.player,
            scaleX: 1.18,
            scaleY: 1.18,
            duration: 220,
            yoyo: true,
            repeat: 3,
            ease: 'Sine.easeInOut'
        });

        const winLabel = this.add.text(512, 384, gameConfig.winText, {
            fontFamily: 'Arial Black', fontSize: 84, color: '#ffd700',
            stroke: '#000000', strokeThickness: 10
        }).setOrigin(0.5).setScale(0).setScrollFactor(0);

        this.tweens.add({
            targets: winLabel,
            scale: 1,
            duration: 400,
            ease: 'Back.easeOut'
        });

        this.add.text(512, 470, '按空格再玩一次 · 按 C 换造型', {
            fontFamily: 'Arial Black', fontSize: 26, color: '#ffffff',
            stroke: '#000000', strokeThickness: 5
        }).setOrigin(0.5).setAlpha(0).setScrollFactor(0).setName('restartHint');

        this.tweens.add({
            targets: this.children.getByName('restartHint'),
            alpha: 1,
            delay: 600,
            duration: 400
        });
    }

    update ()
    {
        if (this.gameWon) {
            if (this.cursors.space.isDown) {
                this.scene.restart();
            }
            return;
        }

        if (this.dying) return;

        if (this.cursors.left.isDown) {
            this.player.setVelocityX(-gameConfig.moveSpeed);
            this.player.angle = lerp(this.player.angle, -10, 0.2);
        } else if (this.cursors.right.isDown) {
            this.player.setVelocityX(gameConfig.moveSpeed);
            this.player.angle = lerp(this.player.angle, 10, 0.2);
        } else {
            this.player.setVelocityX(0);
            this.player.angle = lerp(this.player.angle, 0, 0.2);
        }

        const onGround = this.player.body.blocked.down;

        if (this.cursors.space.isDown && onGround) {
            this.player.setVelocityY(-gameConfig.jumpPower);
            this.player.setTexture('egg_surprise');
        }

        if (this.wasInAir && onGround) {
            this.spawnLandingDust(this.player.x, this.player.body.bottom);
            this.player.setTexture('egg');
        }
        this.wasInAir = !onGround;

        // 影子跟脚：跳越高、影子越小越淡（深度线索）
        this.updatePlayerShadow();
    }

    updatePlayerShadow ()
    {
        if (!this.playerShadow) return;
        const groundY = 712;
        const playerBottomY = this.player.body.bottom;
        const heightAboveGround = Math.max(0, groundY - playerBottomY);
        const shrink = Math.max(0.35, 1 - heightAboveGround / 260);
        this.playerShadow.x = this.player.x;
        this.playerShadow.setScale(shrink, shrink * 0.9);
        this.playerShadow.setAlpha(0.4 * Math.max(0.35, shrink));
    }
}
