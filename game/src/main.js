// 长夜圣堂 · 七苦圣女 — bootstrap, post-processing, game states, hitstop, slow motion.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacter, loadBlade, loadTexture, loadGLTF } from './assets.js';
import { Actor } from './actor.js';
import { HEROINE, BOSS, HOLD_P, B_HOLD, B_KNEEL } from './moves.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { FX } from './fx.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Boss } from './boss.js';
import { Intro } from './cutscene.js';
import { OpeningMV, titleCamera } from './mv.js';
import { separate, horizDist } from './combat.js';
import { applyLook, updateLooks } from './look.js';

const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');
const $ = s => document.querySelector(s);

// ------------------------------------------------------------------ renderer + post

const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080b);
scene.fog = new THREE.FogExp2(0x0b0e14, 0.012);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 400);

const pmrem = new THREE.PMREMGenerator(renderer);
/** Reflection environment shaped like the hall: dark vault, a bright rose window high toward -Z, warm candle glints. */
function cathedralEnv() {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){ float h = vP.y * 0.5 + 0.5;
      vec3 c = mix(vec3(0.018, 0.016, 0.014), vec3(0.05, 0.06, 0.08), smoothstep(0.2, 0.9, h));
      c += vec3(0.05, 0.035, 0.02) * smoothstep(0.45, 0.0, h);  // warm candle-lit floor bounce
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  env.add(sky);
  const win = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.2), side: THREE.DoubleSide }));
  win.position.set(0, 18, -40); win.lookAt(0, 0, 0); env.add(win);
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 1.1) }));
    const a = (i / 14) * Math.PI * 2; c.position.set(Math.cos(a) * 30, -3 + (i % 3), Math.sin(a) * 30); env.add(c);
  }
  return pmrem.fromScene(env, 0.02).texture;
}
const envMap = cathedralEnv();
void RoomEnvironment;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// shallow depth of field, used only in cutscenes (filmic close-ups)
const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: 0.002, maxblur: 0.01 });
bokeh.enabled = false;
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.5, 0.95);
composer.addPass(bloom);
const finalPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uFlash: { value: 0 }, uAberr: { value: 0 },
    uVignette: { value: 0.5 }, uWarm: { value: 0 }, uDesat: { value: 0.08 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uFlash, uAberr, uVignette, uWarm, uDesat; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 off = c * (0.004 * uAberr + 0.0006);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      // cool shadows, warm highlights
      col *= mix(vec3(0.80, 0.92, 1.20), vec3(1.10, 1.0, 0.84), smoothstep(0.03, 1.1, l));
      col = max(col - 0.004, 0.0) * 1.03;   // clean blacks
      col = mix(col, col * vec3(1.12, 1.0, 0.82), uWarm);
      col *= 1.0 - uVignette * smoothstep(0.32, 0.85, r);
      col = mix(col, col * vec3(1.0, 0.25, 0.2) + vec3(0.25, 0.0, 0.0) * smoothstep(0.35, 0.8, r), uHurt * smoothstep(0.25, 0.75, r));
      col = mix(col, vec3(3.2, 3.0, 2.6), uFlash);
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finalPass);
composer.addPass(new OutputPass());
const fxaa = new FXAAPass();
composer.addPass(fxaa);

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ loading

const loadEl = $('#load');
const mvFade = $('#mvfade');
const setLoad = (s) => { loadEl.textContent = s; };

async function loadArena(textures) {
  try {
    const mod = await import('./arena.js');
    const arena = await mod.createArena({ scene, renderer, textures, quality: Q.get('quality') || 'high' });
    return arena;
  } catch (e) {
    console.warn('arena.js unavailable, using fallback', e);
    return fallbackArena();
  }
}

function fallbackArena() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 140), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.25, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = -5; floor.receiveShadow = true; scene.add(floor);
  scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x1a1612, 0.6));
  const key = new THREE.DirectionalLight(0xfff0d8, 3); key.position.set(0, 30, -60); key.target.position.set(0, 0, 0);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -25, right: 25, top: 50, bottom: -50, far: 160 });
  scene.add(key, key.target);
  const win = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4) }));
  win.position.set(0, 20, -50); scene.add(win);
  return {
    bounds: { minX: -11, maxX: 11, minZ: -36, maxZ: 44 }, colliders: [], floorY: 0, waterY: 0.06,
    playerSpawn: { x: 0, z: 38, yaw: Math.PI }, bossSpawn: { x: 0, z: -22, yaw: Math.PI },
    roseWindow: { center: new THREE.Vector3(0, 20, -50), radius: 8 }, keyLight: key, waxKnightSlots: [],
    update() {}, setPhase() {}, ripple() {}, dispose() {},
  };
}

