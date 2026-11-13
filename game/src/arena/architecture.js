// Cathedral shell: arcade walls with pointed arches and clerestory lancets, clustered pillars,
// ribbed pointed vault with broken holes, aisles, end wall with the rose-window opening,
// entrance wall, altar steps and altar.
import * as THREE from 'three';
import { mergeGeos, pointedArch, pointedArchHeight, lancetPath, circlePath, extrudeWall, rng } from './util.js';

export const NAVE = {
  pillarX: 14,
  wallT: 1.4,
  aisleWallX: 23,
  aisleWallT: 1.2,
  zEnd: -50,
  zEntry: 50,
  endWallT: 2.0,
  pillarZ: [-44, -36, -28, -20, -12, -4, 4, 12, 20, 28, 36, 44],
  pierHalf: 1.25,
  arcadeSpring: 13.0,
  arcadeRise: 5.2,
  clereSill: 20.0,
  wallTop: 30,
  vaultRise: 15,
  aisleCeil: 19.5,
  stepsZ0: -36.5,
  stepDepth: 0.6,
  stepRise: 0.17,
  stepCount: 8,
  rose: { x: 0, y: 20, z: -50.55, r: 8.5 },
  keyElevationDeg: 26, // the key light falls this far below horizontal, travelling towards +Z
};
NAVE.keyDir = [0, -Math.sin(NAVE.keyElevationDeg * Math.PI / 180), Math.cos(NAVE.keyElevationDeg * Math.PI / 180)];
NAVE.platformY = NAVE.stepRise * NAVE.stepCount;
NAVE.platformZ = NAVE.stepsZ0 - NAVE.stepDepth * (NAVE.stepCount - 1);
NAVE.vaultApex = NAVE.wallTop + NAVE.vaultRise;

export function vaultY(x) {
  return NAVE.wallTop + pointedArchHeight(NAVE.pillarX, NAVE.vaultRise, x);
}

function cyl(rt, rb, h, seg, y, x = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
  g.translate(x, y + h / 2, z);
  return g;
}

/** One clustered gothic pier in local space; the nave side faces +X. */
function pillarGeometry() {
  const P = [];
  const top = NAVE.arcadeSpring - 0.8; // capital bottom
  P.push(cyl(1.62, 1.78, 0.5, 8, 0));
  P.push(cyl(1.42, 1.5, 0.42, 8, 0.5));
  P.push(cyl(1.2, 1.3, 0.12, 16, 0.92));
  P.push(cyl(1.0, 1.0, top - 1.04, 24, 1.04));
  // eight colonnettes + four stronger cardinal shafts
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4;
    P.push(cyl(0.2, 0.2, top - 1.04, 10, 1.04, Math.cos(a) * 1.03, Math.sin(a) * 1.03));
    P.push(cyl(0.27, 0.3, 0.22, 10, 0.92, Math.cos(a) * 1.03, Math.sin(a) * 1.03));
  }
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    P.push(cyl(0.3, 0.3, top - 1.04, 12, 1.04, Math.cos(a) * 1.02, Math.sin(a) * 1.02));
  }
  // capital (flared bell) + abacus
  P.push(cyl(1.5, 1.18, 0.8, 24, top));
  P.push(cyl(1.68, 1.68, 0.3, 8, top + 0.8));
  // vaulting shafts on the nave face up to the vault springing
  const s0 = top + 1.1, s1 = NAVE.wallTop;
  for (const dz of [-0.48, 0, 0.48]) {
    const r = dz === 0 ? 0.27 : 0.2;
    P.push(cyl(r, r, s1 - s0, 10, s0, NAVE.wallT / 2 + 0.16, dz));
    P.push(cyl(r + 0.12, r + 0.06, 0.45, 10, s1 - 0.45, NAVE.wallT / 2 + 0.16, dz));
  }
  // small corbel ring where the shafts start
  P.push(cyl(0.5, 0.35, 0.3, 10, s0 - 0.3, NAVE.wallT / 2 + 0.16, 0));
  return mergeGeos(P);
}

