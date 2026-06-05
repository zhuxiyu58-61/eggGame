// ★ 改完保存就行——浏览器会自动刷新，不用手动按 F5
// ★ 颜色用 # 开头的网页颜色（比如 #ff0000 是红色，#0000ff 是蓝色）
// ★ 数字越大，对应的效果越夸张

export const gameConfig = {

    // ===== 小球长什么样 =====
    playerColor: '#ff69b4',       // 小球颜色（粉色）
    playerRadius: 30,             // 小球大小（数字越大越胖）

    // ===== 小球怎么动 =====
    moveSpeed: 250,               // 左右移动速度（越大跑得越快）
    jumpPower: 500,               // 跳的力气（越大跳得越高）
    gravity: 800,                 // 重力（越大落得越快）

    // ===== 场景颜色 =====
    skyColor: '#87ceeb',          // 天空颜色
    groundColor: '#6b8e23',       // 地面颜色

    // ===== 障碍物 =====
    obstacleColor: '#555555',     // 障碍物颜色（灰色挡路方块）
    obstacleWidth: 60,            // 障碍物宽
    obstacleHeight: 80,           // 障碍物高

    // ===== 终点 =====
    goalColor: '#ffd700',         // 终点颜色（金色）
    goalSize: 60,                 // 终点大小

    // ===== 关卡长度 =====
    worldWidth: 2500,             // 关卡总长度（数字越大跑得越远，画面会跟着滚）

    // ===== 倒刺（碰到会重来）=====
    spikeColor: '#d63031',        // 倒刺主色（红色）
    spikeWidth: 30,               // 每根倒刺底宽
    spikeHeight: 28,              // 每根倒刺高度

    // ===== 屏幕上的文字 =====
    hintText: '← → 移动 · 空格 跳 · 躲红刺 · 拿金块',
    winText: '🎉 你赢啦！',
    deathText: '哎呀！再来一次',

};
