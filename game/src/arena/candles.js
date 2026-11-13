// Candles: hundreds of instanced wax candles (lathe + drips), additive camera-facing flame
// billboards with per-instance flicker, wrought-iron candelabra / hearse stands and a handful of
// flickering warm point lights.
import * as THREE from 'three';
import { NAVE } from './architecture.js';
import { mergeGeos, rng } from './util.js';
import { makeCandleLightMap } from './textures.js';

/** Unit candle: radius 1, height 1, base wax puddle, melted rim and a few drips. */
function candleGeometry() {
  // kept lean (~90 triangles): there are ~1000 of these and they are drawn twice (reflection)
  const prof = [
    [1.4, 0.0], [1.0, 0.07], [1.0, 0.88], [1.04, 0.96], [0.7, 1.0], [0.0, 0.955],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const parts = [new THREE.LatheGeometry(prof, 7)];
  const r = rng(12);
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2;
    const len = r.range(0.25, 0.55);
    const s = new THREE.SphereGeometry(0.2, 4, 3);
    s.scale(1, len / 0.2, 0.75);
    s.translate(Math.cos(a) * 0.97, 0.98 - len * 0.85, Math.sin(a) * 0.97);
    parts.push(s);
  }
  return mergeGeos(parts);
}

// 4x4 ordered dither threshold for fading things out right in front of the lens
const NEAR_DITHER = /* glsl */`
float nearDither() {
  ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
  int idx = q.x + q.y * 4;
  return float(idx == 0 ? 0 : idx == 1 ? 8 : idx == 2 ? 2 : idx == 3 ? 10 : idx == 4 ? 12 : idx == 5 ? 4 : idx == 6 ? 14 : idx == 7 ? 6 :
    idx == 8 ? 3 : idx == 9 ? 11 : idx == 10 ? 1 : idx == 11 ? 9 : idx == 12 ? 15 : idx == 13 ? 7 : idx == 14 ? 13 : 5) / 16.0 + 1.0 / 32.0;
}
`;
const WAX_VERT_PARS = /* glsl */`
varying float vCandleY;
varying float vCandleSeed;
varying float vNearFade;
`;
// candles right in front of the lens (the camera pulled in against the wall clusters) dither away
const WAX_VERT = /* glsl */`
vCandleY = position.y;
#ifdef USE_INSTANCING
  vCandleSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 cOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
#else
  vCandleSeed = 0.5;
  vec3 cOrigin = (modelMatrix * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
#endif
vNearFade = smoothstep(0.8, 1.7, distance(cOrigin, cameraPosition));
`;
const WAX_FRAG_PARS = NEAR_DITHER + /* glsl */`
varying float vCandleY;
varying float vCandleSeed;
varying float vNearFade;
uniform float uWaxGlow;
uniform float uTime;
`;
const WAX_FRAG = /* glsl */`
#include <emissivemap_fragment>
if (vNearFade < 0.999 && vNearFade < nearDither()) discard;
{
  float fl = 0.85 + 0.1 * sin(uTime * 11.0 + vCandleSeed * 40.0) + 0.06 * sin(uTime * 23.0 + vCandleSeed * 13.0);
  float top = smoothstep(0.55, 1.0, vCandleY);
  totalEmissiveRadiance += vec3(1.0, 0.55, 0.22) * top * top * uWaxGlow * fl;
}
`;