/** Arcade wall (one side): notched pointed arches between piers, clerestory lancet holes. */
function arcadeWallShape(clerestoryGlass) {
  const { pillarZ, pierHalf, arcadeSpring, arcadeRise, wallTop, zEnd, zEntry, clereSill } = NAVE;
  const s = new THREE.Shape();
  s.moveTo(zEnd - 0.5, 0);
  for (let k = 0; k < pillarZ.length - 1; k++) {
    const z0 = pillarZ[k] + pierHalf, z1 = pillarZ[k + 1] - pierHalf;
    const zc = (z0 + z1) / 2, a = (z1 - z0) / 2;
    s.lineTo(z0, 0);
    s.lineTo(z0, arcadeSpring);
    const arch = pointedArch(a, arcadeRise, 14);
    for (let i = 1; i < arch.length - 1; i++) s.lineTo(zc + arch[i][0], arcadeSpring + arch[i][1]);
    s.lineTo(z1, arcadeSpring);
    s.lineTo(z1, 0);
  }
  s.lineTo(zEntry + 0.5, 0);
  s.lineTo(zEntry + 0.5, wallTop + 0.6);
  s.lineTo(zEnd - 0.5, wallTop + 0.6);
  s.lineTo(zEnd - 0.5, 0);
  // clerestory: a pair of lancets per bay + an oculus-free plate
  for (let k = 0; k < pillarZ.length - 1; k++) {
    const zc = (pillarZ[k] + pillarZ[k + 1]) / 2;
    for (const dz of [-1.35, 1.35]) {
      s.holes.push(lancetPath(zc + dz, clereSill, 0.85, 5.4, 2.3, 8));
      clerestoryGlass.push({ zc: zc + dz, sill: clereSill, hw: 0.85, straight: 5.4, rise: 2.3 });
    }
  }
  return s;
}

function aisleWallShape(glass) {
  const { pillarZ, zEnd, zEntry, aisleCeil } = NAVE;
  const s = new THREE.Shape();
  s.moveTo(zEnd - 2, 0);
  s.lineTo(zEntry + 2, 0);
  s.lineTo(zEntry + 2, aisleCeil + 0.8);
  s.lineTo(zEnd - 2, aisleCeil + 0.8);
  s.lineTo(zEnd - 2, 0);
  for (let k = 0; k < pillarZ.length - 1; k++) {
    const zc = (pillarZ[k] + pillarZ[k + 1]) / 2;
    s.holes.push(lancetPath(zc, 3.2, 1.15, 8.6, 2.9, 10));
    glass.push({ zc, sill: 3.2, hw: 1.15, straight: 8.6, rise: 2.9 });
  }
  return s;
}

/** Gable wall outline in (x, y): aisle shoulders + pointed vault silhouette. */
function gableShape() {
  const W = NAVE.aisleWallX + NAVE.aisleWallT, n = NAVE.pillarX + NAVE.wallT / 2;
  const s = new THREE.Shape();
  s.moveTo(-W, 0);
  s.lineTo(W, 0);
  s.lineTo(W, NAVE.aisleCeil + 0.8);
  s.lineTo(n, NAVE.aisleCeil + 0.8);
  s.lineTo(n, NAVE.wallTop);
  const arch = pointedArch(n, NAVE.vaultRise + 0.6, 24);
  for (let i = arch.length - 2; i >= 1; i--) s.lineTo(arch[i][0], NAVE.wallTop + arch[i][1]);
  s.lineTo(-n, NAVE.wallTop);
  s.lineTo(-n, NAVE.aisleCeil + 0.8);
  s.lineTo(-W, NAVE.aisleCeil + 0.8);
  s.lineTo(-W, 0);
  return s;
}

