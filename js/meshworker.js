'use strict';
// ============================================================
//  Mesh worker: builds chunk meshes off the main thread so chunk
//  loading and block edits don't stall frames. Receives the tables
//  once, then padded block volumes; returns transferable arrays.
// ============================================================
importScripts('texlib.js', 'meshgen.js');
let K = null;
onmessage = e => {
  const m = e.data;
  if (m.init) { K = m.init; MESH.skyFalloff = K.skyFalloff; return; }
  const res = meshVolume(m.v, K);
  postMessage({ id: m.id, res }, meshBuffers(res));
};
