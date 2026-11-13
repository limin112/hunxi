import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [src, out, side] = process.argv.slice(2);
const doc = await io.read(src);
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const pos = p.getAttribute('POSITION'), idx = p.getIndices(); const ia = idx.getArray();
  const keep = []; const s = side === 'pos' ? 1 : -1;
  for (let t = 0; t < ia.length; t += 3) {
    let ok = true; for (let k = 0; k < 3; k++) if (pos.getElement(ia[t+k], [])[0] * s < 0.005) ok = false;
    if (ok) keep.push(ia[t], ia[t+1], ia[t+2]);
  }
  idx.setArray(new Uint32Array(keep));
  // recentre x/y of kept verts
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9]; const used = new Set(keep);
  for (const i of used) { const v = pos.getElement(i, []); for (let a=0;a<3;a++){mn[a]=Math.min(mn[a],v[a]);mx[a]=Math.max(mx[a],v[a]);} }
  const c = mn.map((v,a)=>(v+mx[a])/2);
  for (let i = 0; i < pos.getCount(); i++) { const v = pos.getElement(i, []); pos.setElement(i, [v[0]-c[0], v[1]-c[1], v[2]-c[2]]); }
  console.log('kept tris', keep.length/3, 'size', mx.map((v,a)=>(v-mn[a]).toFixed(3)));
}
await doc.transform(prune());
await io.write(out, doc);
