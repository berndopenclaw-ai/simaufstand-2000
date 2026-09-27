import './style.css';
import { Game } from './game';

const game = new Game();
game.init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#fff;padding:20px">SimAufstand 2000 konnte nicht starten:\n${String(err)}</pre>`;
});