async function loadAudio() {
  try {
    const mod = await import('./audio.js');
    return new mod.AudioSystem();
  } catch (e) {
    console.warn('audio.js unavailable', e);
    const noop = () => {};
    return { unlock: async () => {}, ready: false, setMusic: noop, play: noop, setListener: noop, duck: noop, setMuffle: noop, setVolumes: noop, update: noop };
  }
}

/** Kneeling wax-covered knights along the aisle (static poses). */
async function placeWaxKnights(arena) {
  const slots = arena.waxKnightSlots || [];
  if (!slots.length) return [];
  const out = [];
  const waxMat = base => new THREE.MeshStandardMaterial({
    color: 0xdcd3c1, roughness: 0.62, metalness: 0, normalMap: base.normalMap || null, normalScale: new THREE.Vector2(0.6, 0.6),
    emissive: new THREE.Color(0.09, 0.06, 0.03), envMapIntensity: 0.6,
  });
  for (const [i, s] of slots.entries()) {
    const c = await loadCharacter('assets/models/knight.glb', { height: 1.78 + (i % 3) * 0.04, cleanArms: false });
    c.root.position.set(s.x, 0, s.z); c.root.rotation.y = s.yaw;
    c.model.traverse(o => { if (o.isMesh) o.material = waxMat(o.material); });
    scene.add(c.root);
    const act = new Actor(c, { lib: {}, hold: null });
    act.playBase('idle', { fade: 0 });
    act.mixer.setTime(1 + i * 0.7);
    act.mixer.timeScale = 0;
    const pose = { ...B_KNEEL, head: [20 + (i % 4) * 6, (i % 2 ? 6 : -6), 0], spine: [12 + (i % 3) * 6, 0, 0] };
    act.rig.apply(pose, 1, null);
    out.push(act);
  }
  return out;
}

