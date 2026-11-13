// 长夜圣堂 — boss arena: a vast ruined gothic nave lit by one enormous rose window.
// Contract: see ARCHITECTURE.md (`src/arena.js`). Helpers live in ./arena/*.js.
import * as THREE from 'three';
import { NAVE, buildArchitecture } from './arena/architecture.js';
import { createStoneMaterial, withArenaAO, ARENA_SHARED } from './arena/materials.js';
import {
  makeNoiseTexture, makeStoneFloorTexture, makeStoneWallTexture, makeRoseWindowTexture,
  makeTransmissionTexture, makeBannerTexture, makeWoodTexture, makeLancetGlassTexture, configureAlbedo,
  makeMandalaTexture,
} from './arena/textures.js';
import { createMoonShafts, MOON_DIR } from './arena/moonlight.js';
import { createWater } from './arena/water.js';
import { createRoseWindow } from './arena/rosewindow.js';
import { createCandles } from './arena/candles.js';
import { createProps } from './arena/props.js';
import { createParticles } from './arena/particles.js';
import { createSky } from './arena/sky.js';
import { buildEnvironmentMaps } from './arena/envmap.js';
import { disposeTree, rng } from './arena/util.js';

const BOUNDS = { minX: -11, maxX: 11, minZ: -36, maxZ: 44 };
const FLOOR_Y = 0;
const WATER_Y = 0.06;
const KEY_ELEVATION = THREE.MathUtils.degToRad(NAVE.keyElevationDeg); // below horizontal, towards +Z
const TRANSITION_TAU = 0.8; // s; ~95% of a phase change after 2.4 s
const BOUNCE = 0.035; // share of the key light re-emitted by the sunlit floor pool onto the architecture

// Per-phase targets. Colours are linear RGB. Look: night-blue / teal ambient (moonlight through the
// side windows, blue-black aisles) against warm golden candlelight; the rose window stays readable
// glass and its light only appears where it actually falls.
const NIGHT = {
  hemiSky: [0.1, 0.24, 0.62], hemiGround: [0.012, 0.016, 0.026],
  fog: [0.006, 0.012, 0.02], fogDensity: 0.008,
};
const PHASES = [
  { // 0 pre-fight: dim, cold, very still
    window: 0.9, windowTint: [0.8, 0.9, 1.1], hot: 0.25, halo: 0.035, haloTint: [0.6, 0.75, 1.0],
    beam: 0.03, beamTint: [0.7, 0.84, 1.0], streak: 0.85, beamMax: 0.1, rays: 0.0, fogGlow: 0.03,
    key: 2.6, keyColor: [0.7, 0.8, 1.0], hemi: 0.2, hemiSky: NIGHT.hemiSky, hemiGround: NIGHT.hemiGround, env: 0.42,
    candles: 1.0, candleFlare: 0, candleLight: 1.7, moon: 0.6, moonShafts: 0.012,
    fog: NIGHT.fog, fogDensity: NIGHT.fogDensity,
    dust: 0.6, dustSpeed: 0.22, ash: 0.45, dustTint: [0.8, 0.9, 1.0],
    stir: 0.0, drips: 0.0, wind: 0.12, sky: 1.0, dawn: 0, warm: 0,
  },
  { // 1 fight (the window a little lower than the pre-fight hush so her raised blade reads against it)
    window: 0.86, windowTint: [0.95, 0.97, 1.03], hot: 0.22, halo: 0.04, haloTint: [0.85, 0.9, 1.0],
    beam: 0.03, beamTint: [0.84, 0.91, 1.0], streak: 0.85, beamMax: 0.1, rays: 0.0, fogGlow: 0.035,
    key: 3.0, keyColor: [0.82, 0.88, 1.0], hemi: 0.2, hemiSky: NIGHT.hemiSky, hemiGround: NIGHT.hemiGround, env: 0.45,
    candles: 1.0, candleFlare: 0, candleLight: 1.7, moon: 0.6, moonShafts: 0.012,
    fog: NIGHT.fog, fogDensity: NIGHT.fogDensity,
    dust: 0.8, dustSpeed: 1.0, ash: 0.8, dustTint: [0.88, 0.94, 1.0],
    stir: 0.25, drips: 0.35, wind: 0.5, sky: 1.0, dawn: 0, warm: 0,
  },
  { // 2 phase two: the window flares warmer gold, stronger shafts, candles flare
    window: 0.8, windowTint: [1.02, 0.9, 0.74], hot: 0.2, halo: 0.045, haloTint: [1.0, 0.84, 0.6],
    beam: 0.036, beamTint: [1.02, 0.88, 0.68], streak: 0.85, beamMax: 0.115, rays: 0.0, fogGlow: 0.035,
    key: 3.3, keyColor: [1.0, 0.82, 0.56], hemi: 0.15, hemiSky: [0.24, 0.3, 0.46], hemiGround: [0.04, 0.03, 0.02], env: 0.55,
    candles: 1.2, candleFlare: 1, candleLight: 2.1, moon: 0.45, moonShafts: 0.009,
    fog: [0.014, 0.012, 0.014], fogDensity: 0.0085,
    dust: 0.95, dustSpeed: 1.6, ash: 1.0, dustTint: [1.1, 0.88, 0.58],
    stir: 0.4, drips: 0.6, wind: 0.9, sky: 1.0, dawn: 0, warm: 1,
  },
  { // 3 victory: dawn floods the nave
    window: 1.22, windowTint: [1.2, 0.88, 0.62], hot: 0.28, halo: 0.11, haloTint: [1.2, 0.85, 0.55],
    beam: 0.085, beamTint: [1.15, 0.86, 0.62], streak: 0.8, beamMax: 0.3, rays: 0.0, fogGlow: 0.08,
    key: 6.0, keyColor: [1.0, 0.78, 0.56], hemi: 0.5, hemiSky: [0.75, 0.58, 0.46], hemiGround: [0.1, 0.07, 0.05], env: 1.0,
    candles: 0.7, candleFlare: 0, candleLight: 0.9, moon: 0.0, moonShafts: 0.0,
    fog: [0.045, 0.034, 0.028], fogDensity: 0.0075,
    dust: 1.1, dustSpeed: 0.45, ash: 0.3, dustTint: [1.15, 0.9, 0.65],
    stir: 0.08, drips: 0.1, wind: 0.3, sky: 1.0, dawn: 1, warm: 2,
  },
];