/** Vault surface (pointed barrel along Z) with ragged holes; returns geometry + hole test. */
function vaultGeometry(holes) {
  const nx = 36, nz = 100;
  const x0 = -NAVE.pillarX - 0.4, x1 = NAVE.pillarX + 0.4;
  const z0 = NAVE.zEnd - 0.5, z1 = NAVE.zEntry + 0.5;
  const pos = [], nor = [], idx = [];
  const fx = (x) => vaultY(Math.max(-NAVE.pillarX, Math.min(NAVE.pillarX, x)));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + (x1 - x0) * (i / nx), z = z0 + (z1 - z0) * (j / nz);
      const y = fx(x);
      const dy = (fx(x + 0.05) - fx(x - 0.05)) / 0.1;
      const n = new THREE.Vector3(dy, -1, 0).normalize();
      pos.push(x, y, z); nor.push(n.x, n.y, n.z);
    }
  }
  const r = rng(77);
  const jag = new Float32Array((nx + 1) * (nz + 1)).map(() => r());
  const inHole = (x, z, j) => holes.some((h) => {
    const d = ((x - h.x) / h.rx) ** 2 + ((z - h.z) / h.rz) ** 2;
    return d < 0.75 + 0.5 * jag[j];
  });
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (x1 - x0) * ((i + 0.5) / nx), cz = z0 + (z1 - z0) * ((j + 0.5) / nz);
      if (inHole(cx, cz, j * (nx + 1) + i)) continue;
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      // facing down (interior)
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function ribGeometries(holes) {
  const out = [];
  const inHole = (x, z) => holes.some((h) => ((x - h.x) / h.rx) ** 2 + ((z - h.z) / h.rz) ** 2 < 1.1);
  const off = 0.28;
  const curveAlong = (fn, n = 28) => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return new THREE.CatmullRomCurve3(pts);
  };
  const X = NAVE.pillarX;
  for (const z of NAVE.pillarZ) {
    if (inHole(0, z)) continue;
    out.push(new THREE.TubeGeometry(curveAlong((s) => {
      const x = -X + 2 * X * s;
      return new THREE.Vector3(x, vaultY(x) - off, z);
    }), 48, 0.34, 6, false));
  }
  const Z = NAVE.pillarZ;
  for (let k = 0; k < Z.length - 1; k++) {
    for (const dir of [1, -1]) {
      if (inHole(0, (Z[k] + Z[k + 1]) / 2) && dir === 1) continue;
      out.push(new THREE.TubeGeometry(curveAlong((s) => {
        const x = dir * (-X + 2 * X * s);
        const z = Z[k] + (Z[k + 1] - Z[k]) * s;
        return new THREE.Vector3(x, vaultY(x) - off, z);
      }), 40, 0.24, 5, false));
    }
  }
  // ridge rib, broken where it crosses holes
  let start = null;
  for (let z = NAVE.zEnd; z <= NAVE.zEntry + 0.01; z += 1) {
    const bad = inHole(0, z);
    if (!bad && start === null) start = z;
    if ((bad || z >= NAVE.zEntry) && start !== null) {
      const len = z - start;
      if (len > 1) {
        const g = new THREE.CylinderGeometry(0.26, 0.26, len, 6);
        g.rotateX(Math.PI / 2);
        g.translate(0, NAVE.vaultApex - off, start + len / 2);
        out.push(g);
      }
      start = null;
    }
  }
  return out;
}

function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Lancet glass panes as flat shapes with 0..1 UVs (local to each pane). */
function paneGeometry(list, toWorld) {
  const geos = [];
  for (const p of list) {
    const shape = lancetPath(0, 0, p.hw, p.straight, p.rise, 10, THREE.Shape);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv, pos = g.attributes.position;
    const H = p.straight + p.rise;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + p.hw) / (2 * p.hw), pos.getY(i) / H);
    toWorld(g, p);
    geos.push(g);
  }
  return geos;
}

