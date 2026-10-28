// ============================================================
//  Boot: load three.js (ES modules) and the addons the game uses,
//  then run the game scripts in order. They share globals, so the
//  module exports are exposed on window first.
// ============================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

window.THREE = THREE;
window.Sky = Sky;

const GAME_SCRIPTS = ['core', 'texlib', 'textures', 'blocktex', 'render', 'world', 'mesher', 'entities', 'player', 'ui', 'invui', 'main'];
for (const name of GAME_SCRIPTS) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `js/${name}.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`js/${name}.js 를 불러오지 못했습니다`));
    document.body.appendChild(s);
  });
  // block textures are generated in code before the renderer builds materials from them
  if (name === 'blocktex') {
    const splash = document.getElementById('splash'), text = splash.textContent;
    await window.buildBlockTextures(p => { splash.textContent = `텍스처를 만드는 중… ${Math.round(p * 100)}%`; });
    splash.textContent = text;
  }
}