const QUALITY = {
  high: { shadow: 2048 },
  medium: { shadow: 2048 },
  low: { shadow: 1024 },
};

function cloneParams(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) o[k] = Array.isArray(v) ? v.slice() : v;
  return o;
}

export async function createArena({ scene, renderer, textures = {}, quality = 'high' }) {
  if (!QUALITY[quality]) quality = 'high';
  const Q = QUALITY[quality];
  const owned = []; // disposables created here
  renderer.shadowMap.enabled = true;

  // --- textures ------------------------------------------------------------------------------------
  const noise = makeNoiseTexture(256);
  owned.push(noise);
  const ext = new Set([textures.roseWindow, textures.stoneFloor, textures.stoneWall].filter(Boolean));
  const stoneFloorTex = configureAlbedo(textures.stoneFloor, renderer) || makeStoneFloorTexture(renderer);
  const stoneWallTex = configureAlbedo(textures.stoneWall, renderer) || makeStoneWallTexture(renderer);
  let roseTex = textures.roseWindow || null;
  if (roseTex) {
    roseTex.colorSpace = THREE.SRGBColorSpace;
    roseTex.wrapS = roseTex.wrapT = THREE.ClampToEdgeWrapping;
    roseTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (roseTex.image) roseTex.needsUpdate = true;
  } else {
    roseTex = makeRoseWindowTexture(renderer);
  }
  let transmission;
  try {
    transmission = makeTransmissionTexture(roseTex.image, 256);
  } catch (e) {
    console.warn('[arena] rose window image unreadable, using procedural transmission', e);
    roseTex = makeRoseWindowTexture(renderer);
    transmission = makeTransmissionTexture(roseTex.image, 256);
  }
  const bannerTex = makeBannerTexture(renderer);
  const woodTex = makeWoodTexture(renderer);
  const glassTex = makeLancetGlassTexture(renderer, 256, 768, 9, 0.14);
  const endGlassTex = makeLancetGlassTexture(renderer, 256, 768, 17, 0.0);
  for (const t of [stoneFloorTex, stoneWallTex, roseTex, transmission, bannerTex, woodTex, glassTex, endGlassTex]) if (!ext.has(t)) owned.push(t);

  // --- materials ---------------------------------------------------------------------------------
  const stoneWall = createStoneMaterial({
    map: stoneWallTex, noise, scale: 1 / 4.2, tint: [0.8, 0.87, 0.98], desat: 0.55, roughness: 0.9,
    grime: 0.55, darkTop: [14, 40, 0.28], wet: 0.7, bump: 1.4, macro: 0.25, name: 'stone-wall',
  });
  const stoneDark = createStoneMaterial({
    map: stoneWallTex, noise, scale: 1 / 5, tint: [0.66, 0.74, 0.86], desat: 0.6, roughness: 0.95,
    grime: 0.6, darkTop: [30, 46, 0.4], wet: 0, bump: 0.8, macro: 0.3, side: THREE.DoubleSide, name: 'stone-vault',
  });
  const stoneFloor = createStoneMaterial({
    map: stoneFloorTex, noise, scale: 1 / 4.6, tint: [0.82, 0.87, 0.95], desat: 0.4, roughness: 0.8,
    grime: 0.2, darkTop: [10, 20, 1.0], wet: 0.25, bump: 1.0, macro: 0.2, name: 'stone-floor',
  });
  const fogUniforms = () => ({
    fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0.01 },
  });
  const makeGlassMat = (map, intensity, tint, name) => new THREE.ShaderMaterial({
    name,
    uniforms: Object.assign(fogUniforms(), {
      uMap: { value: map }, uIntensity: { value: intensity }, uTint: { value: new THREE.Color(...tint) },
    }),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uMap; uniform float uIntensity; uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.5) discard;
        float g = 0.75 + 0.5 * smoothstep(0.0, 1.0, vUv.y);
        vec3 c = mix(t.rgb, vec3(dot(t.rgb, vec3(0.3, 0.59, 0.11))), 0.65); // moonlit glass: mostly colourless
        gl_FragColor = vec4(c * uIntensity * uTint * g, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: true,
  });
  const glassMat = makeGlassMat(glassTex, 0.42, [0.46, 0.64, 1.0], 'glass-moonlit');
  const endGlassMat = makeGlassMat(endGlassTex, 0.45, [0.82, 0.88, 1.0], 'glass-end');
  const doorMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x5a4636, roughness: 0.8, metalness: 0 });
  doorMat.name = 'door';
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x17130f, metalness: 0.7, roughness: 0.5 });
  ironMat.name = 'iron-props';

  // --- scene graph ---------------------------------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'arena';
  scene.add(group);

  const arch = buildArchitecture({
    stoneWall, stoneFloor, stoneDark, glassMaterial: glassMat, clereGlassMaterial: endGlassMat, doorMaterial: doorMat, quality,
  });
  group.add(arch.group);

  const bossSpawn = { x: 0, z: -22, yaw: Math.PI };
  const playerSpawn = { x: 0, z: 38, yaw: Math.PI };
  const floorRect = { x0: -NAVE.aisleWallX - 0.2, x1: NAVE.aisleWallX + 0.2, z0: NAVE.zEnd - 0.2, z1: NAVE.zEntry + 0.2 };
  const mandalaTex = makeMandalaTexture(quality === 'low' ? 1024 : 2048, 10.6);
  owned.push(mandalaTex);
  const water = createWater({
    floorMap: stoneFloorTex, noise, waterY: WATER_Y, quality, rect: floorRect,
    mandala: { texture: mandalaTex, x: bossSpawn.x, z: bossSpawn.z, extent: mandalaTex.userData.extent },
  });
  group.add(water.mesh);

  const roseCenter = new THREE.Vector3(NAVE.rose.x, NAVE.rose.y, NAVE.rose.z);
  const lightDir = new THREE.Vector3(0, -Math.sin(KEY_ELEVATION), Math.cos(KEY_ELEVATION));
  const rose = createRoseWindow({
    map: roseTex, transmission, noise, center: roseCenter, radius: NAVE.rose.r, dir: lightDir, floorY: WATER_Y, quality,
  });
  group.add(rose.group);

  // knights kneel at mid-bay along both sides of the aisle, just outside the walkable strip
  const waxKnightSlots = [];
  for (const z of [32, 24, 16, 8, 0, -8, -16]) {
    waxKnightSlots.push({ x: -12.0, z, yaw: Math.PI });
    waxKnightSlots.push({ x: 12.0, z, yaw: Math.PI });
  }
  const candles = createCandles({
    quality, noise, bossSpawn, waterY: WATER_Y, floorRect,
    avoid: [...waxKnightSlots.map((k) => ({ x: k.x, z: k.z, r: 1.15 })), { x: playerSpawn.x, z: playerSpawn.z, r: 1.6 }],
  });
  group.add(candles.group);
  owned.push(candles.lightMap);
  ARENA_SHARED.arenaCandleMap.value = candles.lightMap;
  ARENA_SHARED.arenaCandleRect.value.set(floorRect.x0, floorRect.z0, 1 / (floorRect.x1 - floorRect.x0), 1 / (floorRect.z1 - floorRect.z0));

  const moon = createMoonShafts({ noise, floorY: WATER_Y, clerestory: arch.clerestory });
  group.add(moon.mesh);

  const props = createProps({ bannerTex, woodTex, stoneMat: stoneWall, ironMat, quality });
  group.add(props.group);

  const particles = createParticles({
    beam: { center: roseCenter, radius: NAVE.rose.r, dir: lightDir, tMax: rose.tMax, transmission },
    floorY: WATER_Y, quality,
  });
  group.add(particles.group);
  // the mirror shows the window, candles and architecture — not the haze (keeps the floor a dark mirror)
  water.noReflect.push(particles.dust, particles.ash, rose.beam, rose.rays, moon.mesh);

  const sky = createSky({ noise });
  group.add(sky.mesh);

  // deep aisles: occlude indirect light on everything lit that the arena owns
  const aoDone = new Set([stoneWall, stoneDark, stoneFloor]);
  group.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (aoDone.has(m) || !(m.isMeshStandardMaterial)) continue;
      aoDone.add(m);
      withArenaAO(m);
    }
  });

  // --- lights ----------------------------------------------------------------------------------------
  const keyLight = new THREE.DirectionalLight(0xdde6ff, 3);
  keyLight.name = 'arena-key-light';
  const keyTarget = new THREE.Vector3(0, 0, -6);
  keyLight.position.copy(keyTarget).addScaledVector(lightDir, -120);
  keyLight.target.position.copy(keyTarget);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(Q.shadow, Q.shadow);
  const sc = keyLight.shadow.camera;
  // light-space extents: x is world x; vertical is (z - keyTarget.z) * sin(elev) on the floor.
  // covers the walkable strip plus the kneeling knights at x = +-12 (arena surfaces outside it are
  // masked analytically, see materials.js arenaKeyMask)
  sc.left = BOUNDS.minX - 2.2;
  sc.right = BOUNDS.maxX + 2.2;
  sc.top = (BOUNDS.maxZ + 7 - keyTarget.z) * Math.sin(KEY_ELEVATION);
  sc.bottom = (BOUNDS.minZ - 3 - keyTarget.z) * Math.sin(KEY_ELEVATION);
  sc.near = 1;
  sc.far = 190;
  sc.updateProjectionMatrix();
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.035;
  keyLight.shadow.radius = 2.2;
  group.add(keyLight, keyLight.target);

  const hemi = new THREE.HemisphereLight(0x4a6a9a, 0x050608, 0.16);
  hemi.name = 'arena-fill';
  group.add(hemi);

  // cold moonlight from the left (no shadows). On arena surfaces it is masked analytically to the
  // clerestory / aisle lancet projections (materials.js arenaMoonMask); characters get a cold rim.
  const moonLight = new THREE.DirectionalLight(0x7393ff, 0.9);
  moonLight.name = 'arena-moon';
  moonLight.color.setRGB(0.45, 0.62, 1.0);
  moonLight.position.copy(MOON_DIR).multiplyScalar(-60);
  moonLight.target.position.set(0, 0, 0);
  moonLight.castShadow = false;
  group.add(moonLight, moonLight.target);

  // --- atmosphere --------------------------------------------------------------------------------------
  const fog = new THREE.FogExp2(0x02030a, NIGHT.fogDensity);
  const prevFog = scene.fog, prevBg = scene.background, prevEnv = scene.environment, prevEnvI = scene.environmentIntensity;
  scene.fog = fog;
  scene.background = new THREE.Color(0x020304);
  const envMaps = buildEnvironmentMaps(renderer);
  scene.environment = envMaps.cold;
  let envKey = 'cold';

  // --- phase state ------------------------------------------------------------------------------------
  let phase = 0;
  const target = cloneParams(PHASES[0]);
  const cur = cloneParams(PHASES[0]);
  let flarePulse = 0;
  let windowDim = 0;     // 0..1, set through the returned api (the opening MV dims the window on 'God never answered')
  let time = 0;
  let dustClock = 0;
  let dripTimer = 2;
  const rnd = rng(4242);
  const tmpColor = new THREE.Color();
  const tmpColor2 = new THREE.Color();
  const size = new THREE.Vector2();

  function setPhase(p) {
    p = THREE.MathUtils.clamp(Math.round(Number(p) || 0), 0, PHASES.length - 1);
    if (p === 2 && phase < 2) flarePulse = 1;
    phase = p;
    Object.assign(target, cloneParams(PHASES[p]));
  }

  function apply() {
    const f = flarePulse * flarePulse;
    const lit = 1 - THREE.MathUtils.clamp(windowDim, 0, 1);   // cinematics can let the window go dark
    rose.set({
      window: (cur.window + f * 0.7) * lit,
      windowTint: tmpColor.setRGB(...cur.windowTint),
      hot: (cur.hot + f * 0.5) * lit,
      halo: (cur.halo + f * 0.25) * lit,
      haloTint: tmpColor2.setRGB(...cur.haloTint),
      beam: (cur.beam + f * 0.05) * lit,
      beamMax: (cur.beamMax + f * 0.15) * lit,
      rays: cur.rays,
      streak: cur.streak,
      time,
    });
    rose.set({ beamTint: tmpColor.setRGB(...cur.beamTint) });
    keyLight.intensity = cur.key + f * 2.5;
    keyLight.color.setRGB(...cur.keyColor);
    ARENA_SHARED.arenaBounce.value.copy(keyLight.color).multiplyScalar(keyLight.intensity * BOUNCE);
    ARENA_SHARED.arenaFogGlow.value.setRGB(...cur.beamTint).multiplyScalar(cur.fogGlow * (1 + f));
    hemi.intensity = cur.hemi;
    hemi.color.setRGB(...cur.hemiSky);
    hemi.groundColor.setRGB(...cur.hemiGround);
    moonLight.intensity = cur.moon;
    moon.update(time, cur.moonShafts);
    const flick = 0.92 + 0.05 * Math.sin(time * 7.3) + 0.03 * Math.sin(time * 17.9 + 1.3);
    ARENA_SHARED.arenaCandleColor.value.setRGB(1.0, 0.56, 0.22).multiplyScalar(cur.candleLight * flick * (1 + 0.5 * cur.candleFlare));
    if (scene.fog === fog) {
      fog.color.setRGB(...cur.fog);
      fog.density = cur.fogDensity;
      if (scene.background && scene.background.isColor) scene.background.copy(fog.color);
    }
    const wantEnv = cur.warm < 0.5 ? 'cold' : cur.warm < 1.5 ? 'gold' : 'dawn';
    if (wantEnv !== envKey && scene.environment === envMaps[envKey]) {
      scene.environment = envMaps[wantEnv];
    }
    envKey = wantEnv;
    if (scene.environment && Object.values(envMaps).includes(scene.environment)) scene.environmentIntensity = cur.env;
    sky.update(time, cur.dawn, cur.sky);
    water.uniforms.wStir.value = cur.stir;
  }

  function update(dt = 1 / 60, elapsed, camera) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    time = Number.isFinite(elapsed) ? elapsed : time + dt;
    const k = 1 - Math.exp(-dt / TRANSITION_TAU);
    for (const key of Object.keys(target)) {
      const t = target[key];
      if (Array.isArray(t)) for (let i = 0; i < t.length; i++) cur[key][i] += (t[i] - cur[key][i]) * k;
      else cur[key] += (t - cur[key]) * k;
    }
    flarePulse = Math.max(0, flarePulse - dt / 1.8);
    dustClock += dt * cur.dustSpeed;
    apply();

    renderer.getDrawingBufferSize(size);
    water.update(time);
    candles.update(time, { candles: cur.candles, flare: cur.candleFlare + flarePulse * 0.6, fogDensity: fog.density, viewportH: size.y });
    particles.update(dustClock, {
      speed: 1, dustIntensity: cur.dust, ashIntensity: cur.ash, viewportH: size.y,
      dustTint: tmpColor.setRGB(...cur.dustTint),
    });
    props.update(time, cur.wind);

    // drops from the broken vault now and then
    if (cur.drips > 0.02) {
      dripTimer -= dt * cur.drips;
      if (dripTimer <= 0) {
        dripTimer = rnd.range(0.6, 2.2);
        const h = rnd.pick(arch.holes);
        const x = THREE.MathUtils.clamp(h.x + rnd.gauss() * h.rx * 0.5, BOUNDS.minX, BOUNDS.maxX);
        const z = THREE.MathUtils.clamp(h.z + rnd.gauss() * h.rz * 0.5, BOUNDS.minZ, BOUNDS.maxZ);
        water.ripple(x, z, rnd.range(0.15, 0.4));
      }
    }
    void camera;
  }

  function ripple(x, z, strength = 1) {
    water.ripple(x, z, strength);
  }

  /** Snuff (and optionally knock over) the floor candles within `radius` of (x, z); returns snuffed flame positions. */
  function disturbCandles(x, z, radius, opts) { return candles.disturb(x, z, radius, opts); }
  function relightCandles() { candles.relightAll(); }

  function dispose() {
    scene.remove(group);
    disposeTree(group, ext);
    water.dispose();
    rose.dispose();
    for (const t of owned) t.dispose();
    for (const m of Object.values(envMaps)) m.dispose();
    keyLight.shadow.dispose();
    if (scene.fog === fog) scene.fog = prevFog || null;
    if (Object.values(envMaps).includes(scene.environment)) {
      scene.environment = prevEnv || null;
      scene.environmentIntensity = prevEnvI;
    }
    if (scene.background && scene.background.isColor && scene.background !== prevBg) scene.background = prevBg || null;
    if (ARENA_SHARED.arenaCandleMap.value === candles.lightMap) ARENA_SHARED.arenaCandleMap.value = null;
  }

  setPhase(0);
  apply();

  return {
    bounds: { ...BOUNDS },
    colliders: [],
    floorY: FLOOR_Y,
    waterY: WATER_Y,
    playerSpawn,
    bossSpawn,
    roseWindow: { center: roseCenter.clone(), radius: NAVE.rose.r },
    keyLight,
    waxKnightSlots,
    update,
    setPhase,
    ripple,
    disturbCandles,
    relightCandles,
    dispose,
    // camera collision: the camera stays in the nave, in front of the pier faces (the side aisles behind the arcade
    // are dark and cluttered: wall bases, aisle candles), and never inside a pier or the end walls
    cameraBlockers: {
      circles: [-1, 1].flatMap(side => NAVE.pillarZ.map(z => ({ x: side * NAVE.pillarX, z, r: 1.4 }))),
      bounds: { minX: -(NAVE.pillarX - 1.6), maxX: NAVE.pillarX - 1.6, minZ: NAVE.zEnd + 1.4, maxZ: NAVE.zEntry - 1.4 },
    },
    get windowDim() { return windowDim; },
    set windowDim(v) { windowDim = +v || 0; },
    // extras (not part of the contract)
    group,
    get phase() { return phase; },
    lightDirection: lightDir.clone(),
    moonLight,
    stats: { candles: candles.count, floorCandles: candles.floorCount },
  };
}
