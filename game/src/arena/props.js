// Props: torn banners hanging from the piers (instanced, gentle sway), broken pews pushed into
// the arcades and aisles, fallen masonry.
import * as THREE from 'three';
import { NAVE } from './architecture.js';
import { mergeGeos, rng } from './util.js';

function boxAt(w, h, d, x, y, z, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Pew in local space: long axis X, the kneeler faces +Z. */
function pewGeometry(broken) {
  const L = broken ? 2.3 : 4.0;
  const x0 = broken ? -L / 2 + 0.1 : 0;
  const P = [
    boxAt(L, 0.07, 0.46, x0, 0.46, 0),
    boxAt(broken ? L * 0.55 : L, 0.6, 0.06, broken ? x0 - L * 0.2 : 0, 0.8, -0.25, -0.12, broken ? 0.12 : 0),
    boxAt(L, 0.08, 0.16, x0, 0.14, 0.46),
    boxAt(broken ? L * 0.5 : L, 0.04, 0.18, broken ? x0 - L * 0.25 : 0, 1.0, -0.37),
    boxAt(0.09, 1.08, 0.66, -L / 2 + 0.05 + (broken ? x0 : 0), 0.54, 0.0),
  ];
  if (!broken) P.push(boxAt(0.09, 1.08, 0.66, L / 2 - 0.05, 0.54, 0.0));
  // carved poppy-head finials on the end panels
  const fin = new THREE.SphereGeometry(0.09, 6, 4);
  fin.translate(-L / 2 + 0.05 + (broken ? x0 : 0), 1.12, -0.05);
  P.push(fin);
  return mergeGeos(P, ['position', 'normal', 'uv']);
}

export function createProps({ bannerTex, woodTex, stoneMat, ironMat, quality = 'high', seed = 99 }) {
  const r = rng(seed);
  const group = new THREE.Group();
  group.name = 'props';

  // --- banners -------------------------------------------------------------------------------
  const bannerUniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } };
  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.88, metalness: 0,
    emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.035,
  });
  bannerMat.name = 'banner';
  bannerMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, bannerUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          float seed = 0.0;
          #ifdef USE_INSTANCING
            seed = instanceMatrix[3].z * 0.37 + instanceMatrix[3].x * 0.11;
          #endif
          float hang = clamp((4.0 - position.y) / 8.0, 0.0, 1.0);   // 0 at the pole, 1 at the hem
          float folds = sin(position.x * 5.5 + seed) * 0.05 * (0.4 + hang);
          float sway = (sin(uTime * 0.55 + seed) * 0.6 + sin(uTime * 1.31 + seed * 2.3 + position.y * 0.4) * 0.4) * uWind;
          transformed.z += folds + sway * hang * hang * 0.35;
          transformed.x += sin(uTime * 0.8 + seed + position.y * 0.6) * 0.04 * hang * uWind;
        }`);
  };
  bannerMat.customProgramCacheKey = () => 'arena-banner-v1';
  const bannerGeo = new THREE.PlaneGeometry(2.3, 8, 6, 24);
  const slots = [];
  for (const side of [-1, 1]) {
    for (const z of NAVE.pillarZ) {
      if (z < -37 || z > 37) continue;
      if (r() < 0.18) continue; // some fell long ago
      slots.push({ side, z });
    }
  }
  const banners = new THREE.InstancedMesh(bannerGeo, bannerMat, slots.length);
  banners.name = 'banners';
  const poles = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  slots.forEach((sl, i) => {
    const len = r.range(0.72, 1.08);
    const top = 16.6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sl.side < 0 ? Math.PI / 2 : -Math.PI / 2);
    m.compose(p.set(sl.side * 12.05, top - 4 * len, sl.z), q, s.set(1, len, 1));
    banners.setMatrixAt(i, m);
    // iron pole + bracket back to the pier
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.7, 6);
    pole.rotateX(Math.PI / 2);
    pole.translate(sl.side * 12.05, top + 0.05, sl.z);
    poles.push(pole);
    const br = new THREE.CylinderGeometry(0.035, 0.035, 1.3, 5);
    br.rotateZ(Math.PI / 2);
    br.translate(sl.side * 12.65, top + 0.05, sl.z);
    poles.push(br);
  });
  banners.instanceMatrix.needsUpdate = true;
  banners.computeBoundingSphere();
  banners.castShadow = false;
  banners.receiveShadow = true;
  group.add(banners);
  const poleMesh = new THREE.Mesh(mergeGeos(poles), ironMat);
  poleMesh.name = 'banner-poles';
  group.add(poleMesh);

  // --- pews ------------------------------------------------------------------------------------
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x9a7a5c, roughness: 0.72, metalness: 0 });
  woodMat.name = 'pew-wood';
  const pewDefs = { whole: [], broken: [] };
  const addPew = (x, z, yaw, kind, pose) => pewDefs[kind].push({ x, z, yaw, pose });
  // pushed into the arcade openings, along the nave edge
  for (const side of [-1, 1]) {
    for (let k = 0; k < NAVE.pillarZ.length - 1; k++) {
      const zc = (NAVE.pillarZ[k] + NAVE.pillarZ[k + 1]) / 2;
      if (zc < -34 || zc > 42) continue;
      if (r() < 0.75) addPew(side * r.range(13.3, 14.1), zc + r.range(-0.6, 0.6), Math.PI / 2 + side * Math.PI / 2 + r.range(-0.25, 0.25) + Math.PI / 2, r() < 0.35 ? 'broken' : 'whole', r() < 0.2 ? 'tilt' : 'up');
      if (r() < 0.35) addPew(side * r.range(15.0, 16.2), zc + r.range(-1.5, 1.5), r.range(0, Math.PI * 2), r() < 0.5 ? 'broken' : 'whole', r.pick(['up', 'tilt', 'over']));
    }
  }
  // aisles: loose rows, many knocked over
  for (const side of [-1, 1]) {
    for (let z = -44; z < 46; z += r.range(2.4, 4.2)) {
      if (r() < 0.25) continue;
      const kind = r() < 0.3 ? 'broken' : 'whole';
      const pose = r() < 0.55 ? 'up' : r() < 0.6 ? 'tilt' : 'over';
      addPew(side * r.range(17.5, 20.5), z, r.range(-0.35, 0.35) + (r() < 0.15 ? Math.PI / 2 : 0), kind, pose);
    }
  }
  const pewMeshes = [];
  for (const kind of ['whole', 'broken']) {
    const defs = pewDefs[kind];
    if (!defs.length) continue;
    const im = new THREE.InstancedMesh(pewGeometry(kind === 'broken'), woodMat, defs.length);
    im.name = 'pews-' + kind;
    defs.forEach((d, i) => {
      const e = new THREE.Euler(0, d.yaw, 0, 'YXZ');
      let y = 0;
      if (d.pose === 'tilt') { e.z = r.range(0.25, 0.5) * r.sign(); y = 0.15; }
      if (d.pose === 'over') { e.x = Math.PI / 2 * (r() < 0.5 ? 1 : -1) + r.range(-0.2, 0.2); y = 0.3; }
      q.setFromEuler(e);
      m.compose(p.set(d.x, y, d.z), q, s.set(1, 1, 1));
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    group.add(im);
    pewMeshes.push(im);
  }

  // --- fallen masonry --------------------------------------------------------------------------------
  const chunks = [];
  const addChunk = (x, y, z, sz) => chunks.push({ x, y, z, sz });
  for (let k = 0; k < (quality === 'low' ? 40 : 80); k++) {
    const side = r.sign();
    addChunk(side * r.range(15, 22.3), 0, r.range(-48, 48), r.range(0.25, 1.1));
  }
  // under the vault holes: small debris poking out of the water (no colliders needed)
  for (const h of [{ x: -4.5, z: 9 }, { x: 5, z: -13 }, { x: -2, z: 31 }]) {
    for (let k = 0; k < 9; k++) addChunk(h.x + r.gauss() * 2.2, 0, h.z + r.gauss() * 3, r.range(0.08, 0.22));
  }
  // rubble heaps against the walls in the aisles
  for (let k = 0; k < 4; k++) {
    const side = r.sign(), z = r.range(-40, 40);
    for (let i = 0; i < 10; i++) addChunk(side * r.range(20.5, 22.6), r.range(0, 0.6), z + r.range(-2, 2), r.range(0.3, 0.9));
  }
  const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
  const rubble = new THREE.InstancedMesh(chunkGeo, stoneMat, chunks.length);
  rubble.name = 'rubble';
  chunks.forEach((c, i) => {
    q.setFromEuler(new THREE.Euler(r() * 6.3, r() * 6.3, r() * 6.3));
    m.compose(p.set(c.x, c.y + c.sz * 0.35, c.z), q, s.set(c.sz * r.range(0.8, 1.4), c.sz * r.range(0.5, 0.9), c.sz * r.range(0.8, 1.3)));
    rubble.setMatrixAt(i, m);
  });
  rubble.instanceMatrix.needsUpdate = true;
  rubble.computeBoundingSphere();
  rubble.receiveShadow = true;
  group.add(rubble);
  // fallen column drums in the aisles
  const drums = [];
  for (let k = 0; k < 6; k++) {
    const g = new THREE.CylinderGeometry(0.75, 0.75, r.range(1.0, 1.8), 16);
    g.rotateZ(Math.PI / 2);
    g.rotateY(r() * Math.PI);
    g.translate(r.sign() * r.range(16.5, 21), 0.7, r.range(-44, 44));
    drums.push(g);
  }
  const drumMesh = new THREE.Mesh(mergeGeos(drums), stoneMat);
  drumMesh.name = 'drums';
  drumMesh.receiveShadow = true;
  group.add(drumMesh);

  return {
    group, banners, pewMeshes, rubble,
    update(time, wind) {
      bannerUniforms.uTime.value = time;
      bannerUniforms.uWind.value = wind;
    },
  };
}
