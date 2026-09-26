import './styles.css';
import { Game } from './game/Game';

function fail(msg: string) {
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<div class="boot-logo"><span>SIEGE</span><em>prac</em></div><div class="boot-error">${msg}</div>`;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot() {
  const app = document.getElementById('app')!;
  if (!hasWebGL2()) {
    fail('SIEGEprac needs WebGL2. Try a recent Chrome, Edge or Firefox with hardware acceleration enabled.');
    return;
  }
  // Let the boot screen paint before the (synchronous) world build.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts are optional */
  }
  try {
    new Game(app);
    const b = document.getElementById('boot');
    b?.classList.add('done');
    setTimeout(() => b?.remove(), 600);
  } catch (e) {
    console.error(e);
    fail('Something went wrong starting the game. Check the console for details.');
  }
}

void boot();
