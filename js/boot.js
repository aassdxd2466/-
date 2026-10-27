// ============================================================
//  Boot: load three.js (ES modules) and the addons the game uses,
//  then run the game scripts in order. They share globals, so the
//  module exports are exposed on window first.
// ============================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

window.THREE = THREE;
window.Sky = Sky;

const GAME_SCRIPTS = ['core', 'textures', 'render', 'world', 'mesher', 'entities', 'player', 'ui', 'invui', 'main'];
for (const name of GAME_SCRIPTS) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `js/${name}.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`js/${name}.js 를 불러오지 못했습니다`));
    document.body.appendChild(s);
  });
}
