// ============================================================
//  Boot: load three.js (ES modules) and the addons the game uses,
//  then run the game scripts in order. They share globals, so the
//  module exports are exposed on window first.
// ============================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

window.THREE = THREE;
Object.assign(window, { Sky, EffectComposer, RenderPass, ShaderPass, OutputPass, GTAOPass, UnrealBloomPass, SMAAPass });

const GAME_SCRIPTS = ['core', 'texlib', 'textures', 'blocktex', 'render', 'world', 'meshgen', 'mesher', 'entities', 'player', 'ui', 'invui', 'main'];
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
