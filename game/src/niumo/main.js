// 火焰山 · 牛魔 — bootstrap, renderer + post chain, module and asset loading (with fallbacks), the game's state machine,
// hitstop / slow motion, pause + settings, debug hooks.
//
// Flow (docs/niumo_architecture.md §5):
//   splash (点击开始) → mv (ONE opening cinematic: the prologue, the walk in under his knee, the title, his eyes
//   opening, the spoken exchange, the roar; it ends on the fight camera) → fight → transition (山崩, at half health)
//   → fight (phase two) → ending (rain);  death → retry straight into the fight (no cinematic).
// URL flags: ?skipmv / ?skipintro (no cinematic: straight to the fight) ?god ?debug ?autostart (no click: starts at
// once) (?quality=low|high, ?mv = ?autostart).
// Debug: window.__niumo (always exposed; ?debug adds an overlay and keeps the game running when the pointer is freed).
//
// The other modules (arena, bull, monkey, input, camera) are loaded dynamically. A module that is missing or broken is
// replaced by a minimal local stub (bottom of this file, marked STUB) and recorded in __niumo.fallbacks — the smoke test
// fails on any. Missing art falls back to placeholders (recorded in __niumo.assetFallbacks).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { loadCharacter, loadBlade } from '../assets.js';
import { Actor } from '../actor.js';
import { FX } from '../fx.js';
import { updateLooks } from '../look.js';
import { separate, horizDist } from '../combat.js';
import { PoseTrack } from '../pose.js';
// shared engine pieces used only by the stubs below
import { CameraRig } from '../camera.js';
import { Input } from '../input.js';
import { Player } from '../player.js';
import { HEROINE, HOLD_P } from '../moves.js';
import { NiumoUI } from './ui.js';
import { OpeningMV, titleCamera, MV_CUES, cuesFromScore } from './mv.js';
import { CollapseScene, EndingScene, EyeGlow, VoiceLines, safeSpot } from './cutscenes.js';

const Q = new URLSearchParams(location.search);
const FLAG = {
  skipmv: Q.has('skipmv'), skipintro: Q.has('skipintro'), god: Q.has('god'), debug: Q.has('debug'),
  autostart: Q.has('autostart'), mv: Q.has('mv'), quality: Q.get('quality') || 'high',
  stub: new Set((Q.get('stub') || '').split(',').filter(Boolean)),     // dev: force local stubs, e.g. ?stub=bull,arena
};
const $ = s => document.querySelector(s);

export const SCALE = { bull: 40, bullSeated: 22, monkey: 1.5, staff: 1.9, bullStaff: 30 };
const FIGHT_START = 28;        // m in front of the seat: where a retry (and ?skipintro) puts the monkey

// ------------------------------------------------------------------ renderer + post

const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0605);
scene.fog = new THREE.FogExp2(0x160c08, 0.006);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2400);