export function createCandles({ quality = 'high', noise, bossSpawn, waterY = 0.06, floorRect, avoid = [], seed = 2024 }) {
  const r = rng(seed);
  const candles = []; // {x, y, z, h, rad}
  const add = (x, y, z, h, rad) => candles.push({ x, y, z, h, rad });
  const cluster = (cx, y, cz, n, spread, hMin = 0.08, hMax = 0.45) => {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
      const tall = r() < 0.15;
      add(cx + Math.cos(a) * d, y, cz + Math.sin(a) * d,
        tall ? r.range(hMax, hMax * 1.8) : r.range(hMin, hMax),
        r.range(0.022, 0.045) * (tall ? 1.25 : 1));
    }
  };
  const density = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1;
  const N = (n) => Math.max(1, Math.round(n * density));

  // --- iron stands ------------------------------------------------------------------------------
  const iron = [];
  const bar = (x0, y0, z0, x1, y1, z1, rad = 0.025) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(rad, rad, len, 5);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    g.translate(a.x, a.y, a.z);
    iron.push(g);
  };
  const candelabra = (x, z, y0 = 0) => {
    const H = 2.15;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      bar(x + Math.cos(a) * 0.38, y0, z + Math.sin(a) * 0.38, x, y0 + 0.35, z, 0.03);
    }
    bar(x, y0 + 0.3, z, x, y0 + H, z, 0.035);
    const ring = new THREE.TorusGeometry(0.32, 0.018, 5, 20);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, y0 + H - 0.05, z);
    iron.push(ring);
    const pan = new THREE.CylinderGeometry(0.09, 0.05, 0.05, 8);
    pan.translate(x, y0 + H, z);
    iron.push(pan);
    add(x, y0 + H + 0.02, z, r.range(0.35, 0.5), 0.045);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const cx = x + Math.cos(a) * 0.32, cz = z + Math.sin(a) * 0.32;
      const cup = new THREE.CylinderGeometry(0.05, 0.03, 0.04, 6);
      cup.translate(cx, y0 + H - 0.05, cz);
      iron.push(cup);
      add(cx, y0 + H - 0.03, cz, r.range(0.12, 0.32), 0.032);
    }
  };
  const hearse = (x, z, y0, rot = 0) => {
    // triangular "tenebrae hearse": two A-frames, rails at three heights carrying candles
    const W = 2.8, H = 2.5, D = 0.5;
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (u, v, w) => [x + u * c - w * s, y0 + v, z + u * s + w * c];
    for (const w of [-D / 2, D / 2]) {
      bar(...P(-W / 2, 0, w), ...P(0, H, w), 0.035);
      bar(...P(W / 2, 0, w), ...P(0, H, w), 0.035);
    }
    const rails = [[0.85, 0.66], [1.5, 0.4], [2.1, 0.16]];
    for (const [h, frac] of rails) {
      const half = (W / 2) * (1 - h / H) + 0.02;
      bar(...P(-half, h, 0), ...P(half, h, 0), 0.03);
      const n = Math.max(2, Math.round(half * 2 / 0.2));
      for (let i = 0; i <= n; i++) {
        const u = -half + (i / n) * half * 2;
        const [cx, cy, cz] = P(u, h + 0.03, 0);
        add(cx, cy, cz, r.range(0.18, 0.34) * (1 + frac * 0.5), 0.03);
      }
    }
    const [tx, ty, tz] = P(0, H + 0.02, 0);
    add(tx, ty, tz, 0.5, 0.05);
  };

  // nave-edge candelabra at the piers (alternating with the kneeling knights at mid-bay)
  for (const side of [-1, 1]) {
    for (const z of NAVE.pillarZ) {
      if (z < -30 || z > 38) continue;
      candelabra(side * 11.75, z);
    }
  }
  // hearses flanking the altar on the platform
  const PY = NAVE.platformY;
  for (const side of [-1, 1]) {
    hearse(side * 6.0, -42.6, PY, 0);
    hearse(side * 11.3, -41.8, PY, side * 0.35);
  }

  // --- floor / ledge clusters -----------------------------------------------------------------
  // around each pier plinth (nave side, on the plinth step)
  for (const side of [-1, 1]) {
    for (const z of NAVE.pillarZ) {
      if (z < -37) continue;
      const n = N(r.int(5, 9));
      for (let i = 0; i < n; i++) {
        const a = (side < 0 ? 0 : Math.PI) + r.range(-1.25, 1.25);
        const rad = r.range(1.2, 1.4);
        add(side * NAVE.pillarX + Math.cos(a) * rad, 0.92, z + Math.sin(a) * rad, r.range(0.1, 0.42), r.range(0.025, 0.045));
      }
      // puddle of candles in the water at the pier foot
      cluster(side * 12.1, 0, z + r.range(-1.6, 1.6), N(r.int(4, 9)), 0.55);
    }
  }
  // flanking the kneeling-knight slots
  for (const side of [-1, 1]) {
    for (const z of [32, 24, 16, 8, 0, -8, -16]) {
      cluster(side * r.range(11.5, 12.3), 0, z - r.range(1.2, 1.8), N(r.int(6, 12)), 0.6);
      cluster(side * r.range(11.6, 12.6), 0, z + r.range(1.2, 1.8), N(r.int(4, 9)), 0.5);
    }
  }
  // altar steps: rows near each nosing, keeping a central path clear
  for (let i = 0; i < NAVE.stepCount; i++) {
    const front = NAVE.stepsZ0 - NAVE.stepDepth * i, top = NAVE.stepRise * (i + 1);
    const n = N(i === NAVE.stepCount - 1 ? 34 : 18 + i * 2);
    for (let k = 0; k < n; k++) {
      const sx = r.sign() * r.range(1.9, 12.6);
      add(sx, top, front - r.range(0.08, 0.5), r.range(0.1, 0.5), r.range(0.025, 0.05));
    }
  }
  // altar: mensa top, front, plinths
  for (let k = 0; k < N(22); k++) add(r.range(-3.5, 3.5), PY + 1.42, -45.6 + r.range(-1.1, 1.1), r.range(0.15, 0.6), r.range(0.03, 0.06));
  for (let k = 0; k < N(40); k++) add(r.range(-4.5, 4.5), PY, -43.6 - r.range(0, 1.2) * (r() < 0.5 ? 1 : 0.3), r.range(0.1, 0.5), r.range(0.025, 0.05));
  for (const x of [-9.5, 9.5]) for (let k = 0; k < N(12); k++) add(x + r.range(-1.1, 1.1), PY + 1.8, -44.5 + r.range(-1.1, 1.1), r.range(0.1, 0.45), r.range(0.03, 0.05));
  // ring around the kneeling saint, open towards the entrance
  const bx = bossSpawn.x, bz = bossSpawn.z;
  for (let k = 0; k < 11; k++) {
    const a = THREE.MathUtils.degToRad(55 + (k / 10) * 250); // angle from +Z
    const rad = r.range(4.3, 5.6);
    cluster(bx + Math.sin(a) * rad, 0, bz + Math.cos(a) * rad, N(r.int(6, 12)), r.range(0.4, 0.75), 0.08, 0.4);
  }
  // a few scattered stragglers in the aisles
  for (let k = 0; k < N(30); k++) cluster(r.sign() * r.range(15.5, 21.5), 0, r.range(-46, 46), r.int(2, 5), 0.4);

  // --- the signature field: hundreds of tiny candles standing in / floating on the water ----------
  const floor = [];
  const hash = (x, z) => { const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return v - Math.floor(v); };
  const vnoise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const nearPier = (x, z) => NAVE.pillarZ.some((pz) => Math.hypot(Math.abs(x) - NAVE.pillarX, z - pz) < 2.05);
  const inWall = (x, z) => { const ax = Math.abs(x); return ax > 13.2 && ax < 14.8 && (z < -45.2 || z > 45.2); };
  // keep clear of the kneeling knights, the spawn point and the candelabra feet
  const keepOut = avoid.concat(NAVE.pillarZ.filter((z) => z >= -30 && z <= 38).flatMap((z) => [{ x: -11.75, z, r: 0.7 }, { x: 11.75, z, r: 0.7 }]));
  const blocked = (x, z) => keepOut.some((a) => (x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r);
  const addFloor = (x, z, kind) => {
    if (kind === 'float') floor.push({ x, y: waterY - 0.012, z, h: r.range(0.026, 0.034), rad: r.range(0.03, 0.04), float: true });
    else floor.push({ x, y: 0, z, h: r.range(0.06, 0.2), rad: r.range(0.022, 0.034), float: false });
  };
  const cell = 0.85;
  for (let z = NAVE.stepsZ0 + 0.3; z < NAVE.zEntry - 2.5; z += cell) {
    for (let x = -22.4; x < 22.4; x += cell) {
      const jx = x + r.range(-0.42, 0.42) * cell, jz = z + r.range(-0.42, 0.42) * cell;
      if (nearPier(jx, jz) || inWall(jx, jz) || blocked(jx, jz)) continue;
      const dB = Math.hypot(jx - bx, jz - bz);
      if (dB < 2.7) continue; // the saint's own spot stays clear
      const n = vnoise(jx * 0.23 + 3.1, jz * 0.23 - 7.7) * 0.75 + vnoise(jx * 0.9, jz * 0.9) * 0.25;
      let pr = 0.08 + 1.0 * Math.pow(n, 2.0);
      if (Math.abs(jx) > 14.7) pr *= 0.35; // sparse in the dark aisles
      if (dB < 9.8) pr *= 0.4; // keep the inlay readable
      if (r() < pr * density) addFloor(jx, jz, r() < 0.72 ? 'float' : 'stub');
    }
  }
  // a ritual ring of tealights on the inlay's outer band
  const ringN = Math.round(56 * Math.max(0.6, density));
  for (let k = 0; k < ringN; k++) {
    const a = (k / ringN) * Math.PI * 2 + r.range(-0.015, 0.015);
    addFloor(bx + Math.cos(a) * 10.45, bz + Math.sin(a) * 10.45, 'float');
  }

  // --- wax (instanced) ----------------------------------------------------------------------------
  const decorCount = candles.length;
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0 });
  waxMat.name = 'candle-wax';
  const waxUniforms = { uWaxGlow: { value: 0.6 }, uTime: { value: 0 } };
  waxMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waxUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WAX_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WAX_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WAX_FRAG_PARS)
      .replace('#include <emissivemap_fragment>', WAX_FRAG);
  };
  waxMat.customProgramCacheKey = () => 'arena-wax-v2';
  const wax = new THREE.InstancedMesh(candleGeometry(), waxMat, decorCount);
  wax.name = 'candles';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const col = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  candles.forEach((c, i) => {
    q.setFromAxisAngle(yAxis, r() * Math.PI * 2);
    // slight lean
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(r.range(-0.05, 0.05), 0, r.range(-0.05, 0.05)));
    q.multiply(lean);
    m.compose(p.set(c.x, c.y, c.z), q, s.set(c.rad, c.h, c.rad));
    wax.setMatrixAt(i, m);
    const t = r();
    col.setRGB(0.62 - t * 0.06, 0.55 - t * 0.08, 0.42 - t * 0.1);
    wax.setColorAt(i, col);
  });
  wax.instanceMatrix.needsUpdate = true;
  wax.instanceColor.needsUpdate = true;
  wax.computeBoundingSphere();
  wax.receiveShadow = true;
  // floor field: a much cheaper prism (24 triangles) — there are hundreds and they are mirrored
  const tiny = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false);
  tiny.translate(0, 0.5, 0);
  const floorWax = new THREE.InstancedMesh(mergeGeos([tiny]), waxMat, floor.length);
  floorWax.name = 'candles-floor';
  floor.forEach((c, i) => {
    q.setFromAxisAngle(yAxis, r() * Math.PI * 2);
    m.compose(p.set(c.x, c.y, c.z), q, s.set(c.rad, c.h, c.rad));
    floorWax.setMatrixAt(i, m);
    const t = r();
    col.setRGB(0.64 - t * 0.05, 0.57 - t * 0.07, 0.45 - t * 0.09);
    floorWax.setColorAt(i, col);
  });
  floorWax.instanceMatrix.needsUpdate = true;
  floorWax.instanceColor.needsUpdate = true;
  floorWax.computeBoundingSphere();
  const all = candles.concat(floor);
  const count = all.length;

  // --- flames (instanced billboards) --------------------------------------------------------------
  const quad = new THREE.PlaneGeometry(1, 1);
  const fgeo = new THREE.InstancedBufferGeometry();
  fgeo.index = quad.index;
  fgeo.setAttribute('position', quad.attributes.position);
  const iPos = new Float32Array(count * 3), iSize = new Float32Array(count), iSeed = new Float32Array(count);
  all.forEach((c, i) => {
    iPos[i * 3] = c.x; iPos[i * 3 + 1] = c.y + c.h * 0.985; iPos[i * 3 + 2] = c.z;
    iSize[i] = c.float ? r.range(0.018, 0.026) : THREE.MathUtils.clamp(c.rad * 0.9, 0.022, 0.05);
    iSeed[i] = r();
  });
  fgeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  fgeo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 1));
  fgeo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));
  fgeo.instanceCount = count;
  fgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 80);
  const flameMat = new THREE.ShaderMaterial({
    name: 'candle-flames',
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uBoost: { value: 0 },
      uFogDensity: { value: 0.01 },
      uViewportH: { value: 1080 },
    },
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute float iSize; attribute float iSeed;
      uniform float uTime; uniform float uBoost; uniform float uViewportH;
      varying vec2 vF; varying float vFlick; varying float vDepth; varying float vNear;
      void main() {
        float t = uTime;
        vNear = smoothstep(0.7, 1.6, distance(iPos, cameraPosition));   // fades with its candle near the lens
        float flick = 0.88 + 0.08 * sin(t * 11.0 + iSeed * 40.0) + 0.07 * sin(t * 23.7 + iSeed * 13.0) * sin(t * 3.1 + iSeed * 7.0);
        float h = iSize * (1.0 + 0.45 * uBoost) * (0.85 + 0.3 * flick);
        // never thinner than ~1.6 px: grow distant flames and dim them to keep their energy
        float zc = max(-(viewMatrix * vec4(iPos, 1.0)).z, 0.05);
        float px = h * projectionMatrix[1][1] * 0.5 * uViewportH / zc;
        float grow = max(1.0, 1.6 / max(px, 1e-3));
        h *= grow;
        vFlick = flick / pow(grow, 1.4);
        vec3 toCam = cameraPosition - iPos;
        vec3 right = vec3(toCam.z, 0.0, -toCam.x);
        float rl = length(right);
        right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
        float qw = 2.0, qh = 2.8;           // quad size in flame heights
        vec2 f = vec2(position.x * qw, (position.y + 0.5) * qh - 0.75);
        float sway = sin(t * 2.3 + iSeed * 20.0) * 0.08 * max(f.y, 0.0);
        vec3 P = iPos + right * (f.x + sway) * h + vec3(0.0, f.y * h, 0.0);
        vF = f;
        vec4 mv = viewMatrix * vec4(P, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform float uBoost; uniform float uFogDensity;
      varying vec2 vF; varying float vFlick; varying float vDepth; varying float vNear;
      void main() {
        if (vNear < 0.01) discard;
        float x = vF.x, y = vF.y;
        float w = 0.2 * sqrt(clamp(y + 0.1, 0.0, 1.5)) * (1.0 - smoothstep(0.1, 1.0, y)) + 0.015;
        float body = exp(-(x * x) / (w * w) * 1.3) * smoothstep(-0.12, 0.05, y) * (1.0 - smoothstep(0.7, 1.05, y));
        float inner = exp(-(x * x) / (w * w) * 4.0) * smoothstep(-0.02, 0.12, y) * (1.0 - smoothstep(0.3, 0.65, y));
        float r = length(vec2(x, (y - 0.35) * 0.85));
        float halo = exp(-r * r * 3.5) * 0.16 + exp(-r * 2.2) * 0.05;
        vec3 col = vec3(1.0, 0.4, 0.07) * body * 1.8 + vec3(1.0, 0.62, 0.24) * inner * 2.1 + vec3(1.0, 0.45, 0.12) * halo * 1.4;
        col *= uIntensity * vFlick * (1.0 + 0.6 * uBoost) * vNear;
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        col *= 1.0 - fogF * 0.85;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const flames = new THREE.Mesh(fgeo, flameMat);
  flames.name = 'candle-flames';
  flames.frustumCulled = false;
  flames.renderOrder = 4;

  // --- warm light splatted onto the floor (sampled by the water / stone shaders) -----------------
  const lightRect = floorRect || { x0: -24.2, x1: 24.2, z0: -52, z1: 52 };
  const lightMap = makeCandleLightMap(all.map((c) => ({ x: c.x, z: c.z, h: c.h, weight: c.float ? 0.8 : 1 })), lightRect, 0.25);

  // --- iron -----------------------------------------------------------------------------------------
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x18140f, metalness: 0.7, roughness: 0.5 });
  ironMat.name = 'iron';
  // the stands stand by the piers, right where the camera stops when it is pulled in against the wall: dither them away
  ironMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNearW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNearW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNearW;\n' + NEAR_DITHER)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n{ float nf = smoothstep(0.6, 1.5, distance(vNearW, cameraPosition)); if (nf < 0.999 && nf < nearDither()) discard; }');
  };
  ironMat.customProgramCacheKey = () => 'arena-iron-near-v1';
  const stands = new THREE.Mesh(mergeGeos(iron), ironMat);
  stands.name = 'candle-stands';
  stands.castShadow = true;
  stands.receiveShadow = true;

  // --- point lights ---------------------------------------------------------------------------------
  const lightDefs = [
    { p: [-5.2, 2.3, -38.0], i: 9, d: 18 },
    { p: [5.2, 2.3, -38.0], i: 9, d: 18 },
    { p: [bx, 1.5, bz + 6.0], i: 7, d: 14 },
    { p: [-11.3, 1.6, 8.0], i: 7, d: 15 },
    { p: [11.3, 1.6, 8.0], i: 7, d: 15 },
  ]; // (5 point lights: key + moon + hemisphere + these = 8 dynamic lights)
  const lights = lightDefs.map((L, k) => {
    const l = new THREE.PointLight(0xffa24a, L.i, L.d, 2);
    l.position.set(...L.p);
    l.userData.base = L.i;
    l.userData.phase = k * 1.7 + 0.3;
    l.castShadow = false;
    return l;
  });

  const group = new THREE.Group();
  group.name = 'candles';
  group.add(wax, floorWax, flames, stands, ...lights);

  // --- disturbance: snuff flames and knock candles over (footsteps, rolls, shockwaves); relight on reset ---
  const baseSize = iSize.slice();
  const decorN = candles.length;
  const baseMat = all.map((c, i) => { const mm = new THREE.Matrix4(); (i < decorN ? wax : floorWax).getMatrixAt(i < decorN ? i : i - decorN, mm); return mm; });
  const state = new Uint8Array(count);          // 0 lit, 1 snuffed, 2 knocked over
  const sizeAttr = fgeo.getAttribute('iSize');
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();
  function disturb(x, z, radius, { knock = false, knockRadius = radius } = {}) {
    const hit = [];
    let dirtyWax = false, dirtyFloor = false;
    for (let i = 0; i < count; i++) {
      const c = all[i];
      if (c.y > 0.5) continue;                          // candles on the altar steps / stands are out of reach
      const dx = c.x - x, dz = c.z - z, d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (state[i] === 0) { iSize[i] = 0; hit.push({ x: c.x, y: c.y + c.h, z: c.z }); state[i] = 1; }
      if (knock && state[i] < 2 && d2 <= knockRadius * knockRadius) {
        state[i] = 2;
        const d = Math.sqrt(d2) || 1;
        _ax.set(dz / d, 0, -dx / d);                    // fall away from the disturbance
        if (d2 < 1e-6) _ax.set(1, 0, 0);
        baseMat[i].decompose(_p, _q, _s);
        _q.premultiply(new THREE.Quaternion().setFromAxisAngle(_ax, 1.45 + Math.random() * 0.2));
        _p.set(c.x + dx / d * c.h * 0.4, Math.max(c.y, 0.02) + c.rad * 0.6, c.z + dz / d * c.h * 0.4);
        _m.compose(_p, _q, _s);
        if (i < decorN) { wax.setMatrixAt(i, _m); dirtyWax = true; } else { floorWax.setMatrixAt(i - decorN, _m); dirtyFloor = true; }
      }
    }
    if (hit.length) sizeAttr.needsUpdate = true;
    if (dirtyWax) wax.instanceMatrix.needsUpdate = true;
    if (dirtyFloor) floorWax.instanceMatrix.needsUpdate = true;
    return hit;
  }
  function relightAll() {
    for (let i = 0; i < count; i++) {
      if (state[i] === 2) { if (i < decorN) wax.setMatrixAt(i, baseMat[i]); else floorWax.setMatrixAt(i - decorN, baseMat[i]); }
      state[i] = 0; iSize[i] = baseSize[i];
    }
    sizeAttr.needsUpdate = true; wax.instanceMatrix.needsUpdate = true; floorWax.instanceMatrix.needsUpdate = true;
  }

  return {
    group, wax, floorWax, flames, stands, lights, count, floorCount: floor.length, lightMap, lightRect, disturb, relightAll,
    update(time, { candles: boost = 1, flare = 0, fogDensity = 0.01, viewportH = 1080 } = {}) {
      flameMat.uniforms.uViewportH.value = viewportH;
      flameMat.uniforms.uTime.value = time;
      flameMat.uniforms.uIntensity.value = boost;
      flameMat.uniforms.uBoost.value = flare;
      flameMat.uniforms.uFogDensity.value = fogDensity;
      waxUniforms.uTime.value = time;
      waxUniforms.uWaxGlow.value = 0.55 * boost * (1 + flare * 0.6);
      for (const l of lights) {
        const ph = l.userData.phase;
        const f = 0.86 + 0.07 * Math.sin(time * 9.3 + ph) + 0.05 * Math.sin(time * 23.1 + ph * 2.3) * Math.sin(time * 3.7 + ph)
          + 0.03 * Math.sin(time * 1.3 + ph * 0.7);
        l.intensity = l.userData.base * f * boost * (1 + flare * 0.5);
      }
    },
  };
}