export function buildArchitecture({ stoneWall, stoneFloor, stoneDark, glassMaterial, clereGlassMaterial, doorMaterial, quality }) {
  const group = new THREE.Group();
  group.name = 'arena-architecture';
  const shadowCasters = [];

  // --- piers (instanced) -------------------------------------------------------------------
  const pierGeo = pillarGeometry();
  const piers = new THREE.InstancedMesh(pierGeo, stoneWall, NAVE.pillarZ.length * 2);
  piers.name = 'piers';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (const side of [-1, 1]) {
    for (const z of NAVE.pillarZ) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side < 0 ? 0 : Math.PI);
      m.compose(new THREE.Vector3(side * NAVE.pillarX, 0, z), q, sc);
      piers.setMatrixAt(n++, m);
    }
  }
  piers.castShadow = true;
  piers.receiveShadow = true;
  piers.computeBoundingSphere();
  group.add(piers);

  // --- walls ---------------------------------------------------------------------------------
  const wallGeos = [];
  const clerestory = [];
  const arcadeShape = arcadeWallShape(clerestory);
  wallGeos.push(extrudeWall(arcadeShape, NAVE.wallT, 'x', -NAVE.pillarX + NAVE.wallT / 2));
  wallGeos.push(extrudeWall(arcadeShape, NAVE.wallT, 'x', NAVE.pillarX + NAVE.wallT / 2));
  const aisleGlass = [];
  const aisleShape = aisleWallShape(aisleGlass);
  wallGeos.push(extrudeWall(aisleShape, NAVE.aisleWallT, 'x', -NAVE.aisleWallX));
  wallGeos.push(extrudeWall(aisleShape, NAVE.aisleWallT, 'x', NAVE.aisleWallX + NAVE.aisleWallT));
  // string courses (nave side) + cornice
  for (const side of [-1, 1]) {
    const x = side * (NAVE.pillarX - NAVE.wallT / 2 - 0.12);
    wallGeos.push(boxAt(0.4, 0.35, 100, x, NAVE.clereSill - 1.1, 0));
    wallGeos.push(boxAt(0.5, 0.5, 100, x, NAVE.wallTop - 0.1, 0));
  }
  // end wall with rose + lancets
  const endShape = gableShape();
  const endLancets = [];
  endShape.holes.push(circlePath(NAVE.rose.x, NAVE.rose.y, NAVE.rose.r + 0.05, 96));
  for (const x of [-6, -3, 0, 3, 6]) {
    endShape.holes.push(lancetPath(x, NAVE.platformY + 1.2, 0.9, 5.2, 2.1, 8));
    endLancets.push({ zc: x, sill: NAVE.platformY + 1.2, hw: 0.9, straight: 5.2, rise: 2.1 });
  }
  for (const x of [-19, 19]) {
    endShape.holes.push(lancetPath(x, 3.0, 1.2, 9.0, 3.0, 10));
    endLancets.push({ zc: x, sill: 3.0, hw: 1.2, straight: 9.0, rise: 3.0 });
  }
  const endWall = extrudeWall(endShape, NAVE.endWallT, 'z', NAVE.zEnd);
  // entrance wall: small rose + aisle lancets, closed portal
  const entShape = gableShape();
  const entLancets = [];
  entShape.holes.push(circlePath(0, 25, 5.2, 64));
  for (const x of [-19, 19]) {
    entShape.holes.push(lancetPath(x, 3.0, 1.2, 9.0, 3.0, 10));
    entLancets.push({ zc: x, sill: 3.0, hw: 1.2, straight: 9.0, rise: 3.0 });
  }
  const entWall = extrudeWall(entShape, NAVE.endWallT, 'z', NAVE.zEntry + NAVE.endWallT);
  // walls that must cast shadows (the end wall blocks the key light except through the rose)
  const endMesh = new THREE.Mesh(mergeGeos([endWall]), stoneWall);
  endMesh.name = 'end-wall';
  endMesh.castShadow = true;
  endMesh.receiveShadow = true;
  group.add(endMesh);
  shadowCasters.push(endMesh);
  wallGeos.push(entWall);
  // aisle ceilings (with ragged gaps)
  for (const side of [-1, 1]) {
    const gaps = side < 0 ? [[5, 11]] : [[-19, -12], [27, 31]];
    let z = NAVE.zEnd - 2;
    const cx = side * (NAVE.pillarX + NAVE.wallT / 2 + (NAVE.aisleWallX - NAVE.pillarX - NAVE.wallT / 2) / 2 + 0.6);
    const w = NAVE.aisleWallX + NAVE.aisleWallT - NAVE.pillarX - NAVE.wallT / 2 + 0.2;
    for (const [g0, g1] of [...gaps, [NAVE.zEntry + 2, NAVE.zEntry + 2]]) {
      if (g0 > z) wallGeos.push(boxAt(w, 0.8, g0 - z, cx, NAVE.aisleCeil + 0.4, (z + g0) / 2));
      z = g1;
    }
  }
  const walls = new THREE.Mesh(mergeGeos(wallGeos), stoneWall);
  walls.name = 'walls';
  walls.castShadow = true; // arcade walls shadow the aisles
  walls.receiveShadow = true;
  group.add(walls);

  // rose window frame mouldings (stone rings around the opening)
  const frameGeos = [];
  const R = NAVE.rose;
  for (const [rr, tube, zz] of [[R.r + 0.15, 0.32, NAVE.zEnd + 0.05], [R.r + 0.95, 0.42, NAVE.zEnd + 0.1], [R.r + 1.7, 0.22, NAVE.zEnd + 0.05]]) {
    const t = new THREE.TorusGeometry(rr, tube, 8, 128);
    t.translate(R.x, R.y, zz);
    frameGeos.push(t);
  }
  // 24 small bosses on the outer moulding
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const b = new THREE.IcosahedronGeometry(0.42, 0);
    b.translate(R.x + Math.cos(a) * (R.r + 1.35), R.y + Math.sin(a) * (R.r + 1.35), NAVE.zEnd + 0.25);
    frameGeos.push(b);
  }
  // lancet surrounds on the end wall (pointed hood mouldings)
  for (const l of endLancets) {
    const arch = pointedArch(l.hw + 0.25, l.rise + 0.25, 12);
    const pts = arch.map(([u, v]) => new THREE.Vector3(l.zc + u, l.sill + l.straight + v, NAVE.zEnd + 0.12));
    pts.unshift(new THREE.Vector3(l.zc - l.hw - 0.25, l.sill, NAVE.zEnd + 0.12));
    pts.push(new THREE.Vector3(l.zc + l.hw + 0.25, l.sill, NAVE.zEnd + 0.12));
    frameGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05), 40, 0.16, 5, false));
  }
  const frame = new THREE.Mesh(mergeGeos(frameGeos), stoneWall);
  frame.name = 'rose-frame';
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);
  shadowCasters.push(frame);

  // --- vault + ribs --------------------------------------------------------------------------
  const holes = [
    { x: -4.5, z: 9, rx: 5.5, rz: 7.5 },
    { x: 5, z: -13, rx: 4.2, rz: 5.5 },
    { x: -2, z: 31, rx: 3.6, rz: 4.2 },
  ];
  const vault = new THREE.Mesh(vaultGeometry(holes), stoneDark); // stoneDark is DoubleSide
  vault.name = 'vault';
  group.add(vault);
  const ribs = new THREE.Mesh(mergeGeos(ribGeometries(holes)), stoneWall);
  ribs.name = 'ribs';
  group.add(ribs);

  // --- floor plinth band, steps, altar --------------------------------------------------------
  const stepGeos = [];
  const sw = (NAVE.pillarX - NAVE.wallT / 2) * 2;
  for (let i = 0; i < NAVE.stepCount; i++) {
    const front = NAVE.stepsZ0 - NAVE.stepDepth * i, top = NAVE.stepRise * (i + 1);
    const depth = front - NAVE.zEnd;
    stepGeos.push(boxAt(sw, top, depth, 0, top / 2, front - depth / 2));
    // bull-nose lip on each tread
    const lip = new THREE.CylinderGeometry(0.06, 0.06, sw, 6);
    lip.rotateZ(Math.PI / 2);
    lip.translate(0, top - 0.06, front - 0.02);
    stepGeos.push(lip);
  }
  // altar: base, block, overhanging mensa, two flanking plinths
  const PY = NAVE.platformY;
  stepGeos.push(boxAt(7.6, 0.22, 2.9, 0, PY + 0.11, -45.6));
  stepGeos.push(boxAt(7.0, 1.0, 2.3, 0, PY + 0.22 + 0.5, -45.6));
  stepGeos.push(boxAt(7.7, 0.2, 2.8, 0, PY + 1.32, -45.6));
  for (let i = -3; i <= 3; i++) stepGeos.push(boxAt(0.5, 0.82, 0.1, i * 0.95, PY + 0.72, -44.42)); // blind arcading
  for (const x of [-9.5, 9.5]) {
    stepGeos.push(boxAt(2.2, 1.6, 2.2, x, PY + 0.8, -44.5));
    stepGeos.push(boxAt(2.5, 0.2, 2.5, x, PY + 1.7, -44.5));
  }
  const steps = new THREE.Mesh(mergeGeos(stepGeos), stoneFloor);
  steps.name = 'steps-altar';
  steps.castShadow = true;
  steps.receiveShadow = true;
  group.add(steps);

  // --- glass ---------------------------------------------------------------------------------
  const aislePanes = paneGeometry(aisleGlass.flatMap((p) => [p, p]), (() => {
    let k = 0;
    return (g, p) => {
      const side = (k++ % 2) ? 1 : -1;
      g.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(side * (NAVE.aisleWallX + NAVE.aisleWallT * 0.55), p.sill, p.zc);
    };
  })());
  const endPanes = paneGeometry(endLancets, (g, p) => g.translate(p.zc, p.sill, NAVE.zEnd - NAVE.endWallT * 0.6));
  const entPanes = paneGeometry(entLancets, (g, p) => { g.rotateY(Math.PI); g.translate(p.zc, p.sill, NAVE.zEntry + NAVE.endWallT * 0.6); });
  const entRose = new THREE.CircleGeometry(5.25, 64);
  { // remap circle uv to the lancet texture (center medallion area)
    const uv = entRose.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), 0.2 + uv.getY(i) * 0.55);
  }
  entRose.rotateY(Math.PI);
  entRose.translate(0, 25, NAVE.zEntry + NAVE.endWallT * 0.6);
  const glassSide = new THREE.Mesh(mergeGeos([...aislePanes, ...entPanes, entRose], ['position', 'normal', 'uv']), glassMaterial);
  glassSide.name = 'glass-aisles';
  group.add(glassSide);
  const glassEnd = new THREE.Mesh(mergeGeos(endPanes, ['position', 'normal', 'uv']), clereGlassMaterial);
  glassEnd.name = 'glass-end';
  glassEnd.castShadow = true; // keep the key light coming only through the rose
  group.add(glassEnd);
  shadowCasters.push(glassEnd);
  // clerestory: glaze about half, the rest are open to the sky
  const rr = rng(404);
  const clereGlazed = clerestory.filter(() => rr() < 0.55);
  const clerePanes = paneGeometry(clereGlazed.flatMap((p) => [p, p]), (() => {
    let k = 0;
    return (g, p) => {
      const side = (k++ % 2) ? 1 : -1;
      g.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(side * NAVE.pillarX, p.sill, p.zc);
    };
  })());
  if (clerePanes.length) {
    const glassClere = new THREE.Mesh(mergeGeos(clerePanes, ['position', 'normal', 'uv']), glassMaterial);
    glassClere.name = 'glass-clerestory';
    group.add(glassClere);
  }

  // --- portal doors ---------------------------------------------------------------------------
  const doorShape = lancetPath(0, 0, 4.3, 8.5, 5.2, 14, THREE.Shape);
  const door = new THREE.ExtrudeGeometry(doorShape, { depth: 0.4, bevelEnabled: false });
  door.translate(0, 0, NAVE.zEntry - 0.3);
  const doorMesh = new THREE.Mesh(mergeGeos([door]), doorMaterial);
  doorMesh.name = 'portal';
  doorMesh.receiveShadow = true;
  group.add(doorMesh);
  const portalArch = pointedArch(4.9, 5.9, 16).map(([u, v]) => new THREE.Vector3(u, 8.5 + v, NAVE.zEntry - 0.1));
  portalArch.unshift(new THREE.Vector3(-4.9, 0, NAVE.zEntry - 0.1));
  portalArch.push(new THREE.Vector3(4.9, 0, NAVE.zEntry - 0.1));
  const portalMoulding = new THREE.Mesh(mergeGeos([
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(portalArch, false, 'catmullrom', 0.05), 60, 0.45, 6, false),
  ]), stoneWall);
  group.add(portalMoulding);

  return { group, shadowCasters, piers, walls, vault, ribs, steps, holes, clerestory, aisleGlass };
}