const pmrem = new THREE.PMREMGenerator(renderer);
/** Reflection environment for the volcano (used when the arena brings none): smoke-dark sky, dull red horizon, lava glow below. */
function volcanoEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ float h = vP.y;
      vec3 c = mix(vec3(0.05, 0.022, 0.014), vec3(0.012, 0.01, 0.012), smoothstep(0.05, 0.8, h));   // dull red horizon -> smoke
      c += vec3(0.16, 0.05, 0.015) * smoothstep(0.1, -0.5, h);                                       // lava bounce from below
      gl_FragColor = vec4(c, 1.0); }`,
  })));
  for (let i = 0; i < 9; i++) {      // a few embers / lava pools low around the horizon
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.9, 0.25) }));
    const a = i / 9 * Math.PI * 2; m.position.set(Math.cos(a) * 30, -6 - (i % 3) * 3, Math.sin(a) * 30); env.add(m);
  }
  return pmrem.fromScene(env, 0.03).texture;
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// depth of field: cutscenes and the MV only
const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.002, maxblur: 0.01 });
bokeh.enabled = false;
composer.addPass(bokeh);
// restrained bloom: only lava cracks, eyes, sparks and the phase-two eruption are bright enough to reach it
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.9);
composer.addPass(bloom);
// the grade (linear HDR, before ACES): split toning, warm/cool from the arena's hints, haze, heat shimmer, vignette,
// hurt edge, flash, grain
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uFlash: { value: 0 }, uAberr: { value: 0 },
    uVignette: { value: 0.55 }, uWarm: { value: 0.15 }, uDesat: { value: 0.14 }, uHaze: { value: 0.3 }, uHeat: { value: 0 },
    uHazeCol: { value: new THREE.Color(0.055, 0.032, 0.026) }, uFlashCol: { value: new THREE.Color(3.0, 2.3, 1.7) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uFlash, uAberr, uVignette, uWarm, uDesat, uHaze, uHeat;
    uniform vec3 uHazeCol, uFlashCol; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      if (uHeat > 0.001) {   // heat shimmer, strongest low in the frame (over the lava)
        float k = uHeat * (1.0 - smoothstep(0.05, 0.85, uv.y));
        uv += k * vec2(sin(uv.y * 92.0 + uTime * 5.3) + 0.6 * sin(uv.y * 41.0 - uTime * 3.1 + uv.x * 13.0),
                       cos(uv.x * 63.0 + uTime * 4.2)) * 0.0022;
      }
      vec2 c = uv - 0.5; float r = length(c);
      vec2 off = c * (0.004 * uAberr + 0.0005);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      // cool steel in the shadows, ember in the highlights
      col *= mix(vec3(0.88, 0.93, 1.08), vec3(1.07, 0.98, 0.88), smoothstep(0.02, 0.9, l));
      // warm (+) / cool (-) from the arena's phase
      col = mix(col, col * (uWarm >= 0.0 ? vec3(1.12, 0.97, 0.80) : vec3(0.82, 0.94, 1.1)), abs(uWarm));
      // haze: the smoke lifts the deep shadows a little (aerial perspective is the arena's fog; this is the air in the lens)
      col = mix(col, uHazeCol, uHaze * 0.25 * (1.0 - smoothstep(0.0, 0.5, l)));
      col = max(col - 0.003, 0.0) * 1.03;
      col *= 1.0 - uVignette * smoothstep(0.3, 0.86, r);
      col = mix(col, col * vec3(1.0, 0.3, 0.22) + vec3(0.22, 0.0, 0.0) * smoothstep(0.35, 0.8, r), uHurt * smoothstep(0.25, 0.75, r));
      col = mix(col, uFlashCol, uFlash);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.016;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());
const fxaa = new FXAAPass();
composer.addPass(fxaa);

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ loading (modules with stubs, assets with placeholders)

const loadEl = $('#load');
const setLoad = s => { loadEl.textContent = s; };
const fallbacks = [];          // [{ what, why }] a module replaced by a stub (or an audio state / sfx by a stand-in)
const assetFallbacks = [];     // [string] placeholder art in use

async function tryImport(path, what) {
  if (FLAG.stub.has(what)) { fallbacks.push({ what, why: 'forced by ?stub=' }); return null; }
  try { return await import(path); } catch (e) {
    fallbacks.push({ what, why: String(e && e.message || e) });
    console.info(`[niumo] ${what}: module unavailable, using the local stub`);
    return null;
  }
}

async function loadArena() {
  const mod = await tryImport('./arena.js', 'arena');
  if (mod && mod.createVolcanoArena) {
    try { return await mod.createVolcanoArena({ scene, renderer, quality: FLAG.quality }); } catch (e) {
      console.error('[niumo] createVolcanoArena failed', e);
      fallbacks.push({ what: 'arena', why: 'createVolcanoArena threw: ' + (e && e.message) });
    }
  } else if (mod) fallbacks.push({ what: 'arena', why: 'arena.js has no createVolcanoArena export' });
  return createStubArena({ scene });
}

/** The darkened placeholder for the bull (the cathedral saint, turned to basalt). */
function basaltPlaceholder(model) {
  model.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const m = o.material;
    if (m.color) m.color.multiply(new THREE.Color(0.2, 0.165, 0.145));
    if ('roughness' in m) { m.roughness = 0.92; m.metalness = 0.12; }
    if (m.emissive) { m.emissive.setRGB(0.012, 0.003, 0.001); }
    m.envMapIntensity = 0.6;
  });
}

async function loadBullChar() {
  try { return await loadCharacter('assets/models/niumo_bull.glb', { height: SCALE.bull, cleanArms: false }); } catch {
    assetFallbacks.push('niumo_bull.glb → boss_p2.glb (darkened, 40 m)');
    const c = await loadCharacter('assets/models/boss_p2.glb', { height: SCALE.bull });
    c.placeholder = true;          // darkened by makeBull() when the stub bull wears it (bull.js repaints it itself)
    return c;
  }
}

async function loadMonkeyChar() {
  try { return await loadCharacter('assets/models/niumo_monkey.glb', { height: SCALE.monkey }); } catch {
    assetFallbacks.push('niumo_monkey.glb → heroine.glb (1.5 m)');
    const c = await loadCharacter('assets/models/heroine.glb', { height: SCALE.monkey });
    c.placeholder = true;
    return c;
  }
}

/** Procedural iron staff: dark hammered iron, worn gold (monkey) or riveted bronze bands crusted with lava (bull). */
export function makeIronStaff(length, gripFrac, { bull = false } = {}) {
  const r = bull ? length * 0.016 : length * 0.0145;
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  holder.add(inner);
  inner.position.y = -length * gripFrac;                 // the butt end; the grip sits at the holder's origin
  const iron = new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 0.62, metalness: 0.85 });
  const band = new THREE.MeshStandardMaterial(bull ? { color: 0x3d4a3e, roughness: 0.7, metalness: 0.75 } : { color: 0x6b5730, roughness: 0.5, metalness: 1.0 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length, 14, 1), iron);
  shaft.position.y = length / 2; inner.add(shaft);
  const bands = bull ? [0.02, 0.18, 0.36, 0.64, 0.82, 0.98] : [0.035, 0.965];
  for (const f of bands) {
    const h = bull ? length * 0.035 : length * 0.07;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.22, r * 1.22, h, 14, 1), band);
    b.position.y = length * f; inner.add(b);
  }
  if (bull) {     // the head is crusted with cooled lava, a little heat left in the cracks
    const crust = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 1.9, 1), new THREE.MeshStandardMaterial({
      color: 0x120d0b, roughness: 0.95, emissive: new THREE.Color(0.5, 0.09, 0.02), emissiveIntensity: 0.12 }));
    crust.scale.set(1, 1.6, 1); crust.position.y = length * 0.99; inner.add(crust);
  }
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  holder.userData = { length, gripFrac, bladeLength: length * (1 - gripFrac), procedural: true };
  return holder;
}

async function loadStaff(length, gripFrac, opts) {
  try { return await loadBlade('assets/models/niumo_staff.glb', { length, gripFrac }); } catch {
    const tag = 'niumo_staff.glb → procedural iron staff';
    if (!assetFallbacks.includes(tag)) assetFallbacks.push(tag);
    return makeIronStaff(length, gripFrac, opts);
  }
}

/** Audio: the shared AudioSystem; niumo states / sfx the build does not have yet map to stand-ins (recorded). */
async function loadAudio() {
  let mod = null;
  try { mod = await import('../audio.js'); } catch (e) { console.error('[niumo] audio.js failed', e); }
  if (!mod) {
    fallbacks.push({ what: 'audio', why: 'audio.js unavailable' });
    const noop = () => {};
    return { audio: { unlock: async () => {}, ready: false, musicState: 'off', setMusic: noop, play: noop, setListener: noop, duck: noop, setMuffle: noop, setVolumes: noop, update: noop }, cues: null };
  }
  const sys = new mod.AudioSystem();
  const music = new Set(mod.MUSIC_STATES || []), sfx = new Set(mod.SFX_NAMES || []);
  const MUSIC_STAND_IN = { niumo_opening: 'tension', niumo_ambient: 'tension', niumo_phase1: 'phase1', niumo_phase2: 'phase2', niumo_ending: 'victory', niumo_defeat: 'defeat' };
  const SFX_STAND_IN = {
    staff_swing: 'swing_heavy', staff_hit: 'hit_heavy', staff_hit_heavy: 'hit_heavy', bull_roar: 'phase_shift', bull_stomp: 'boss_step',
    bull_slam: 'boss_slam', fire_breath: 'pillar_charge', fan_wind: 'swing_light', lava_burst: 'pillar_blast', rock_crack: 'wax_crack', rain: null,
  };
  const noted = new Set();
  const note = (kind, name, to) => {
    if (noted.has(kind + name)) return;
    noted.add(kind + name);
    fallbacks.push({ what: `audio ${kind} ${name}`, why: `not in the audio build yet → ${to || 'silent'}` });
  };
  const rawMusic = sys.setMusic.bind(sys), rawPlay = sys.play.bind(sys);
  sys.setMusic = (state, o) => {
    if (music.has(state)) return rawMusic(state, o);
    const to = MUSIC_STAND_IN[state];
    note('music', state, to);
    return to && music.has(to) ? rawMusic(to, o) : rawMusic('off', o);
  };
  sys.play = (name, o) => {
    if (sfx.has(name)) return rawPlay(name, o);
    if (!(name in SFX_STAND_IN)) return rawPlay(name, o);     // not a niumo name: let the audio system report it
    const to = SFX_STAND_IN[name];
    note('sfx', name, to);
    return to ? rawPlay(to, o) : null;
  };
  sys.wants = { music: s => music.has(s), sfx: n => sfx.has(n) };
  // the opening's cut points: the audio build publishes its cue sheet (NIUMO_CUES.opening) so every cut lands on a drum
  const cues = cuesFromScore(mod.NIUMO_CUES && mod.NIUMO_CUES.opening);
  return { audio: sys, cues };
}

/** The monkey's move library: from moves_monkey.js when it exists (export names are not fixed by the contract). */
function pickMonkeyLib(mod) {
  if (!mod) return { lib: HEROINE, hold: HOLD_P, stub: true };
  const lib = mod.MONKEY || mod.MONKEY_MOVES || mod.MOVES || mod.MONKEY_LIB || mod.default;
  const hold = mod.HOLD_M || mod.MONKEY_HOLD || mod.HOLD || mod.STAFF_HOLD || null;
  if (!lib) { fallbacks.push({ what: 'moves_monkey', why: 'no known export (MONKEY / MOVES / default)' }); return { lib: HEROINE, hold: HOLD_P, stub: true }; }
  return { lib, hold, stub: false };
}

// ------------------------------------------------------------------ boot

/** The bull's body: bull.js's own loader when it has one (it repaints its stand-in in its shader), else ours. */
async function bullCharacter(bullMod) {
  const char = bullMod && bullMod.loadBullCharacter ? await bullMod.loadBullCharacter({ height: SCALE.bull }) : await loadBullChar();
  if (char.placeholder && !assetFallbacks.some(s => s.startsWith('niumo_bull'))) assetFallbacks.push('niumo_bull.glb → boss_p2.glb (stand-in, 40 m)');
  return char;
}

/** The monkey and his staff: monkey.js's loader (niumo_monkey.glb / heroine.glb, niumo_staff.glb / its procedural rod), else ours. */
async function monkeyAssets(monkeyMod) {
  if (monkeyMod && monkeyMod.loadMonkeyAssets) {
    const r = await monkeyMod.loadMonkeyAssets({ height: SCALE.monkey });
    if (r.fallback?.monkey) assetFallbacks.push('niumo_monkey.glb → heroine.glb (1.5 m)');
    if (r.fallback?.staff) assetFallbacks.push('niumo_staff.glb → procedural iron staff');
    return r;
  }
  const [char, staff] = await Promise.all([loadMonkeyChar(), loadStaff(SCALE.staff, 0.3)]);
  return { char, staff };
}

async function boot() {
  setLoad('载入火焰山…');
  const [arenaRes, audioRes, bullMod, monkeyMod, movesMod, inputMod, camMod] = await Promise.all([
    loadArena(), loadAudio(),
    tryImport('./bull.js', 'bull'), tryImport('./monkey.js', 'monkey'), tryImport('./moves_monkey.js', 'moves_monkey'),
    tryImport('./input.js', 'input'), tryImport('./camera.js', 'camera'),
  ]);
  const arena = arenaRes;
  if (!scene.environment) { scene.environment = volcanoEnv(); scene.environmentIntensity = 0.9; }
  setLoad('载入角色…');
  const [bullChar, mAssets] = await Promise.all([bullCharacter(bullMod), monkeyAssets(monkeyMod)]);
  const monkeyChar = mAssets.char, monkeyStaff = mAssets.staff;
  // the bull's iron staff: bull.js makes its own (crusted head, bronze bands); the stub gets ours
  const bullStaffIn = bullMod && bullMod.BullKing ? null : makeIronStaff(SCALE.bullStaff, 0.42, { bull: true });
  const { audio, cues } = audioRes;
  scene.add(bullChar.root, monkeyChar.root);
  const fx = new FX(scene, { arena });
  arena._fx = arena._fx || fx;      // the stub arena borrows it for its bursts

  const InputClass = (inputMod && inputMod.NiumoInput) || (inputMod ? (fallbacks.push({ what: 'input', why: 'no NiumoInput export' }), StubInput) : StubInput);
  const input = new InputClass(canvas);
  const ui = new NiumoUI();
  const voice = new VoiceLines(audio, ui);
  voice.loadManifest();
  const CamClass = (camMod && camMod.AutoCam) || (camMod ? (fallbacks.push({ what: 'camera', why: 'no AutoCam export' }), StubAutoCam) : StubAutoCam);
  const cam = new CamClass(camera, { bounds: arena.bounds, arena, blockers: arena.cameraBlockers });
  if (arena.cameraBlockers && !cam.blockers) cam.blockers = arena.cameraBlockers;

  const pick = pickMonkeyLib(movesMod);
  const actor = monkeyMod && monkeyMod.createMonkeyActor ? monkeyMod.createMonkeyActor(monkeyChar, monkeyStaff, scene)
    : new Actor(monkeyChar, { lib: pick.lib, hold: pick.hold, sword: monkeyStaff, scene });
  actor.playBase('idle', { fade: 0 });
  const MonkeyClass = monkeyMod && monkeyMod.Monkey;
  if (monkeyMod && !MonkeyClass) fallbacks.push({ what: 'monkey', why: 'monkey.js has no Monkey export' });
  let monkey;
  try { monkey = MonkeyClass ? new MonkeyClass({ actor, fx, audio, cam, input, arena, staff: monkeyStaff }) : null; } catch (e) {
    console.error('[niumo] new Monkey() failed', e); fallbacks.push({ what: 'monkey', why: 'constructor threw: ' + e.message }); monkey = null;
  }
  if (!monkey) monkey = new StubMonkey({ actor, fx, audio, cam, input, arena, staff: monkeyStaff });

  const BullClass = (bullMod && bullMod.BullKing) || null;
  if (bullMod && !BullClass) fallbacks.push({ what: 'bull', why: 'bull.js has no BullKing export' });
  let bullStaff = bullStaffIn;
  const makeBull = () => {
    if (BullClass) {
      try { return new BullClass({ char: bullChar, scene, fx, audio, arena, cam, staff: bullStaff }); } catch (e) {
        console.error('[niumo] new BullKing() failed', e); fallbacks.push({ what: 'bull', why: 'constructor threw: ' + e.message });
      }
    }
    if (!bullStaff) bullStaff = makeIronStaff(SCALE.bullStaff, 0.42, { bull: true });
    if (bullChar.placeholder && !bullChar.darkened) { basaltPlaceholder(bullChar.model); bullChar.darkened = true; }
    return new StubBull({ char: bullChar, scene, fx, audio, arena, cam, staff: bullStaff });
  };
  let bull = makeBull();
  bullStaff = bull.staff || bullStaff;      // reuse the same rod if the bull is ever rebuilt
  setLoad('');

  // a dead stand-in far away: what the bull "sees" while dormant and during cutscenes (so no AI ever targets the monkey then)
  const ghost = { pos: new THREE.Vector3(0, 0, 1e4), yaw: 0, hp: 0, maxHp: 1, st: 0, mp: 0, dead: true, state: 'dead', events: [], ghost: true,
    takeHit: () => false, canAct: () => false };

  const G = {
    scene, camera, renderer, composer, bloom, bokeh, grade, arena, audio, fx, input, ui, cam, monkey, bull, actor, ghost, voice,
    chars: { bull: bullChar, monkey: monkeyChar }, staffs: { monkey: monkeyStaff, get bull() { return bullStaff; } },
    state: 'loading', time: 0, hitstop: 0, slowmo: 1, slowmoT: 0, flash: 0, hurt: 0, aberr: 0, paused: false,
    god: FLAG.god, deaths: 0, wakeSeen: false, mv: null, cut: null, cutKind: null, fps: 60, frameMs: 0, flags: FLAG,
    fallbacks, assetFallbacks, cues: { ...MV_CUES, ...(cues || {}) }, cuesFromAudio: !!cues, post: { heat: 0, dof: null, letterbox: false },
    grade: { exposure: 0.95, warm: 0.15, fog: 0.3 }, stateLog: [],
  };
  window.__niumo = G;
  monkey.god = G.god;

  const music = (s, fade = 2) => audio.setMusic(s, { fade });
  const sfx = (name, o) => audio.play(name, o);
  const maxOf = (o, k, d) => o[`max${k}`] ?? o.T?.[`max${k}`] ?? d;
  const setState = s => { if (G.state !== s) { G.state = s; G.stateLog.push([+G.time.toFixed(2), s]); } };
  const seat = arena.bullSeat || { x: 0, z: -30, yaw: 0 };
  const seatF = new THREE.Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
  const fightStart = () => {
    const x = seat.x + seatF.x * FIGHT_START, z = seat.z + seatF.z * FIGHT_START;
    const p = safeSpot(arena, x, z);
    return { x: p.x, z: p.z, yaw: Math.atan2(seat.x - p.x, seat.z - p.z) };
  };

  /** The bull before the fight: posed and breathing, blind to the monkey. */
  const bullDormant = dt => { bull.dormant = true; bull.update(dt, ghost); };
  G.bullTick = bullDormant;
  // his eyes: the bull's own (setEyes(k), or its eyesWant field), else two dark-red points placed on the head bone here
  const ownEyes = b => typeof b.setEyes === 'function' || 'eyesWant' in b;
  const eyes = ownEyes(bull) ? null : new EyeGlow(scene, bullChar, { offset: [0.017, 0.045, 0.04] });
  G.eyes = eyes; G.eyeK = 0;
  G.setEyes = k => {
    G.eyeK = k;
    if (typeof bull.setEyes === 'function') bull.setEyes(k);
    else if ('eyesWant' in bull) bull.eyesWant = k;
    else eyes?.set(k);
  };
  const camSnap = () => {
    const yaw = Math.atan2(bull.pos.x - monkey.pos.x, bull.pos.z - monkey.pos.z);
    if (cam.snapBehind) cam.snapBehind(monkey.pos, yaw); else cam.snap?.(monkey, bull);
  };
  const camUpdate = (dt, look) => cam.update(dt, monkey, bull, look);

  function resetBull() {
    if (typeof bull.reset === 'function') bull.reset(seat);
    else { bull = G.bull = makeBull(); console.info('[niumo] BullKing has no reset(): rebuilt it for the retry'); }
    bull.dormant = true;
  }

  function resetWorld({ retry = false } = {}) {
    const sp = retry ? fightStart() : arena.playerSpawn;
    monkey.reset(sp);
    if (monkey.mp !== undefined) monkey.mp = maxOf(monkey, 'Mp', 100);
    monkeyChar.root.visible = true; monkeyStaff.visible = true;
    if (retry || bull.dead || bull.phase !== 1 || bull.hp < bull.maxHp) resetBull();
    G.setEyes(retry ? 1 : 0);
    arena.setPhase(retry ? 1 : 0);
    camSnap();
    ui.setPlayer(monkey.hp, maxOf(monkey, 'Hp', 100), monkey.st, maxOf(monkey, 'St', 100), monkey.mp ?? 0, maxOf(monkey, 'Mp', 100));
    ui.setBoss(bull.hp, bull.maxHp);
  }

  // -------------------------------------------------------------- states

  /** The fight. fromCine: the opening cinematic has just put the camera exactly where the fight camera starts. */
  function beginFight({ retry = false, fromCine = false } = {}) {
    setState('fight');
    G.cut = null; G.cutKind = null; G.mv = null; G.wakeSeen = true;
    bull.dormant = false;
    if (bull.state === 'dormant') bull.wake?.();        // the cinematic's roar woke him already
    G.setEyes(1);
    ui.showHUD(true); ui.showBoss(true); ui.letterbox(false); ui.setHint('');
    const p2 = bull.phase === 2, want = p2 ? 'niumo_phase2' : 'niumo_phase1';
    if (audio.musicState !== want) music(want, retry ? 1.5 : 0.3);
    arena.setPhase(p2 ? 2 : 1);
    if (!(fromCine && G.camPrimed)) camSnap();         // after the cinematic the auto camera is already on its frame
    G.camPrimed = false;
    if (!retry && !p2 && !fromCine) { G.flash = Math.max(G.flash, 0.25); cam.addTrauma?.(0.3); }
  }

  /** Straight into the fight (no cinematic: ?skipmv / ?skipintro, or a skip before the cinematic exists). */
  function fightNow() {
    resetWorld();
    monkey.reset(fightStart());
    beginFight();
    ui.clearCard();
  }

  /** The fight camera's first frame with the monkey where he stands now (the cinematic's last shot lands on it). */
  function fightCamPose() {
    const p = camera.position.clone(), q = camera.quaternion.clone(), fov = camera.fov;
    // settle the auto camera on its framing (it eases toward it), then keep that state: the fight carries on from it
    camSnap();
    for (let i = 0; i < 90; i++) cam.update(1 / 60, monkey, bull, { dx: 0, dy: 0 });
    const out = { pos: camera.position.clone(), look: camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30)), fov: camera.fov };
    camera.position.copy(p); camera.quaternion.copy(q); camera.fov = fov; camera.updateProjectionMatrix();
    G.camPrimed = true;
    return out;
  }

  function beginTransition() {
    if (G.state === 'transition') return;
    setState('transition');
    ui.showHUD(false); ui.setHint('');
    G.slowmo = 1; G.slowmoT = 0;
    G.cutKind = 'collapse';
    G.cut = new CollapseScene({ G, camera, bull, monkey, actor, audio, fx, arena, ui, music,
      onDone: () => { G.cut = null; G.cutKind = null; beginFight({ retry: true }); G.flash = Math.max(G.flash, 0.2); } });
  }

  function beginEnding() {
    if (G.state === 'ending') return;
    setState('ending');
    ui.showHUD(false); ui.showBoss(false); ui.setHint('');
    G.cutKind = 'ending';
    G.cut = new EndingScene({ G, camera, bull, monkey, actor, audio, fx, arena, ui, music,
      onDone: () => { ui.setHint('R 重新挑战'); } });
  }

  function onMonkeyDead() {
    if (G.state !== 'fight') return;
    setState('dead'); G.deaths++;
    music('niumo_defeat', 0.3);
    G.slowmo = 0.4; G.slowmoT = 1.4;
    const id = G.deaths;
    setTimeout(() => { if (G.state === 'dead' && G.deaths === id) ui.card_('火 未 熄', 'death', 4.2); }, 900);
    setTimeout(() => { if (G.state === 'dead' && G.deaths === id) $('#fade').classList.add('on'); }, 4600);
    setTimeout(() => {
      if (G.state !== 'dead' || G.deaths !== id) return;
      retryNow();
      $('#fade').classList.remove('on');
    }, 6400);
  }

  function retryNow() {
    if (G.paused) togglePause(false);
    G.cut?.dispose?.();
    G.cut = null; G.cutKind = null;
    resetWorld({ retry: true });
    setState('fight-wait'); G.waitT = 1.2;
    ui.showHUD(true); ui.showBoss(true); ui.setHint(''); ui.letterbox(false); ui.clearCard();
  }

  function drainEvents() {
    for (const e of (monkey.events || []).splice(0)) {
      if (e.type === 'hit') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.07); if (e.heavy) G.aberr = 0.8; input.rumble?.(e.heavy ? 0.8 : 0.4, 0.4, e.heavy ? 150 : 80); }
      if (e.type === 'hurt') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.1); G.hurt = 1; G.aberr = Math.max(G.aberr, 0.6); }
      if (e.type === 'block') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.06); G.aberr = Math.max(G.aberr, 0.3); }
      if (e.type === 'parry') { G.hitstop = Math.max(G.hitstop, 0.11); G.slowmo = 0.35; G.slowmoT = 0.35; G.flash = Math.max(G.flash, 0.2); G.aberr = 0.9; }
      if (e.type === 'guardbreak') { G.hitstop = Math.max(G.hitstop, e.hitstop || 0.12); G.hurt = 0.6; }
      if (e.type === 'critical') { G.hitstop = Math.max(G.hitstop, 0.24); G.slowmo = 0.3; G.slowmoT = 0.6; G.flash = Math.max(G.flash, 0.16); G.aberr = 1; input.rumble?.(1, 0.8, 300); }
      if (e.type === 'dead') onMonkeyDead();
    }
    for (const e of (bull.events || []).splice(0)) {
      if (e.type === 'damage') ui.addBossDamage(e.amount ?? e.dmg ?? 0);
      if (e.type === 'weakBreak') { G.flash = Math.max(G.flash, 0.1); G.aberr = Math.max(G.aberr, 0.6); }
      if (e.type === 'stagger') { G.slowmo = 0.45; G.slowmoT = 0.5; G.flash = Math.max(G.flash, 0.1); cam.addTrauma?.(0.35); }
      if (e.type === 'down') { G.slowmo = 0.5; G.slowmoT = 0.6; }
      // 'critical' { stage: 'open' } = his head is down (the hint shows); { stage: 'hit' } (or no stage) = 牵牛鼻子 lands
      if (e.type === 'critical' && e.stage !== 'open') { G.hitstop = Math.max(G.hitstop, 0.2); G.slowmo = 0.3; G.slowmoT = 0.7; G.flash = Math.max(G.flash, 0.18); }
      if (e.type === 'phase2' && G.state === 'fight') beginTransition();
      if (e.type === 'dead' && G.state !== 'ending') beginEnding();
    }
  }

  // -------------------------------------------------------------- splash -> the opening cinematic -> the fight

  const splash = $('#splash');
  const startMV = async () => {
    if (G.state !== 'splash') return;
    setState('starting');
    splash.classList.add('hide');
    await audio.unlock();
    voice.load();                       // decode the spoken lines on the unlocked context
    if (FLAG.skipmv || FLAG.skipintro) { fightNow(); return; }
    setState('mv'); ui.showHUD(false);
    resetWorld();
    G.mv = new OpeningMV({ G, camera, scene, bull, monkey, actor, audio, arena, fx, ui, voice, cues: G.cues,
      bullTick: dt => bullDormant(dt),
      fightPose: fightCamPose,
      onDone: skipped => { G.mv = null; G.cineEnd = { pos: camera.position.clone(), skipped }; beginFight({ fromCine: !skipped }); } });
  };
  splash.addEventListener('click', startMV);
  addEventListener('keydown', e => { if (e.code === 'Enter' && G.state === 'splash' && splash.classList.contains('ready')) startMV(); });

  resetWorld();
  setState('splash');
  splash.classList.add('ready');
  if (FLAG.autostart || FLAG.mv) startMV();

  // -------------------------------------------------------------- pause + settings

  const pausable = () => ['fight', 'fight-wait'].includes(G.state);
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && pausable()) togglePause();
    if (e.code === 'KeyR' && (G.state === 'ending' && !G.cut?.running || G.paused)) retryNow();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && pausable() && !G.paused && !FLAG.debug && G.hadPointer) togglePause(true);
    if (document.pointerLockElement) G.hadPointer = true;
  });
  function togglePause(force) {
    G.paused = force !== undefined ? force : !G.paused;
    $('#pause').classList.toggle('on', G.paused);
    if (G.paused && document.pointerLockElement) document.exitPointerLock?.();
  }
  $('#pause').addEventListener('click', e => { if (e.target.id === 'pause') togglePause(false); });
  $('#p-resume').addEventListener('click', () => togglePause(false));
  $('#p-retry').addEventListener('click', () => { if (['fight', 'fight-wait', 'dead'].includes(G.state)) retryNow(); else togglePause(false); });

  const SETTINGS_KEY = 'hunxi.niumo.settings.v1';
  const settings = { master: 100, music: 85, sfx: 100, sens: 100, shake: 100, invY: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* private mode: defaults */ }
  function applySettings() {
    audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, sfx: settings.sfx / 100 });
    input.lookSensitivity = 0.0024 * settings.sens / 100; input.padLookScale = settings.sens / 100;
    input.invertY = !!settings.invY;
    cam.shakeScale = settings.shake / 100;
  }
  const fmt = { master: v => v + '%', music: v => v + '%', sfx: v => v + '%', sens: v => (v / 100).toFixed(2) + '×', shake: v => v + '%' };
  for (const [key, id] of [['master', 's-master'], ['music', 's-music'], ['sfx', 's-sfx'], ['sens', 's-sens'], ['shake', 's-shake'], ['invY', 's-invy']]) {
    const el = $('#' + id), out = el.parentElement.querySelector('output');
    const show = () => { if (out) out.textContent = key === 'invY' ? (settings.invY ? '开' : '关') : fmt[key](settings[key]); };
    if (key === 'invY') el.checked = !!settings.invY; else el.value = settings[key];
    show();
    el.addEventListener('input', () => {
      settings[key] = key === 'invY' ? el.checked : +el.value;
      show(); applySettings();
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
    });
  }
  applySettings();

  // -------------------------------------------------------------- debug overlay (?debug)

  let dbg = null;
  if (FLAG.debug) {
    dbg = document.createElement('pre');
    Object.assign(dbg.style, { position: 'fixed', right: '8px', top: '6px', margin: 0, font: '11px/1.35 ui-monospace, monospace', color: '#cbbfa8',
      background: 'rgba(0,0,0,.45)', padding: '6px 8px', zIndex: 9, pointerEvents: 'none', whiteSpace: 'pre' });
    document.body.appendChild(dbg);
  }
  let dbgT = 0;
  function debugText() {
    const b = bull, m = monkey;
    return [`${G.state}${G.paused ? ' (paused)' : ''}  ${G.fps.toFixed(0)} fps  ${G.frameMs.toFixed(1)} ms`,
      `bull ${Math.round(b.hp)}/${b.maxHp} p${b.phase} ${b.state}${b.dead ? ' dead' : ''}`,
      `monkey ${Math.round(m.hp)} st ${Math.round(m.st)} mp ${Math.round(m.mp ?? 0)} ${m.state}`,
      `music ${audio.musicState}  arena phase ${G.arenaPhase ?? '-'}`,
      fallbacks.length ? 'stubs: ' + [...new Set(fallbacks.map(f => f.what))].join(', ') : 'stubs: none',
      assetFallbacks.length ? 'placeholders: ' + assetFallbacks.length : ''].join('\n');
  }
  // remember the arena phase for the overlay / tests
  const rawSetPhase = arena.setPhase.bind(arena);
  arena.setPhase = p => { G.arenaPhase = p; return rawSetPhase(p); };
  G.arenaPhase = 0;

  // -------------------------------------------------------------- test / debug helpers

  Object.assign(G, {
    beginFight, fightNow, fightCamPose, beginTransition, beginEnding, retryNow, togglePause, resetWorld, fightStart,
    /** Strike the bull through its own contract (used by the tests to drive the phases). */
    hitBull(dmg = 50, part = null) {
      const zones = bull.hurtZones ? bull.hurtZones() : [];
      const z = (part && zones.find(q => q.part === part)) || zones[0];
      const point = z ? z.a.clone().lerp(z.b, 0.5) : bull.pos.clone().setY(8);
      return bull.takeHit({ dmg, poise: 0, point, dir: new THREE.Vector3(0, 0, -1), heavy: true, from: monkey.pos.clone(), part: z ? z.part : 'body' });
    },
    nearestWeakPoint() {
      const t = bull.lockTargets ? bull.lockTargets() : [];
      let best = null, bd = Infinity;
      for (const q of t) { const d = horizDist(q.pos, monkey.pos); if (d < bd) { bd = d; best = q; } }
      return best;
    },
  });

  // -------------------------------------------------------------- loop

  const timer = new THREE.Timer();
  timer.connect?.(document);
  const listenerFwd = new THREE.Vector3();
  const noLook = { dx: 0, dy: 0 };
  const gh = arena.gradeHints || {};
  G.grade = { exposure: gh.exposure ?? 0.95, warm: gh.warm ?? 0.15, fog: gh.fog ?? 0.3, desat: gh.desat ?? 0.14, bloom: gh.bloom ?? 0.55 };

  function frame() {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    timer.update();
    const rawDt = timer.getDelta();
    let dt = Math.min(rawDt, 1 / 20);
    if (G.fixedDt) dt = G.fixedDt;
    G.fps = G.fps * 0.95 + (1 / Math.max(rawDt, 1e-3)) * 0.05;
    input.update(dt);
    if (input.take('menu', 0.3) && pausable()) togglePause();
    if (G.paused) { composer.render(dt); return; }
    G.time += dt;

    if (G.slowmoT > 0) { G.slowmoT -= dt; if (G.slowmoT <= 0) G.slowmo = 1; }
    const gdt = dt * G.slowmo;
    let adt = gdt;
    if (G.hitstop > 0) { G.hitstop -= dt; adt = 0; }

    const skip = input.take('skip', 1) || input.take('pause', 1) || input.take('menu', 1);
    if (skip && G.state === 'mv' && G.mv) G.mv.skip();
    if (skip && G.cut && G.cut.skippable !== false) G.cut.skip();
    monkey.god = G.god;
    const look = input.look ? input.look(dt) : noLook;

    switch (G.state) {
      case 'loading':
      case 'splash':
      case 'starting':
        titleCamera(camera, arena, G.time);
        bullDormant(dt);
        actor.update(dt);
        break;
      case 'mv':
        // the MV keeps wall-clock time (not the clamped game step) so it stays on the score
        G.mv.update(G.fixedDt || Math.min(rawDt, 0.25));
        break;
      case 'transition':
      case 'ending':
        if (G.cut) G.cut.update(gdt);
        if (G.state === 'transition' || G.state === 'ending') drainEvents();
        break;
      case 'fight-wait':
        G.waitT -= dt;
        monkey.update(adt, null);
        bullDormant(adt);
        camUpdate(dt, look);
        drainEvents();
        if (G.waitT <= 0) beginFight({ retry: true });
        break;
      case 'fight':
      case 'dead': {
        monkey.update(adt, bull.dead ? null : bull);
        bull.update(adt, monkey);
        // the seated giant is a mountain: the monkey cannot walk into him (a bull with colliders() is handled by the monkey)
        if (!bull.dead && !monkey.dead && typeof bull.colliders !== 'function') separate(monkey.pos, 0.35, bull.pos, bull.radius ?? (bull.phase === 2 ? 4.5 : 8.5), 1);
        camUpdate(dt, look);
        drainEvents();
        break;
      }
    }
    if (G.debugCam) { camera.position.copy(G.debugCam.pos); camera.lookAt(G.debugCam.look); if (G.debugCam.fov) { camera.fov = G.debugCam.fov; camera.updateProjectionMatrix(); } }

    voice.update(rawDt);
    eyes?.update(dt, G.time);
    updateLooks(camera);
    fx.update(gdt);
    arena.update(dt, G.time, camera);
    camera.getWorldDirection(listenerFwd);
    audio.setListener({ position: camera.position, forward: listenerFwd });
    const hpMax = maxOf(monkey, 'Hp', 100), hpK = monkey.hp / hpMax, low = G.state === 'fight' && !monkey.dead && hpK < 0.3;
    audio.setMuffle(Math.max(low ? 0.35 + (0.3 - hpK) * 1.8 : 0, G.slowmoT > 0 && G.slowmo < 1 ? 0.5 : 0));
    G.heartT = (G.heartT || 0) - dt;
    if (low && hpK < 0.25 && G.heartT <= 0) { sfx('heartbeat', { volume: 0.9 }); G.heartT = hpK < 0.12 ? 0.62 : 0.84; }
    audio.update(dt);

    ui.setPlayer(monkey.hp, hpMax, monkey.st, maxOf(monkey, 'St', 100), monkey.mp ?? 0, maxOf(monkey, 'Mp', 100));
    ui.setBoss(bull.hp, bull.maxHp);
    const lt = G.state === 'fight' && !bull.dead ? (cam.lockTarget?.pos || G.nearestWeakPoint()?.pos || null) : null;
    ui.setReticle(lt, camera, renderer);
    if (G.state === 'fight') {
      const open = !!bull.criticalOpen?.(monkey) && !monkey.dead;
      if (open !== G.critHint) { G.critHint = open; ui.setHint(open ? 'J · 牵牛鼻子' : ''); }
    }
    ui.update(dt);

    // grade: ease toward the arena's hints for its current phase; cutscenes may push heat / warmth on top
    const hints = arena.gradeHints || {};
    const k = 1 - Math.exp(-1.5 * dt);
    G.grade.exposure += ((hints.exposure ?? 0.95) - G.grade.exposure) * k;
    G.grade.warm += ((hints.warm ?? 0.15) - G.grade.warm) * k;
    G.grade.fog += ((hints.fog ?? 0.3) - G.grade.fog) * k;
    G.grade.desat += ((hints.desat ?? 0.14) - G.grade.desat) * k;
    G.grade.bloom += ((hints.bloom ?? 0.55) - G.grade.bloom) * k;
    const cin = G.state === 'mv' ? G.mv : G.cut;
    const cp = (cin && cin.post) || {};
    renderer.toneMappingExposure = G.grade.exposure * (cp.exposure ?? 1);
    G.flash = Math.max(0, G.flash - dt * 1.6);
    G.hurt = Math.max(0, G.hurt - dt * 1.4);
    G.aberr = Math.max(0, G.aberr - dt * 3);
    const u = grade.uniforms;
    u.uTime.value = G.time;
    u.uFlash.value = Math.max(G.flash * G.flash, cp.flash || 0);
    u.uHurt.value = Math.max(G.hurt, G.state === 'fight' && hpK < 0.25 ? 0.35 : 0);
    u.uAberr.value = G.aberr;
    u.uWarm.value = G.grade.warm + (cp.warm || 0);
    u.uHaze.value = G.grade.fog;
    u.uHeat.value = cp.heat || 0;
    u.uDesat.value = G.grade.desat + (cp.desat || 0);
    bloom.strength = G.grade.bloom + (cp.bloom || 0);
    u.uVignette.value = 0.55 + (cp.vignette || 0);
    const dof = cin && cin.dof;
    bokeh.enabled = !!dof;
    if (dof) { bokeh.uniforms.focus.value = dof.focus; bokeh.uniforms.aperture.value = dof.aperture; bokeh.uniforms.maxblur.value = dof.maxblur; }
    $('#mvfade').style.opacity = cin && cin.black ? cin.black.toFixed(3) : '0';
    composer.render(dt);
    G.frameMs = G.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (dbg && (dbgT += dt) > 0.25) { dbgT = 0; dbg.textContent = debugText(); }
  }
  frame();
  window.__ready = true;
}

boot().catch(e => {
  console.error(e);
  setLoad('载入失败：' + e.message);
  window.__error = String(e && e.stack || e);
});

// =====================================================================================================================
// STUBS — minimal stand-ins for modules other builders own (arena.js, bull.js, monkey.js, input.js, camera.js).
// They exist only so this file's flow, the MV and the cutscenes can be developed and tested before those modules land,
// and so a broken module never takes the whole page down. Every use is recorded in __niumo.fallbacks and fails the
// smoke test. The integrator removes this block once the real modules are in.
// =====================================================================================================================

/** STUB arena: dark basalt floor with faint cracks, a crusted lava river, basalt pillars, the altar mound, the mountain. */
function createStubArena({ scene }) {
  const group = new THREE.Group(); group.name = 'stub-arena';
  scene.add(group);
  const bounds = { minX: -40, maxX: 40, minZ: -16, maxZ: 48 };
  const seat = { x: 0, z: -30, yaw: 0 };
  // sky: smoke-dark zenith, dull red horizon, a hotter glow behind the mountain
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uGlow: { value: 1 }, uRain: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uGlow, uRain; varying vec3 vP;
      void main(){ float h = vP.y; float back = smoothstep(0.2, -1.0, vP.z);
        vec3 c = mix(vec3(0.16, 0.035, 0.016), vec3(0.012, 0.008, 0.008), smoothstep(-0.02, 0.45, h));
        c += vec3(0.22, 0.05, 0.012) * back * exp(-abs(h) * 9.0) * uGlow;
        c = mix(c, vec3(0.03, 0.033, 0.036) * (1.0 - 0.6 * smoothstep(0.0, 0.5, h)), uRain);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -1; group.add(sky);
  // floor: dark basalt texture, a cracks emissive map
  const cv = (draw, w = 512) => { const c = document.createElement('canvas'); c.width = c.height = w; draw(c.getContext('2d'), w); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const albedo = cv((g, w) => { g.fillStyle = '#1d1715'; g.fillRect(0, 0, w, w); for (let i = 0; i < 2600; i++) { const v = 14 + rnd() * 26; g.fillStyle = `rgb(${v + 4},${v},${v - 2})`; g.fillRect(rnd() * w, rnd() * w, 2 + rnd() * 9, 2 + rnd() * 9); } });
  albedo.colorSpace = THREE.SRGBColorSpace; albedo.repeat.set(40, 40);
  const cracks = cv((g, w) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, w); g.strokeStyle = '#ff7a2a'; g.lineCap = 'round';
    for (let i = 0; i < 18; i++) { let x = rnd() * w, y = rnd() * w; g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 9; s++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); } });
  cracks.colorSpace = THREE.SRGBColorSpace; cracks.repeat.set(40, 40);
  const floorMat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.95, metalness: 0, emissive: new THREE.Color(1, 1, 1), emissiveMap: cracks, emissiveIntensity: 0.55 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  // a crusted lava river along the right side of the caldera
  const lavaMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uHeat: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT, uHeat; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){ vec2 p = vec2(vUv.x * 6.0, vUv.y * 90.0 - uT * 0.35);
        float c = n(p * 1.3) * 0.6 + n(p * 3.1) * 0.4; float crack = 1.0 - smoothstep(0.02, 0.09, abs(c - 0.5));
        float edge = smoothstep(0.42, 0.5, abs(vUv.x - 0.5));
        float heat = clamp(crack * 0.85 + edge * 0.7, 0.0, 1.0) * uHeat;
        vec3 crust = vec3(0.022, 0.016, 0.014) * (0.6 + 0.8 * n(p * 7.0));
        gl_FragColor = vec4(crust + vec3(2.6, 0.62, 0.14) * heat * heat, 1.0); }`,
  });
  const river = new THREE.Mesh(new THREE.PlaneGeometry(7, 140, 1, 1), lavaMat);
  river.rotation.x = -Math.PI / 2; river.position.set(25, 0.03, 10); group.add(river);
  const stone = new THREE.MeshStandardMaterial({ color: 0x1a1513, roughness: 0.92, metalness: 0.02 });
  // basalt pillars (colliders, camera blockers)
  const pillars = [[-15, 14, 1.6, 9], [14, 22, 1.3, 7], [-24, -2, 2.0, 13], [18, -6, 1.8, 11], [-8, 34, 1.1, 5], [30, 36, 1.5, 8]];
  const colliders = [];
  for (const [x, z, r, h] of pillars) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 6), stone);
    m.position.set(x, h / 2, z); m.rotation.y = x; m.castShadow = m.receiveShadow = true; group.add(m);
    colliders.push({ x, z, r });
  }
  // the altar mound he sits on, the mountain he is part of, distant smoking cones
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(20, 27, 3, 24), stone);
  mound.position.set(seat.x, -1.2, seat.z - 2); mound.receiveShadow = true; group.add(mound);
  const mountain = new THREE.Mesh(new THREE.ConeGeometry(90, 120, 24, 1, true), stone);
  mountain.position.set(seat.x, 50, seat.z - 70); group.add(mountain);
  for (const [x, z, s] of [[-260, -420, 1], [330, -380, 0.8], [-480, -150, 0.7]]) {
    const v = new THREE.Mesh(new THREE.ConeGeometry(150 * s, 210 * s, 18), stone);
    v.position.set(x, 90 * s, z); group.add(v);
  }
  // light: smoke-dimmed sky fill, a warm backlight from the burning horizon behind him, a cool rim from the front
  const hemi = new THREE.HemisphereLight(0x5a4a48, 0x2a0e06, 0.45);
  const back = new THREE.DirectionalLight(0xff8a4a, 1.6);
  back.position.set(-30, 60, -120); back.target.position.set(0, 0, 0);
  back.castShadow = true; back.shadow.mapSize.set(2048, 2048);
  Object.assign(back.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 }); back.shadow.bias = -0.0005;
  const rim = new THREE.DirectionalLight(0x8a9ab8, 0.35); rim.position.set(40, 30, 80);
  const riverLight = new THREE.PointLight(0xff6a2a, 60, 30, 2); riverLight.position.set(25, 2, 10);
  group.add(hemi, back, back.target, rim, riverLight);
  // falling ash (cheap points)
  const N = 900, ashPos = new Float32Array(N * 3), ashGeo = new THREE.BufferGeometry();
  for (let i = 0; i < N; i++) ashPos.set([(rnd() - 0.5) * 120, rnd() * 40, (rnd() - 0.5) * 120], i * 3);
  ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3));
  const ash = new THREE.Points(ashGeo, new THREE.PointsMaterial({ color: 0x8a8580, size: 0.08, transparent: true, opacity: 0.55, depthWrite: false }));
  ash.frustumCulled = false; group.add(ash);
  // rain (phase three)
  const RN = 3000, rainPos = new Float32Array(RN * 6), rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x9aa4ae, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false; group.add(rain);
  const rainSeed = new Float32Array(RN * 3);
  for (let i = 0; i < RN; i++) rainSeed.set([(rnd() - 0.5) * 70, rnd() * 30, (rnd() - 0.5) * 70], i * 3);
  // eruption bursts
  const bursts = [];
  const PH = [
    { hemi: 0.45, back: 1.6, glow: 0.8, crack: 0.45, heat: 0.8, fog: [0x160c08, 0.0062], hints: { exposure: 0.95, warm: 0.12, fog: 0.3 } },
    { hemi: 0.45, back: 1.7, glow: 1.0, crack: 0.55, heat: 1.0, fog: [0x170c08, 0.0062], hints: { exposure: 0.95, warm: 0.16, fog: 0.3 } },
    { hemi: 0.6, back: 2.6, glow: 2.2, crack: 1.4, heat: 1.6, fog: [0x2a1006, 0.0075], hints: { exposure: 1.02, warm: 0.32, fog: 0.42 } },
    { hemi: 0.5, back: 0.4, glow: 0.0, crack: 0.0, heat: 0.0, fog: [0x1a1c1f, 0.011], hints: { exposure: 0.9, warm: -0.3, fog: 0.5 } },
  ];
  let phase = 0, cur = { ...PH[0] };
  const arena = {
    bounds, playerSpawn: { x: 0, z: 40, yaw: Math.PI }, bullSeat: seat,
    groundY: () => 0,
    lavaAt: (x, z) => (phase < 3 && x > 21.5 && x < 28.5 && z > -60 && z < 80 ? 1 : 0),
    colliders, cameraBlockers: { circles: colliders, bounds: { minX: bounds.minX - 8, maxX: bounds.maxX + 8, minZ: bounds.minZ - 30, maxZ: bounds.maxZ + 14 } },
    gradeHints: { ...PH[0].hints }, group, stub: true,
    setPhase(p) { phase = THREE.MathUtils.clamp(p | 0, 0, 3); Object.assign(arena.gradeHints, PH[phase].hints); rain.visible = phase === 3; },
    eruption(x, z, strength = 1) {
      const fx = arena._fx;
      const at = new THREE.Vector3(x, 1, z);
      if (fx) {
        fx.light(at.clone().setY(4), 0xff6a24, 900 * strength, 1.2, 60 * strength);
        for (let i = 0; i < 120 * strength; i++) {
          const v = new THREE.Vector3((rnd() - 0.5) * 8, 8 + rnd() * 26 * strength, (rnd() - 0.5) * 8);
          fx.add.emit(at, v, new THREE.Color(2.4, 0.7, 0.18), { size: 0.25 + rnd() * 0.6, life: 1 + rnd() * 1.6, drag: 0.4, grav: -9.8, alpha: 1 });
        }
        for (let i = 0; i < 40 * strength; i++) {
          const v = new THREE.Vector3((rnd() - 0.5) * 4, 3 + rnd() * 6, (rnd() - 0.5) * 4);
          fx.alpha.emit(at.clone().setY(2 + rnd() * 4), v, new THREE.Color(0.09, 0.07, 0.065), { size: 5 + rnd() * 6, life: 3 + rnd() * 2, drag: 0.5, grav: 0.3, alpha: 0.5, grow: 2 });
        }
      }
      bursts.push({ t: 0 });
    },
    shake(k) { arena.shakeK = Math.max(arena.shakeK || 0, k); },
    update(dt, time, cam) {
      const P = PH[phase], k = 1 - Math.exp(-1.2 * dt);
      for (const key of ['hemi', 'back', 'glow', 'crack', 'heat']) cur[key] += (P[key] - cur[key]) * k;
      hemi.intensity = cur.hemi; back.intensity = cur.back; sky.material.uniforms.uGlow.value = cur.glow;
      sky.material.uniforms.uRain.value += ((phase === 3 ? 1 : 0) - sky.material.uniforms.uRain.value) * k;
      floorMat.emissiveIntensity = cur.crack; lavaMat.uniforms.uHeat.value = cur.heat; lavaMat.uniforms.uT.value = time;
      riverLight.intensity = 60 * cur.heat;
      scene.fog.color.lerp(new THREE.Color(P.fog[0]), k); scene.fog.density += (P.fog[1] - scene.fog.density) * k;
      arena.shakeK = Math.max(0, (arena.shakeK || 0) - dt);
      // ash drifts down around the camera
      const a = ashGeo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        a[i * 3 + 1] -= dt * (0.6 + (i % 7) * 0.08); a[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.3;
        if (a[i * 3 + 1] < 0) a[i * 3 + 1] += 40;
      }
      ash.position.set(Math.round(cam.position.x / 40) * 40, 0, Math.round(cam.position.z / 40) * 40);
      ashGeo.attributes.position.needsUpdate = true;
      if (rain.visible) {
        const r = rainGeo.attributes.position.array, c = cam.position;
        for (let i = 0; i < RN; i++) {
          const y = ((rainSeed[i * 3 + 1] - time * 18) % 30 + 30) % 30;
          const x = c.x + rainSeed[i * 3], z = c.z + rainSeed[i * 3 + 2], yy = c.y - 12 + y;
          r.set([x, yy, z, x + 0.05, yy + 0.7, z + 0.02], i * 6);
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
      for (const b of bursts) b.t += dt;
      while (bursts.length && bursts[0].t > 3) bursts.shift();
    },
  };
  return arena;
}

/** STUB input: J light · K heavy (hold) · L block (hold) · I fan · Space tap = roll, hold = sprint. */
class StubInput extends Input {
  constructor(canvas) {
    super(canvas);
    this.spaceAt = -1;
    const map = { KeyJ: 'light', KeyK: 'heavy', KeyL: 'block', KeyI: 'fan' };
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (map[e.code]) this.press(map[e.code]);
      if (e.code === 'Space') this.spaceAt = performance.now();
    });
    addEventListener('keyup', e => {
      if (map[e.code]) this.release(map[e.code]);
      if (e.code === 'Space') { const held = performance.now() - this.spaceAt; this.spaceAt = -1; if (held < 250) this.press('roll', true); }
    });
  }
  press(action, internal = false) { if (action === 'roll' && !internal && this.keys.has('Space')) return; super.press(action); }
  sprinting() { return super.sprinting() || (this.spaceAt > 0 && performance.now() - this.spaceAt > 250); }
}

