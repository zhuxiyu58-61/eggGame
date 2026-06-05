import { Game3D } from './game3d/Game3D';
import { Customize } from './game3d/Customize';

document.addEventListener('DOMContentLoaded', () => {
    const gameContainer = document.getElementById('game-container');
    const overlay = document.getElementById('customize-overlay');

    let game = null;

    const showCustomize = () => {
        if (game) {
            game.destroy();
            game = null;
        }
        overlay.style.display = 'flex';
        new Customize(overlay, startGame);
    };

    const startGame = () => {
        overlay.style.display = 'none';
        if (game) game.destroy();
        game = new Game3D(gameContainer, { onOpenCustomize: showCustomize });
        game.onRestart = startGame;
    };

    showCustomize();
});