async function boot() {
  setLoad('载入圣堂…');
  const [roseWindow, stoneFloor, stoneWall] = await Promise.all([
    loadTexture('assets/textures/rose_window.png'), loadTexture('assets/textures/stone_floor.png', { repeat: true }), loadTexture('assets/textures/stone_wall.png', { repeat: true }),
  ]);
  const arena = await loadArena({ roseWindow, stoneFloor, stoneWall });
  if (!scene.environment) { scene.environment = envMap; scene.environmentIntensity = 1.0; }
  setLoad('载入角色…');
  await Promise.all(['heroine', 'boss_p2', 'boss_sword', 'player_sword', 'knight'].map(n => loadGLTF(`assets/models/${n}.glb`)));
  const [heroine, b1, b2] = await Promise.all([
    loadCharacter('assets/models/heroine.glb', { height: 1.7 }),
    // both forms are the white-and-gold saint: phase one 'holy' (ivory, soft inner light), phase two 'radiant' (gold, wings)
    loadCharacter('assets/models/boss_p2.glb', { height: 5.1 }),
    loadCharacter('assets/models/boss_p2.glb', { height: 5.1 }),
  ]);
  const pSword = await loadBlade('assets/models/player_sword.glb', { length: 1.15, gripFrac: 0.13 });
  // two hand swords (one per boss form) at full size, seven slightly shorter ones fanned in her back
  const bSwords = await Promise.all(Array.from({ length: 9 }, (_, i) => loadBlade('assets/models/boss_sword.glb', { length: i < 2 ? 3.9 : 3.2, gripFrac: 0.1 })));
  scene.add(heroine.root, b1.root, b2.root);
  // metal that reads, an edge of light, the saint's own light, a key for the fighters (src/look.js)
  applyLook(heroine.model, 'heroine');
  applyLook(b1.model, 'bossHoly');
  applyLook(b2.model, 'bossPure');
  applyLook(pSword, 'blade');
  for (const s of bSwords) applyLook(s, 'holyBlade');
  const audio = await loadAudio();
  const fx = new FX(scene, { arena });
  const input = new Input(canvas);
  const ui = new UI();
  const camRig = new CameraRig(camera, { bounds: arena.bounds });
  if (arena.cameraBlockers) camRig.blockers = arena.cameraBlockers;
  const pActor = new Actor(heroine, { lib: HEROINE, hold: HOLD_P, sword: pSword, scene });
  const b1Actor = new Actor(b1, { lib: BOSS, hold: B_HOLD, sword: bSwords[0], scene });
  const b2Actor = new Actor(b2, { lib: BOSS, hold: B_HOLD, sword: bSwords[1], scene });
  pActor.playBase('idle', { fade: 0 }); b1Actor.playBase('idle', { fade: 0 }); b2Actor.playBase('idle', { fade: 0 });
  b1Actor.setBaseTimeScale(0.7); b2Actor.setBaseTimeScale(0.7);
  const pTrail = fx.trail({ color: new THREE.Color(0.95, 0.9, 0.8), life: 0.13, opacity: 0.5 });
  const bTrail = fx.trail({ color: new THREE.Color(1.0, 0.82, 0.5), life: 0.22, opacity: 0.85, samples: 28 });
  const player = new Player({ actor: pActor, fx, audio, cam: camRig, input, arena, trail: pTrail });
  const boss = new Boss({ p1: b1Actor, p2: b2Actor, swords: bSwords.slice(2), scene, fx, audio, arena, cam: camRig });
  // the camera never ends up inside her robe (free look with her behind you)
  const bossBody = [{ x: 0, z: 0, r: 1.15, top: 5.0 }], noBodies = [];
  camRig.bodies = () => {
    if (boss.dead || !boss.a.char.root.visible) return noBodies;
    bossBody[0].x = boss.pos.x; bossBody[0].z = boss.pos.z;
    return bossBody;
  };
  boss.trail = bTrail;
  // keep the shadow camera on the fight
  if (arena.keyLight) arena.keyLight.shadow.bias = arena.keyLight.shadow.bias || -0.0004;
  setLoad('');
  const knights = await placeWaxKnights(arena).catch(e => { console.warn('wax knights', e); return []; });

  // character light: a soft spot from the camera so the heroine stays readable against the bright window
  const bossLight = new THREE.PointLight(0xe6eeff, 0, 22, 2);
  scene.add(bossLight);
  const charLight = new THREE.SpotLight(0xdde3f0, 7, 10, 0.42, 0.85, 2);
  charLight.castShadow = false;
  scene.add(charLight, charLight.target);

  const G = { arena, audio, fx, input, ui, camRig, player, boss, knights, charLight, bossLight, state: 'title', time: 0, hitstop: 0, slowmo: 1, slowmoT: 0,
    flash: 0, hurt: 0, aberr: 0, intro: null, introSeen: false, paused: false, god: Q.has('god'), deaths: 0 };
  window.__game = G;
  player.god = G.god;

  function resetWorld({ retry = false } = {}) {
    const sp = arena.playerSpawn, bs = arena.bossSpawn;
    G.finale = false;
    player.reset(retry ? { x: sp.x, z: Math.min(sp.z, bs.z + 30), yaw: sp.yaw } : sp);
    boss.hp = boss.T.maxHp; boss.poise = 0; boss.phase = 1; boss.dead = false; boss.finale = false; boss.pendingChain = null; boss.chain = 0; boss.staggered = false; boss.invulnerable = true;
    boss.timeline = []; boss.turnGoal = null; boss.prayFreeze = false; boss.dissolve = null; boss.wingAlpha = 0; boss.trailOn = false;
    boss.deadT = 0;
    for (const a of boss.actors) { if (a.char.model.userData.look) { a.char.model.userData.look.dissolve = 0; a.char.model.userData.look.glow = 0; } a.stopMove(); a.char.model.traverse(o => { if (o.isMesh) { o.material.opacity = 1; o.material.transparent = false; o.material.depthWrite = true; if (o.material.emissive) { o.material.emissive.setRGB(0, 0, 0); o.material.emissiveIntensity = 1; } } }); }
    boss.a = boss.actors[0]; boss.actors[0].char.root.visible = true; boss.actors[1].char.root.visible = false;
    for (const s of boss.backSwords) { s.state = 'back'; s.t = 0; s.setOpacity(1); s.setGlow(0); s.landed = false; s.fallTo = null; }
    boss.setPos(bs.x, bs.z, retry ? 0 : bs.yaw);
    if (retry) { boss.backSwords[3].state = 'drawn'; boss.armed(true); boss.state = 'idle'; }
    else { boss.armed(false); boss.state = 'dormant'; boss.a.startMove('rise'); boss.a.move.t = 0.2; }
    camRig.setLock(null); player.lockOn = false;
    arena.relightCandles?.();
    camRig.snapBehind(player.pos, player.yaw);
    ui.setPlayer(player.hp, player.T.maxHp, player.st, player.T.maxSt, player.flasks);
    ui.setBoss(boss.hp, boss.T.maxHp);
    arena.setPhase(0);
  }

  function beginApproach() {
    resetWorld();
    G.state = 'approach';
    ui.showHUD(true); ui.showBoss(false);
    ui.card_('长夜圣堂', 'area', 4.5, '七苦圣女于此长跪千年');
    audio.setMusic('hymn', { fade: 3 });
    audio.play('bell', { volume: 0.5 });
  }

  function beginIntro() {
    G.state = 'intro';
    player.a.stopMove(); player.speed = 0; player.a.playBase('idle', { fade: 0.4 });
    G.intro = new Intro({ camera, boss, player, audio, ui, arena, fx, onDone: () => beginFight() });
  }

  function beginFight({ retry = false } = {}) {
    G.state = 'fight'; G.intro = null; G.introSeen = true;
    boss.wake();
    if (retry) boss.cooldown = 2.0;
    ui.showHUD(true); ui.showBoss(true);
    audio.setMusic('phase1', { fade: retry ? 1.5 : 0.4 });
    arena.setPhase(1);
    camRig.snapBehind(player.pos, Math.atan2(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z));
    toggleLock(true);
    if (!retry) { G.flash = 0.35; camRig.addTrauma(0.3); }
  }

  function toggleLock(force) {
    const want = force !== undefined ? force : !camRig.locked;
    if (want && !boss.dead && horizDist(player.pos, boss.pos) < 70) { camRig.setLock(() => boss.lockPoint); audio.play('lockon', { volume: 0.6 }); }
    else camRig.setLock(null);
    player.lockOn = camRig.locked;
  }

  function onPlayerDead() {
    G.state = 'dead'; G.deaths++;
    toggleLock(false);
    audio.setMusic('defeat', { fade: 0.4 });
    G.slowmo = 0.4; G.slowmoT = 1.4;
    setTimeout(() => ui.card_('祷告未尽', 'death', 4.2), 900);
    setTimeout(() => $('#fade').classList.add('on'), 4600);
    setTimeout(() => {
      resetWorld({ retry: true });
      $('#fade').classList.remove('on');
      G.state = 'fight-wait'; G.waitT = 1.2;
      ui.showBoss(true);
    }, 6400);
  }

  function onBossDead() {
    G.state = 'victory';
    toggleLock(false);
    G.slowmo = 0.25; G.slowmoT = 2.2; G.flash = 0.6;
    audio.setMusic('victory', { fade: 2.5 });
    // she kneels, fills with light and the swords fall around her; dawn comes up; the card waits until she burns away
    setTimeout(() => { ui.showBoss(false); arena.setPhase(3); }, 3200);
    setTimeout(() => { if (G.state === 'victory') ui.card_('祷告已终', 'victory', 7, '七 苦 圣 女 · 安 息'); }, 6800);
    setTimeout(() => ui.setHint('R 重新挑战'), 9800);
  }

  // events from actors
  function drainEvents() {
    for (const e of player.events.splice(0)) {
      if (e.type === 'hit') { G.hitstop = Math.max(G.hitstop, e.hitstop); if (e.heavy) G.aberr = 0.8; input.rumble(e.heavy ? 0.8 : 0.4, 0.4, e.heavy ? 150 : 80); }
      if (e.type === 'hurt') { G.hitstop = Math.max(G.hitstop, e.hitstop); G.hurt = 1; G.aberr = Math.max(G.aberr, 0.6); }
      if (e.type === 'block') { G.hitstop = Math.max(G.hitstop, e.hitstop); G.aberr = Math.max(G.aberr, 0.3); }
      if (e.type === 'parry') { G.hitstop = Math.max(G.hitstop, 0.11); G.slowmo = 0.35; G.slowmoT = 0.35; G.flash = Math.max(G.flash, 0.22); G.aberr = 0.9; }
      if (e.type === 'guardbreak') { G.hitstop = Math.max(G.hitstop, e.hitstop); G.hurt = 0.6; }
      if (e.type === 'critical') { G.hitstop = Math.max(G.hitstop, 0.24); G.slowmo = 0.3; G.slowmoT = 0.55; G.flash = Math.max(G.flash, 0.16); G.aberr = 1; input.rumble(1, 0.8, 300); }
      if (e.type === 'dead') onPlayerDead();
    }
    for (const e of boss.events.splice(0)) {
      if (e.type === 'damage') { ui.addBossDamage(e.amount); }
      if (e.type === 'transition-start') { G.slowmo = 0.35; G.slowmoT = 1.0; toggleLock(false); }
      if (e.type === 'phase2') { G.flash = 1; G.slowmo = 0.3; G.slowmoT = 1.4; audio.setMusic('phase2', { fade: 0.6 }); arena.setPhase(2); }
      if (e.type === 'transition-end') { toggleLock(true); }
      if (e.type === 'dead') onBossDead();
    }
  }

  // splash -> opening MV -> title -> start
  const title = $('#title'), splash = $('#splash');
  title.querySelector('.menu').style.display = '';
  const showTitle = (menu) => { title.classList.remove('hide'); title.classList.toggle('nomenu', !menu); };
  const startMV = async () => {
    if (G.state !== 'splash') return;
    splash.classList.add('hide');
    await audio.unlock();
    G.state = 'mv'; ui.showHUD(false);
    G.mv = new OpeningMV({ camera, scene, boss, player, audio, arena, fx, textEl: $('#mvtext'), clock: () => G.time,
      onTitle: () => showTitle(false),
      onDone: (skipped) => {
        G.state = 'title'; ui.setHint(''); showTitle(true);
        player.a.setBaseTimeScale?.(1); resetWorld();
        if (!skipped) audio.setMusic('hymn', { fade: 5 });
      } });
    ui.setHint('Enter 跳过');
  };
  splash.addEventListener('click', startMV);
  if (!Q.has('autostart')) { G.state = 'splash'; splash.classList.add('ready'); if (Q.has('mv')) startMV(); }
  else { splash.classList.add('hide'); showTitle(true); }
  $('#ctrlbtn').addEventListener('click', e => { e.stopPropagation(); $('#ctrl').classList.toggle('on'); });
  resetWorld();          // the saint kneels behind the title
  const start = async () => {
    if (G.state !== 'title') return;
    title.classList.add('hide');
    await audio.unlock();
    canvas.requestPointerLock?.()?.catch?.(() => {});
    beginApproach();
    if (Q.has('skipintro')) { beginIntro(); G.intro.skip(); ui.card.classList.remove('on'); }
  };
  title.addEventListener('click', start);
  if (Q.has('autostart')) start();

  function retryNow() {
    if (G.paused) togglePause(false);
    resetWorld({ retry: true }); G.state = 'fight-wait'; G.waitT = 1; ui.showBoss(true); ui.setHint('');
  }
  addEventListener('keydown', e => {
    if (e.code === 'Escape' && ['fight', 'approach', 'fight-wait'].includes(G.state)) togglePause();
    if (e.code === 'KeyR' && (G.state === 'victory' || G.paused)) retryNow();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && ['fight', 'approach'].includes(G.state) && !G.paused && !DEBUG) togglePause(true);
  });
  function togglePause(force) {
    G.paused = force !== undefined ? force : !G.paused;
    $('#pause').classList.toggle('on', G.paused);
    // paused: free the cursor so the settings can be used (Start on a pad / the pause key do not release it by themselves)
    if (G.paused) { if (document.pointerLockElement) document.exitPointerLock?.(); }
    else canvas.requestPointerLock?.()?.catch?.(() => {});
  }
  // clicking the dim backdrop resumes; the panel itself holds the settings
  $('#pause').addEventListener('click', e => { if (e.target.id === 'pause') togglePause(false); });
  $('#p-resume').addEventListener('click', () => togglePause(false));
  $('#p-retry').addEventListener('click', () => { if (['fight', 'approach', 'fight-wait', 'dead'].includes(G.state)) retryNow(); else togglePause(false); });

  // ------------------------------------------------------------------ settings (pause panel, kept in localStorage)
  const SETTINGS_KEY = 'hunxi.settings.v1';
  const settings = { master: 100, music: 85, sfx: 100, sens: 100, shake: 100, invY: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* private mode: defaults */ }
  function applySettings() {
    audio.setVolumes({ master: settings.master / 100, music: settings.music / 100, sfx: settings.sfx / 100 });
    input.lookSensitivity = 0.0024 * settings.sens / 100; input.padLookScale = settings.sens / 100;
    input.invertY = !!settings.invY;
    camRig.shakeScale = settings.shake / 100;
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

  // ------------------------------------------------------------------ loop
  const timer = new THREE.Timer();
  timer.connect?.(document);
  const listenerFwd = new THREE.Vector3();
  function frame() {
    requestAnimationFrame(frame);
    timer.update();
    const rawDt = timer.getDelta();
    let dt = Math.min(rawDt, 1 / 20);
    if (G.fixedDt) dt = G.fixedDt;
    G.fps = G.fps ? G.fps * 0.95 + (1 / Math.max(rawDt, 1e-3)) * 0.05 : 60;
    G.time += dt;
    input.update(dt);
    // gamepad Start opens / closes the pause menu (the keyboard's Esc is handled by its keydown listener)
    if (input.take('menu', 0.3) && ['fight', 'approach', 'fight-wait'].includes(G.state)) togglePause();
    if (G.paused) { composer.render(dt); return; }

    // slow motion + hitstop
    if (G.slowmoT > 0) { G.slowmoT -= dt; if (G.slowmoT <= 0) G.slowmo = 1; }
    const gdt = dt * G.slowmo;
    let adt = gdt;
    if (G.hitstop > 0) { G.hitstop -= dt; adt = 0; }

    if (input.take('lock', 0.3) && ['fight'].includes(G.state)) toggleLock();
    if (G.state === 'intro' && (input.take('skip', 1) || input.take('pause', 1))) G.intro.skip();
    if (G.state === 'mv' && (input.take('skip', 1) || input.take('pause', 1) || input.take('menu', 1))) G.mv.skip();
    player.god = G.god;

    const look = input.look(dt);
    switch (G.state) {
      case 'mv': G.mv.update(dt); break;
      case 'splash':
      case 'title': {
        // slow drift around the kneeling saint, rose window above her (the MV's last shot is this same camera)
        titleCamera(camera, boss.pos, G.time);
        if (camera.fov !== 42) { camera.fov = 42; camera.updateProjectionMatrix(); }
        boss.a.move && (boss.a.move.t = 0.2);
        boss.a.update(dt); boss.syncSwords(dt, player);
        break;
      }
      case 'approach': {
        player.update(adt, null);
        boss.a.move && (boss.a.move.t = 0.2);   // hold the kneeling pose (past the blend-in)
        boss.a.update(adt);
        boss.syncSwords(adt, player);
        camRig.update(dt, player.pos, look);
        if (horizDist(player.pos, boss.pos) < 17) beginIntro();
        break;
      }
      case 'intro':
        G.intro.update(gdt);
        player.a.update(gdt);
        boss.a.root.position.copy(boss.pos); boss.a.root.rotation.y = boss.yaw;
        boss.a.update(gdt);
        boss.syncSwords(gdt, player);
        break;
      case 'fight-wait':
        G.waitT -= dt;
        player.update(adt, boss); boss.a.update(adt); boss.syncSwords(adt, player);
        camRig.update(dt, player.pos, look);
        if (G.waitT <= 0) beginFight({ retry: true });
        break;
      case 'fight':
      case 'dead':
      case 'victory': {
        player.update(adt, boss.dead ? null : boss);
        boss.update(adt, player);
        if (!boss.dead) separate(player.pos, 0.38, boss.pos, boss.T.radius, 0.92);
        camRig.update(dt, player.pos, look);
        drainEvents();
        break;
      }
    }
    if (camRig.locked && boss.dead) toggleLock(false);
    if (G.debugCam) { camera.position.copy(G.debugCam.pos); camera.lookAt(G.debugCam.look); if (G.debugCam.fov) { camera.fov = G.debugCam.fov; camera.updateProjectionMatrix(); } }

    if (boss.a.char.root.visible) {
      const chest = boss.lockPoint;
      // in front of her and lower: it lights the water and whoever stands before her more than her own body
      bossLight.position.copy(chest).addScaledVector(boss.a.rig.F, 3.6); bossLight.position.y = 1.8;
      const gold = boss.phase === 2;
      bossLight.color.setRGB(gold ? 1.0 : 0.86, gold ? 0.84 : 0.92, gold ? 0.58 : 1.0);
      bossLight.intensity = (boss.dead ? (boss.dissolve ? 4 : 8) : gold ? 20 : 10) * (G.state === 'title' ? 0.6 : 1);
    } else bossLight.intensity = 0;
    updateLooks(camera);
    charLight.position.copy(camera.position).y += 0.6;
    charLight.target.position.set(player.pos.x, 1.2, player.pos.z);
    charLight.intensity = ['fight', 'approach', 'fight-wait', 'dead', 'victory'].includes(G.state) ? 2.2 : 0;
    fx.update(gdt);
    arena.update(dt, G.time, camera);
    camera.getWorldDirection(listenerFwd);
    audio.setListener({ position: camera.position, forward: listenerFwd });
    // the music closes in at low health and in slow motion; a heartbeat under a quarter health
    const hpK = player.hp / player.T.maxHp, low = G.state === 'fight' && !player.dead && hpK < 0.3;
    audio.setMuffle(Math.max(low ? 0.35 + (0.3 - hpK) * 1.8 : 0, G.slowmoT > 0 && G.slowmo < 1 ? 0.5 : 0));
    G.heartT = (G.heartT || 0) - dt;
    if (low && hpK < 0.25 && G.heartT <= 0) { audio.play('heartbeat', { volume: 0.9 }); G.heartT = hpK < 0.12 ? 0.62 : 0.84; }
    audio.update(dt);

    ui.setPlayer(player.hp, player.T.maxHp, player.st, player.T.maxSt, player.flasks);
    ui.setBoss(boss.hp, boss.T.maxHp);
    ui.setReticle(camRig.locked && G.state === 'fight' ? boss.lockPoint : null, camera, renderer);
    if (G.state === 'fight') { const open = boss.criticalOpen(player) && player.canAct(); if (open !== G.critHint) { G.critHint = open; ui.setHint(open ? '左键 · 处决' : ''); } }
    // the last quarter of her life: the score climbs to its finale, a bell tolls, her halo flares
    if (G.state === 'fight' && !G.finale && boss.phase === 2 && !boss.dead && boss.state !== 'transition' && boss.hp <= boss.T.maxHp * 0.25) {
      G.finale = true;
      audio.setMusic('finale', { fade: 1.2 });
      audio.play('bell', { volume: 0.8, pitch: 0.94 });
      boss.flareHalo?.();
      camRig.addTrauma(0.15);
    }
    ui.update(dt);

    G.flash = Math.max(0, G.flash - dt * 1.6);
    G.hurt = Math.max(0, G.hurt - dt * 1.4);
    G.aberr = Math.max(0, G.aberr - dt * 3);
    const u = finalPass.uniforms;
    u.uTime.value = G.time; u.uFlash.value = G.flash * G.flash; u.uHurt.value = Math.max(G.hurt, player.hp / player.T.maxHp < 0.25 ? 0.35 : 0);
    u.uAberr.value = G.aberr; u.uWarm.value = boss.phase === 2 ? 0.22 : G.state === 'victory' ? 0.5 : 0;
    const dof = (G.state === 'intro' && G.intro && G.intro.dof) || (G.state === 'mv' && G.mv && G.mv.dof);
    mvFade.style.opacity = G.state === 'mv' && G.mv ? G.mv.black.toFixed(3) : '0';
    bokeh.enabled = !!dof;
    if (dof) { bokeh.uniforms.focus.value = dof.focus; bokeh.uniforms.aperture.value = dof.aperture; bokeh.uniforms.maxblur.value = dof.maxblur; }
    composer.render(dt);
  }
  frame();
  window.__ready = true;
}

boot().catch(e => {
  console.error(e);
  setLoad('载入失败：' + e.message);
  window.__error = String(e && e.stack || e);
});
