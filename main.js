import { Game } from './src/game/Game.js';

const loadingBar = document.getElementById('bar');
const loadingTxt = document.getElementById('load-txt');
const loadingScr = document.getElementById('loading');

function setProgress(pct, msg) {
  loadingBar.style.width = `${Math.round(pct * 100)}%`;
  loadingTxt.textContent = msg || '';
}

async function main() {
  const canvas = document.getElementById('canvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  try {
    const game = new Game(canvas);
    setProgress(0.01, 'Creating game world…');

    await game.init(setProgress);

    setProgress(1.0, 'Starting…');

    // Dismiss loading screen
    loadingScr.style.transition = 'opacity 0.6s ease';
    loadingScr.style.opacity = '0';
    setTimeout(() => loadingScr.style.display = 'none', 650);

    // Start audio on first user interaction
    const startAudio = () => {
      game.audio.activate();
      document.removeEventListener('click', startAudio);
      document.removeEventListener('keydown', startAudio);
    };
    document.addEventListener('click', startAudio);
    document.addEventListener('keydown', startAudio);

    game.start();

  } catch (err) {
    console.error('Fatal error:', err);
    loadingTxt.textContent = `Error: ${err.message}`;
    loadingTxt.style.color = '#f44';
  }
}

main();