/** STUB camera: the cathedral rig, locked on the weak point nearest the monkey once the fight is on. */
class StubAutoCam extends CameraRig {
  constructor(camera, { bounds, blockers }) {
    super(camera, { bounds });
    this.blockers = blockers || null;
    this.dist = 6.5; this.targetHeight = 1.25; this.lockDistAdd = 5; this.lockFovAdd = -4;
    this.lockTarget = null;
  }
  update(dt, monkey, bull, look) {
    const fighting = bull && !bull.dead && !bull.dormant;
    if (fighting && bull.lockTargets) {
      let best = null, bd = Infinity;
      for (const t of bull.lockTargets()) { const d = horizDist(t.pos, monkey.pos); if (d < bd) { bd = d; best = t; } }
      this.lockTarget = best;
      if (best && !this.locked) this.setLock(() => this.lockTarget.pos);
    } else if (this.locked) { this.setLock(null); this.lockTarget = null; }
    super.update(dt, monkey.pos, look || { dx: 0, dy: 0 });
  }
}

/** STUB monkey: the cathedral heroine's controller hitting the bull's hurt zones, plus the fan's mana. */
class StubMonkey extends Player {
  constructor({ actor, fx, audio, cam, input, arena }) {
    super({ actor, fx, audio, cam, input, arena, trail: fx.trail({ color: new THREE.Color(0.9, 0.72, 0.48), life: 0.13, opacity: 0.4 }) });
    this.maxHp = this.T.maxHp; this.maxSt = this.T.maxSt; this.maxMp = 100; this.mp = 100;
    this.T = { ...this.T, baseDmg: 60 };
  }
  reset(spawn) { super.reset(spawn); this.mp = this.maxMp; }
  update(dt, bull) {
    if (dt > 0) this.mp = Math.min(this.maxMp, this.mp + 3 * dt);
    if (bull && this.canAct() && this.input.take('fan', 0.3) && this.mp >= 25) {
      this.mp -= 25;
      const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.fx.dust(this.pos.clone().addScaledVector(f, 3), 2.5, 50);
      this.audio?.play('fan_wind', { pos: this.pos });
      this.events.push({ type: 'fan' });
    }
    let adapter = null;
    if (bull) {
      let best = null, bd = Infinity;
      for (const t of bull.lockTargets()) { const d = horizDist(t.pos, this.pos); if (d < bd) { bd = d; best = t; } }
      adapter = {
        pos: best ? best.pos.clone().setY(0) : bull.pos, yaw: bull.yaw, dead: bull.dead, staggered: !!bull.staggered,
        hurtCapsules: () => bull.hurtZones(), criticalOpen: p => bull.criticalOpen(p),
        takeCritical: o => bull.takeCritical(o), takeHit: h => bull.takeHit(h),
      };
    }
    this.bullRef = bull;
    super.update(dt, adapter);
  }
  checkHits(boss, mv) {
    const def = mv.def;
    if (!def.hits || !boss || boss.dead || this.hitThisSwing) return;
    for (const [t0, t1, info] of def.hits) {
      if (mv.t < t0 || mv.t > t1) continue;
      const a = this.a;
      const zones = boss.hurtCapsules();
      let hit = null;
      for (const z of zones) {      // the giant's limbs are thick: test the swept staff against each zone
        const d = segDist(a.bladeBase, a.bladeTip, z.a, z.b);
        if (d <= z.r + 0.25) { hit = { point: z.a.clone().lerp(z.b, 0.5), capsule: z }; break; }
      }
      if (!hit) continue;
      this.hitThisSwing = true;
      const charge = mv.name === 'heavy' ? 1 + this.charge * 0.6 : 1;
      const dir = new THREE.Vector3().subVectors(a.bladeTip, a.prevTip).normalize();
      boss.takeHit({ dmg: this.T.baseDmg * info.dmg * charge, poise: info.poise * charge, point: hit.point, dir, heavy: mv.name === 'heavy', from: this.pos, part: hit.capsule.part });
      this.fx.hitSpark(hit.point, dir, mv.name === 'heavy');
      this.audio?.play(mv.name === 'heavy' ? 'staff_hit_heavy' : 'staff_hit', { pos: hit.point });
      this.events.push({ type: 'hit', hitstop: info.hitstop, heavy: mv.name === 'heavy' });
      return;
    }
  }
  footsteps(dt) {
    if (this.speed < 0.4) { this.footAcc = 0; return; }
    this.footAcc += this.speed * dt;
    if (this.footAcc >= 0.9) this.footAcc -= 0.9;
  }
}
const _sd1 = new THREE.Vector3(), _sd2 = new THREE.Vector3(), _sd3 = new THREE.Vector3();
function segDist(p1, q1, p2, q2) {
  // sampled closest distance between two segments (enough for the stub)
  let best = Infinity;
  for (let i = 0; i <= 6; i++) {
    _sd1.lerpVectors(p1, q1, i / 6);
    const ab = _sd2.subVectors(q2, p2), t = THREE.MathUtils.clamp(_sd3.subVectors(_sd1, p2).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
    best = Math.min(best, _sd3.copy(p2).addScaledVector(ab, t).distanceTo(_sd1));
  }
  return best;
}

// STUB bull poses (character space [right, up, forward]; legs from the hip joint in leg lengths, arms from the shoulder)
const SEATED = {
  hips: [0, -0.86, -0.04], spine: [6, 0, 0], head: [10, 0, 0],
  legL: { at: [0.3, -0.12, 0.52], pole: [-1, 0.6, 0.3] }, legR: { at: [-0.3, -0.16, 0.48], pole: [1, 0.6, 0.3] },
  armR: { at: [-0.12, -0.55, 0.62], pole: [0.8, -0.3, -0.4] }, armL: { at: [0.1, -0.62, 0.58], pole: [-0.8, -0.3, -0.4] },
  blade: [0.05, 1, 0.08], grip: 1,
};
const BOWED = { ...SEATED, spine: [40, 0, 0], head: [30, 0, 0], armR: { at: [-0.05, -0.8, 0.5], pole: [0.8, -0.3, -0.4] }, armL: { at: [0.05, -0.8, 0.5], pole: [-0.8, -0.3, -0.4] } };
const STUB_BULL_LIB = {
  seat: { blendIn: 0.01, blendOut: 0.01, keys: [{ t: 0, ...SEATED }, { t: 100, ...SEATED }] },
  bow: { blendIn: 0.5, blendOut: 0.01, keys: [{ t: 0, ...SEATED }, { t: 0.8, ...BOWED }, { t: 100, ...BOWED }] },
  slam: { blendIn: 0.01, blendOut: 0.01, keys: [{ t: 0, ...SEATED }, { t: 0.9, ...SEATED, armR: { at: [-0.1, 0.6, 0.5], pole: [0.8, -0.2, -0.3] }, blade: [0.1, 0.4, -0.9] },
    { t: 1.5, ...SEATED, armR: { at: [-0.1, -0.5, 0.9], pole: [0.8, -0.2, -0.3] }, blade: [0, -0.3, 1], ease: 'snap' }, { t: 2.4, ...SEATED }, { t: 3.2, ...SEATED }] },
};
for (const mv of Object.values(STUB_BULL_LIB)) mv.track_ = new PoseTrack(mv.keys, {});

/** STUB bull: seated pose, one telegraphed slam, weak points on hands / knees, phase two at half health. */
class StubBull {
  constructor({ char, scene, fx, audio, arena, cam, staff }) {
    Object.assign(this, { char, scene, fx, audio, arena, cam, staff });
    this.root = char.root;
    this.a = new Actor(char, { lib: STUB_BULL_LIB, hold: null, sword: staff, scene });
    this.a.playBase('idle', { fade: 0 }); this.a.setBaseTimeScale(0.35);
    this.maxHp = 2400; this.radius = 8.5;
    this.reset();
  }
  get pos() { return this.root.position; }
  get yaw() { return this.root.rotation.y; }
  set yaw(v) { this.root.rotation.y = v; }
  reset() {
    const s = this.arena.bullSeat;
    this.root.position.set(s.x, 0, s.z); this.root.rotation.set(0, s.yaw, 0);
    this.hp = this.maxHp; this.phase = 1; this.dead = false; this.state = 'dormant'; this.events = [];
    this.weak = { handL: 260, handR: 260, kneeL: 300, kneeR: 300 }; this.broken = 0;
    this.staggered = false; this.stagT = 0; this.cool = 3; this.stand = 0; this.tt = 0; this.attack = null; this.critUsed = false;
    this.a.stopMove(); this.a.startMove('seat');
  }
  wake() { if (this.state === 'dormant') { this.state = 'idle'; this.audio?.play('bull_roar', { pos: this.pos, volume: 0.7, pitch: 0.8 }); } }
  bone(n) { return this.a.bonePos(n, new THREE.Vector3()); }
  hurtZones() {
    const U = new THREE.Vector3(0, 1, 0), B = n => this.bone(n);
    const mid = (a, b, f = 0.5) => a.clone().lerp(b, f);
    return [
      { part: 'handL', a: B('LeftHand'), b: B('LeftHandMiddle1'), r: 1.5 },
      { part: 'handR', a: B('RightHand'), b: B('RightHandMiddle1'), r: 1.5 },
      { part: 'kneeL', a: B('LeftLeg'), b: mid(B('LeftLeg'), B('LeftUpLeg'), 0.3), r: 2.2 },
      { part: 'kneeR', a: B('RightLeg'), b: mid(B('RightLeg'), B('RightUpLeg'), 0.3), r: 2.2 },
      { part: 'head', a: B('Head'), b: B('Head').addScaledVector(U, 2.5), r: 2.4 },
      { part: 'body', a: B('Hips'), b: B('Spine2'), r: 5.2 },
    ];
  }
  lockTargets() {
    return this.hurtZones().filter(z => z.part !== 'body' && (z.part !== 'head' || this.staggered)).map(z => ({ part: z.part, pos: z.a.clone().lerp(z.b, 0.5) }));
  }
  takeHit({ dmg = 0, part = 'body' }) {
    if (this.dead || this.state === 'dormant' || this.state === 'transition') return false;
    const weak = part in this.weak && this.weak[part] > 0;
    const d = dmg * (weak ? 1.5 : part === 'body' ? 0.5 : 1) * (this.staggered ? 1.3 : 1);
    this.hp = Math.max(0, this.hp - d);
    this.events.push({ type: 'damage', amount: d, part });
    this.fx.flashMesh(this.char.model, new THREE.Color(1, 0.5, 0.25), 0.1, 0.4);
    if (weak) {
      this.weak[part] -= dmg;
      if (this.weak[part] <= 0) {
        this.broken++;
        this.arena.eruption?.(this.bone(part.startsWith('hand') ? (part === 'handL' ? 'LeftHand' : 'RightHand') : (part === 'kneeL' ? 'LeftLeg' : 'RightLeg')).x, this.pos.z + 8, 0.4);
        if (this.broken % 2 === 0) { this.staggered = true; this.stagT = 7; this.critUsed = false; this.a.stopMove(); this.a.startMove('bow'); this.events.push({ type: 'stagger' }); }
      }
    }
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2; this.state = 'transition'; this.tt = 0; this.staggered = false; this.said = null;
      this.a.stopMove(); this.a.startMove('seat');
      this.events.push({ type: 'phase2' });
    } else if (this.hp <= 0) { this.dead = true; this.state = 'dead'; this.events.push({ type: 'dead' }); }
    return true;
  }
  criticalOpen(player) {
    if (!this.staggered || this.critUsed || !player || player.dead) return false;
    const h = this.bone('Head');
    return Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < 7;
  }
  takeCritical({ dmg = 400 }) {
    this.critUsed = true; this.staggered = false; this.stagT = 0;
    this.hp = Math.max(0, this.hp - dmg);
    this.events.push({ type: 'critical' }, { type: 'damage', amount: dmg });
    if (this.hp <= 0) { this.dead = true; this.state = 'dead'; this.events.push({ type: 'dead' }); }
  }
  update(dt, player) {
    this.tt += dt;
    const live = player && !player.ghost && !player.dead && !this.dormant;
    if (this.state === 'transition') {
      // stands up out of the mountain: the seated pose lets go between 3 s and 8 s (sounds as the real bull's)
      const at = (k, s) => { if (this.tt >= s && !this.said?.has(k)) { (this.said ||= new Set()).add(k); return true; } return false; };
      if (at('roar', 0.6)) this.audio?.play('bull_roar', { pos: this.pos, volume: 1.2, pitch: 0.62 });
      if (at('hands', 3.6)) this.audio?.play('bull_slam', { pos: this.pos, pitch: 0.7 });
      if (at('stand', 8.6)) this.audio?.play('bull_roar', { pos: this.pos, volume: 1.1, pitch: 0.7 });
      this.stand = THREE.MathUtils.smoothstep(this.tt, 3, 8);
      if (!this.a.move) this.a.startMove('seat');
      this.a.move.def = this.scaledSeat(1 - this.stand);
      this.a.move.t = 50;
      if (this.tt > 9.5) { this.state = 'idle'; this.a.stopMove(); this.radius = 4.5; }
    } else if (this.state !== 'dead' && this.phase === 1) {
      if (this.staggered) { this.stagT -= dt; if (this.stagT <= 0) { this.staggered = false; this.a.stopMove(); this.a.startMove('seat'); } }
      if (this.a.move && (this.a.move.name === 'seat' || (this.a.move.name === 'bow' && this.a.move.t > 1))) this.a.move.t = Math.min(this.a.move.t, 50);
    }
    if (live && this.state === 'idle' && !this.staggered) {
      this.cool -= dt;
      if (this.cool <= 0 && horizDist(player.pos, this.pos) < 36) {
        this.cool = 5 + Math.random() * 2;
        this.state = 'attack';
        this.attack = { t: 0, at: player.pos.clone(), hit: false };
        if (this.phase === 1) { this.a.stopMove(); this.a.startMove('slam'); }
        this.fx.warnRing(this.attack.at, 4, 1.5, new THREE.Color(1.0, 0.45, 0.2));
        this.audio?.play('bull_roar', { pos: this.pos, volume: 0.5, pitch: 0.8 });
      }
    }
    if (this.state === 'attack' && this.attack) {
      const at = this.attack;
      at.t += dt;
      if (!at.hit && at.t >= 1.5) {
        at.hit = true;
        this.arena.eruption?.(at.at.x, at.at.z, 0.5);
        this.audio?.play('bull_slam', { pos: at.at });
        this.cam?.addTrauma?.(0.4);
        if (live && horizDist(player.pos, at.at) < 4.2) player.takeHit({ dmg: 22, from: this.pos.clone(), kind: 'heavy', blockable: false });
      }
      if (at.t > 2.6) { this.state = 'idle'; this.attack = null; if (this.phase === 1) { this.a.stopMove(); this.a.startMove('seat'); } }
    }
    if (this.a.move && this.a.move.name === 'seat') this.a.move.t = 50;
    if (this.a.move && this.a.move.name === 'bow' && this.a.move.t > 1) this.a.move.t = 1;
    this.a.update(dt);
  }
  /** The seated move at weight W (a scaled copy of the hips / leg targets), for the stand-up. */
  scaledSeat(W) {
    const lerp = (a, b) => a.map((v, i) => v + (b[i] - v) * W);
    const P = {
      ...SEATED, hips: lerp([0, 0, 0], SEATED.hips), spine: lerp([-10, 0, 0], SEATED.spine), head: lerp([-30, 0, 0], SEATED.head),
      legL: { at: lerp([0.1, -1, 0.05], SEATED.legL.at), pole: SEATED.legL.pole }, legR: { at: lerp([-0.1, -1, 0.05], SEATED.legR.at), pole: SEATED.legR.pole },
      armR: { at: lerp([-0.1, -0.9, 0.1], SEATED.armR.at), pole: SEATED.armR.pole }, armL: { at: lerp([0.1, -0.9, 0.1], SEATED.armL.at), pole: SEATED.armL.pole },
    };
    const def = { blendIn: 0.01, blendOut: 0.01, keys: [{ t: 0, ...P }, { t: 100, ...P }], scaled: true };
    def.track_ = new PoseTrack(def.keys, {});
    return def;
  }
}
