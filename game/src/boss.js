// 七苦圣女 — boss AI: approach, delayed slam, double sweep, lunge thrust, seven-sword volley, prayer pillars,
// phase two (wax burns away, wings of light), stagger, death.
import * as THREE from 'three';
import { ease } from './pose.js';
import { sweepBlade, horizDist, angleTo, yawLerp, clampToArena } from './combat.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

export const BOSS_TUNING = {
  maxHp: 1450, poiseMax: 110, poiseRegen: 14, radius: 1.15,
  walk1: 1.75, walk2: 2.35, turn1: 75, turn2: 115,
};

function wingTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  // radiating feather streaks from the root (bottom-left)
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (i / 25) * 1.25;
    const len = 380 + Math.sin(i * 1.7) * 60;
    const x1 = 20 + Math.cos(a + Math.PI) * -len * 0.5, y1 = 500 + Math.sin(a) * len;
    const grd = g.createLinearGradient(20, 500, x1, y1);
    grd.addColorStop(0, 'rgba(255,240,205,0.95)'); grd.addColorStop(0.7, 'rgba(255,225,170,0.45)'); grd.addColorStop(1, 'rgba(255,220,160,0)');
    g.strokeStyle = grd; g.lineWidth = 10 + (i % 3) * 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(20, 500); g.quadraticCurveTo(60 + i * 4, 300, x1, y1); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Radial glory for the halo: a soft band at the rings, fading out, crossed by faint rays. */
function haloTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  const band = g.createRadialGradient(m, m, 0, m, m, m);
  band.addColorStop(0.0, 'rgba(255,240,210,0)');
  band.addColorStop(0.38, 'rgba(255,236,200,0.05)');
  band.addColorStop(0.55, 'rgba(255,230,185,0.55)');
  band.addColorStop(0.62, 'rgba(255,240,215,0.9)');
  band.addColorStop(0.7, 'rgba(255,226,180,0.45)');
  band.addColorStop(1.0, 'rgba(255,220,170,0)');
  g.fillStyle = band; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2, r0 = m * 0.42, r1 = m * (0.86 + (i % 3) * 0.05);
    const ray = g.createLinearGradient(m + Math.cos(a) * r0, m + Math.sin(a) * r0, m + Math.cos(a) * r1, m + Math.sin(a) * r1);
    ray.addColorStop(0, 'rgba(255,235,200,0.0)'); ray.addColorStop(0.35, `rgba(255,235,200,${i % 2 ? 0.1 : 0.18})`); ray.addColorStop(1, 'rgba(255,235,200,0)');
    g.strokeStyle = ray; g.lineWidth = i % 2 ? 2 : 4;
    g.beginPath(); g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0); g.lineTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class BackSword {
  constructor(obj, index) {
    this.obj = obj; this.i = index;
    this.state = 'back';     // back | rising | hover | flying | stuck | gone | regrow | drawn | fallen
    this.t = 0;
    this.pos = new THREE.Vector3(); this.dir = new THREE.Vector3(0, 1, 0);
    this.vel = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.opacity = 1;
    obj.traverse(o => { if (o.isMesh) { o.material.transparent = true; } });
  }
  setOpacity(a) {
    this.opacity = a;
    this.obj.traverse(o => { if (o.isMesh) { o.material.opacity = a; o.material.depthWrite = a > 0.95; } });
    this.obj.visible = a > 0.01;
  }
  setGlow(k) {
    this.obj.traverse(o => { if (o.isMesh && o.material.emissive) { o.material.emissive.setRGB(1, 0.85, 0.55); o.material.emissiveIntensity = k; } });
  }
  place(pos, dirTipward) {
    // holder +Y runs grip -> tip
    this.pos.copy(pos); this.dir.copy(dirTipward).normalize();
    this.obj.position.copy(pos);
    this.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
    this.obj.updateMatrixWorld(true);
  }
  tip(out = new THREE.Vector3()) {
    const L = this.obj.userData.length, gf = this.obj.userData.gripFrac;
    return out.copy(this.pos).addScaledVector(this.dir, L * (1 - gf));
  }
}

export class Boss {
  constructor({ p1, p2, swords, scene, fx, audio, arena, cam }) {
    this.actors = [p1, p2];
    this.a = p1;
    p2.char.root.visible = false;
    this.scene = scene; this.fx = fx; this.audio = audio; this.arena = arena; this.cam = cam;
    const T = BOSS_TUNING; this.T = T;
    this.hp = T.maxHp; this.poise = 0; this.poiseTimer = 0;
    this.phase = 1;
    this.state = 'dormant';
    this.yaw = Math.PI;
    this.pos = new THREE.Vector3();
    this.cooldown = 1.0;
    this.cds = { volley: 6, pray: 14, wing: 8 };
    this.lastAttack = '';
    this.dead = false;
    this.staggered = false;
    this.invulnerable = true;
    this.backSwords = swords.map((s, i) => new BackSword(s, i));
    for (const s of this.backSwords) scene.add(s.obj);
    this.hand = null;            // the sword in her hand (Actor.sword)
    this.trail = null;
    this.hitThisSwing = new Set();
    this.events = [];
    this.timeline = [];          // scripted sequences (transition/death)
    this.wings = this.makeWings();
    this.halo = this.makeHalo();
    this.wingAlpha = 0;
    this.stepAcc = 0;
    this.flinchT = 0;
    this.agro = false;
  }

  setPos(x, z, yaw) {
    this.pos.set(x, 0, z); this.yaw = yaw;
    for (const a of this.actors) { a.root.position.copy(this.pos); a.root.rotation.y = yaw; a.root.updateMatrixWorld(true); }
  }

  /** Hand sword visibility + overlay (no sword during the kneeling intro). */
  armed(on) {
    for (const a of this.actors) {
      if (a.sword) a.sword.visible = on && a === this.a;
      a.holdW = on ? 1 : 0;
    }
  }

  makeWings() {
    const tex = wingTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.0, 0.8, 0.5) });
    const g = new THREE.PlaneGeometry(4.6, 9.0); g.translate(2.1, 3.8, 0);
    const L = new THREE.Mesh(g, mat), R = new THREE.Mesh(g, mat);
    R.scale.x = -1;
    const grp = new THREE.Group(); grp.add(L, R); grp.visible = false;
    L.renderOrder = R.renderOrder = 7;
    this.scene.add(grp);
    return { grp, L, R, mat };
  }

  makeHalo() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 0.98, 0.55), transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.018, 8, 96), mat);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.008, 6, 96), mat);
    // the glory behind the rings: a soft band of light and faint rays, the way the old paintings do it
    const glowMat = new THREE.MeshBasicMaterial({ map: haloTexture(), color: new THREE.Color(1.0, 0.86, 0.6), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), glowMat);
    glow.position.z = -0.02; glow.renderOrder = 5;
    g.add(glow, ring, inner);
    g.renderOrder = 6;
    this.scene.add(g);
    return { g, mat, glowMat };
  }

  /** The finale: her halo blazes and widens for a moment; from now on she is a little faster. */
  flareHalo() {
    this.haloFlare = 1; this.finale = true;
    this.fx.light(this.a.bonePos('Head', new THREE.Vector3()), 0xffe6b0, 60, 1.0, 16);
    this.fx.motes(this.lockPoint, 2.2, 40);
  }

  updateHalo() {
    const h = this.halo, rig = this.a.rig;
    const head = this.a.bonePos('Head', new THREE.Vector3());
    h.g.position.copy(head).addScaledVector(rig.F, -0.42).addScaledVector(rig.U, 0.16);
    h.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rig.R, rig.U, rig.F.clone().negate()));
    const k = this.dead ? Math.max(0, 1 - (this.dissolve || 0)) : 1;
    h.mat.opacity = (this.phase === 2 ? 1 : 0.8) * k * (0.92 + 0.08 * Math.sin(this.fx.now * 1.7));
    this.haloFlare = Math.max(0, (this.haloFlare || 0) - 0.016);
    h.mat.color.setRGB(1.25, 0.98, 0.55).multiplyScalar((this.phase === 2 ? 1.5 : 1) + this.haloFlare * 2.5);
    h.glowMat.opacity = (this.phase === 2 ? 0.62 : 0.48) * k * (0.9 + 0.1 * Math.sin(this.fx.now * 1.3)) * (1 + this.haloFlare);
    h.g.scale.setScalar(1 + this.haloFlare * 0.35);
    h.g.visible = this.a.char.root.visible && h.mat.opacity > 0.01;
  }

  get lockPoint() { return this.a.bonePos('Spine2', new THREE.Vector3()); }

  hurtCapsules() {
    const a = this.a;
    const hips = a.bonePos('Hips'), neck = a.bonePos('Neck'), head = a.bonePos('HeadTop_End');
    const feet = a.bonePos('LeftFoot').add(a.bonePos('RightFoot')).multiplyScalar(0.5);
    return [
      { a: hips, b: neck, r: 0.62, part: 'torso' },
      { a: neck.clone(), b: head, r: 0.38, part: 'head' },
      { a: hips.clone(), b: feet, r: 0.8, part: 'legs' },
      { a: a.bonePos('RightArm'), b: a.bonePos('RightHand'), r: 0.26, part: 'arm' },
      { a: a.bonePos('LeftArm'), b: a.bonePos('LeftHand'), r: 0.26, part: 'arm' },
    ];
  }

  takeHit({ dmg, poise, point, dir, heavy, from }) {
    if (this.dead) return;
    const crit = this.staggered;
    if (this.invulnerable) {
      this.fx.hitSpark(point, dir, false);
      this.audio?.play('stagger', { pos: point, volume: 0.35, pitch: 1.4 });
      return;
    }
    const total = dmg * (crit ? 1.55 : 1) * (this.phase === 2 ? 0.92 : 1);
    this.hp -= total;
    this.events.push({ type: 'damage', amount: total });
    this.fx.hitSpark(point, dir, heavy || crit);
    this.fx.flashMesh(this.a.char.model, new THREE.Color(1, 0.78, 0.5), heavy ? 0.14 : 0.09, heavy ? 0.22 : 0.13);
    const away = from ? new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z) : dir;
    this.a.jolt(away, heavy || crit ? 0.085 : 0.05, heavy ? 0.006 : 0.004);    // even hyper armour takes the blow
    this.audio?.play(heavy || crit ? 'hit_heavy' : 'hit_flesh', { pos: point });
    this.cam.addTrauma(heavy ? 0.32 : 0.16);
    this.cam.punch(dir, heavy ? 0.12 : 0.05);
    if (heavy) this.cam.zoomPunch(2.5);
    this.poise += poise; this.poiseTimer = 3;
    if (!this.a.move && (this.state === 'idle' || this.state === 'walk')) this.a.startMove('hurt');  // upper-body jolt; attacks keep hyper armor
    if (this.hp <= 0) { this.die(); return; }
    if (this.phase === 1 && this.hp <= this.T.maxHp * 0.5) { this.startTransition(); return; }
    if (this.poise >= this.T.poiseMax && this.state !== 'stagger' && this.state !== 'transition') this.stagger();
  }

  /** True while she is down on one knee and the player stands before her, close enough to strike her heart. */
  criticalOpen(player) {
    const mv = this.a.move;
    if (!this.staggered || this.dead || this.critTaken || this.state !== 'stagger' || !mv || mv.name !== 'stagger') return false;
    if (mv.t < 0.25 || mv.t > 2.0) return false;
    return horizDist(this.pos, player.pos) < 4.8 && Math.abs(angleTo(this.pos, this.yaw, player.pos)) < 1.3;
  }

  takeCritical({ dmg, point, dir, from }) {
    if (this.dead) return;
    this.critTaken = true;                 // one execution per kneel
    this.hp -= dmg;
    this.a.jolt(from ? new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z) : dir, 0.16, 0.008);
    this.events.push({ type: 'damage', amount: dmg });
    this.fx.hitSpark(point, dir, true); this.fx.hitSpark(point, dir.clone().negate(), true);
    this.fx.motes(point, 0.8, 40);
    this.fx.light(point, 0xffd890, 30, 0.45, 10);
    this.fx.flashMesh(this.a.char.model, new THREE.Color(1, 0.76, 0.46), 0.3, 0.24);
    this.audio?.play('critical', { pos: point });
    this.audio?.play('hit_heavy', { pos: point, pitch: 0.85, volume: 0.7 });
    this.cam.addTrauma(0.7); this.cam.zoomPunch(6);
    if (this.hp <= 0) { this.die(); return; }
    if (this.phase === 1 && this.hp <= this.T.maxHp * 0.5) { this.startTransition(); return; }
    if (this.a.move && this.a.move.name === 'stagger') this.a.move.t = 0.4;   // she stays down a little longer
    this.staggered = true;
  }

  /** Her blade was turned by a perfect guard: a jolt of poise damage (three in a row break her). */
  parried(point) {
    this.poise += 42; this.poiseTimer = 3;
    this.fx.flashMesh(this.a.char.model, new THREE.Color(1, 0.8, 0.55), 0.12, 0.18);
    this.cam.addTrauma(0.15);
    if (point) this.a.jolt(new THREE.Vector3(this.pos.x - point.x, 0, this.pos.z - point.z), 0.11, 0.005);   // the deflected blow rocks her back
    if (this.poise >= this.T.poiseMax && this.state !== 'transition' && !this.dead) { this.a.stopMove(); this.stagger(); }
  }

  stagger() {
    this.pendingChain = null; this.chain = 0;
    this.poise = 0; this.critTaken = false;
    this.state = 'stagger'; this.staggered = true;
    this.trail && (this.trailOn = false);
    this.a.startMove('stagger');
    this.audio?.play('stagger', { pos: this.pos });
    this.cam.addTrauma(0.35);
    this.fx.splash(this.pos, 2.2);
    this.fx.dust(this.pos, 2.5, 30);
  }

  // --------------------------------------------------------------------------------------- scripted sequences

  run(steps) {  // steps: [[delay, fn], ...] relative times
    let t = 0;
    this.timeline = steps.map(([d, fn]) => ({ at: (t += d), fn, done: false }));
    this.timelineT = 0;
  }

  startTransition() {
    this.pendingChain = null; this.chain = 0;
    this.state = 'transition'; this.invulnerable = true; this.staggered = false;
    this.a.startMove('stagger');
    this.audio?.duck(0.2, 6);
    this.events.push({ type: 'transition-start' });
    const away = Math.atan2(-(this.pos.x), -(this.pos.z + 60)); // toward the altar (-Z)
    this.turnGoal = null;
    this.run([
      [0.9, () => { this.turnGoal = away; }],
      [1.4, () => { this.a.startMove('pray'); this.a.move.t = 0; this.prayFreeze = true; }],
      [1.2, () => { this.audio?.play('bell', { pos: this.pos, volume: 0.5, pitch: 0.7 }); this.fx.motes(this.lockPoint, 1.6, 60); }],
      [0.7, () => { this.audio?.play('sword_glint', { pos: this.pos, pitch: 0.8 }); this.fx.motes(this.lockPoint, 2.4, 110); this.fx.light(this.lockPoint, 0xffe6b0, 50, 0.7, 18); this.cam.addTrauma(0.25); }],
      [0.8, () => this.swapToPhase2()],
      [1.0, () => { this.prayFreeze = false; this.a.move && (this.a.move.t = 3.9); }],
      [1.3, () => { this.turnGoal = 'player'; }],
      [1.3, () => { this.state = 'idle'; this.invulnerable = false; this.cooldown = 0.6; this.turnGoal = null; this.events.push({ type: 'transition-end' }); }],
    ]);
  }

  swapToPhase2() {
    const old = this.a, nu = this.actors[1];
    nu.root.position.copy(old.root.position); nu.root.rotation.y = old.root.rotation.y;
    nu.playBase('idle', { fade: 0 });
    if (old.move) { nu.startMove(old.move.name); nu.move.t = old.move.t; }
    old.char.root.visible = false; if (old.sword) old.sword.visible = false;
    nu.char.root.visible = true; if (nu.sword) nu.sword.visible = true;
    this.a = nu; this.phase = 2;
    this.wings.grp.visible = true;
    this.fx.flashMesh(nu.char.model, new THREE.Color(1, 0.92, 0.8), 1.1, 1.0);
    this.fx.light(this.lockPoint, 0xfff3d6, 140, 1.2, 30);
    this.fx.motes(this.pos, 3, 80);
    this.audio?.play('phase_shift', { pos: this.pos });
    this.cam.addTrauma(0.6);
    this.events.push({ type: 'phase2' });
  }

  die() {
    this.pendingChain = null; this.chain = 0;
    this.dead = true; this.hp = 0; this.state = 'dead'; this.invulnerable = true; this.staggered = false;
    this.deadT = 0; this.turnGoal = null;
    this.events.push({ type: 'dead' });
    this.audio?.play('boss_death', { pos: this.pos });
    this.a.startMove('stagger');
    const hand = this.a.sword;
    this.run([
      [0.6, () => { if (hand) { this.dropSword(hand); } this.armed(false); this.turnGoal = null; }],
      [1.6, () => { this.a.startMove('pray'); this.prayFreeze = true; }],
      [1.2, () => { this.backSwords.forEach((s, i) => this.fallSword(s, i)); }],
      [1.5, () => { this.dissolve = 0.0001; }],
    ]);
  }

  dropSword(hand) {
    hand.visible = false;
    const s = this.backSwords.find(b => b.state === 'drawn');
    if (s) { s.state = 'fallen'; }
  }

  fallSword(s, i) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const p = new THREE.Vector3(this.pos.x + Math.cos(a) * 3.6, 0, this.pos.z + Math.sin(a) * 3.6);
    s.state = 'fallen'; s.t = 0;
    s.fallFrom = s.pos.clone(); s.fallTo = p; s.fallDir = new THREE.Vector3(Math.cos(a) * 0.15, -1, Math.sin(a) * 0.15).normalize();
    s.setOpacity(1); s.obj.visible = true;
  }

  // --------------------------------------------------------------------------------------- AI

  wake() {
    this.state = 'idle'; this.invulnerable = false; this.cooldown = 1.2; this.agro = true;
  }

  /**
   * Combos of varying length keep her unreadable: after some attacks she flows straight into another
   * (phase one: at most one follow-up, phase two: two, and more often).
   */
  comboFollow(prev, player) {
    if (this.dead || this.state !== 'attack' || player.dead) return null;
    const p2 = this.phase === 2;
    if ((this.chain || 0) >= (p2 ? 2 : 1)) return null;
    const d = horizDist(this.pos, player.pos), ang = Math.abs(angleTo(this.pos, this.yaw, player.pos)), roll = Math.random();
    if (prev === 'sweep' && d < 5.5 && ang < 60 * DEG && roll < (p2 ? 0.5 : 0.3)) return 'slam';
    if (prev === 'thrust' && d < 5.0 && roll < (p2 ? 0.45 : 0.25)) return 'sweep';
    if (prev === 'slam' && p2 && d < 5.5 && roll < 0.35) return 'sweep';
    return null;
  }

  chooseAttack(player) {
    const d = horizDist(this.pos, player.pos);
    const ang = Math.abs(angleTo(this.pos, this.yaw, player.pos));
    const p2 = this.phase === 2;
    const w = [];
    if (d < 5.5) {
      w.push(['sweep', ang < 100 * DEG ? 4 : 2]);
      w.push(['slam', ang < 45 * DEG ? 3 : 0]);
      if (this.cds.pray <= 0) w.push(['pray', 1.5]);
      if (p2 && this.cds.wing <= 0) w.push(['wing', 3.5]);
    } else if (d < 10) {
      w.push(['slam', ang < 40 * DEG ? 3 : 0.5]);
      w.push(['thrust', ang < 30 * DEG ? 3 : 0]);
      if (this.cds.volley <= 0) w.push(['volley', 2]);
      if (this.cds.pray <= 0) w.push(['pray', 1]);
    } else {
      w.push(['thrust', ang < 25 * DEG && d < 13 ? 3 : 0]);
      if (this.cds.volley <= 0) w.push(['volley', 4]);
    }
    const choices = w.filter(([n, x]) => x > 0 && !(n === this.lastAttack && Math.random() < 0.6));
    const sum = choices.reduce((s, [, x]) => s + x, 0);
    if (!sum) return null;
    let r = Math.random() * sum;
    for (const [n, x] of choices) { if ((r -= x) <= 0) return n; }
    return choices[choices.length - 1][0];
  }

  startAttack(name, player) {
    this.lastAttack = name;
    this.state = 'attack';
    this.hitThisSwing.clear();
    this.fired = 0; this.pillars = 0; this.impacted = false; this.wingDone = false; this.raised = false;
    const speed = this.phase === 2 ? (this.finale ? 1.18 : 1.12) : 1;
    if (name === 'wing') {
      this.a.startMove('volley', { speed: 1.6 });
      this.cds.wing = 11;
      this.wingT = 0;
      // the burst reaches 7.3 m: show exactly that on the floor while the wings gather light (burst at 1.25 s)
      this.fx.warnRing(this.pos, 7.3, 1.25);
      this.audio?.play('pillar_charge', { pos: this.pos, volume: 0.9, pitch: 0.8 });
      return;
    }
    this.a.startMove(name, { speed });
    const mv = this.a.move;
    if (name === 'slam') { mv.holding = true; this.holdFor = rand(0.15, this.phase === 2 ? 0.45 : 0.75); }
    if (name === 'volley') this.cds.volley = this.phase === 2 ? 9 : 13;
    if (name === 'pray') this.cds.pray = this.phase === 2 ? 16 : 22;
    // blade attacks glint at the top of their wind-up (def.glintAt, see tickAttack); the others announce themselves now
    if (!mv.def.glintAt) this.audio?.play('pillar_charge', { pos: this.pos, volume: 0.6 });
  }

  update(dt, player) {
    const a = this.a;
    if (dt <= 0) { a.update(0); this.syncSwords(0, player); this.updateHalo(); return; }
    for (const k in this.cds) this.cds[k] -= dt;

    // scripted timeline
    if (this.timeline.length) {
      this.timelineT += dt;
      for (const s of this.timeline) if (!s.done && this.timelineT >= s.at) { s.done = true; s.fn(); }
      if (this.timeline.every(s => s.done)) this.timeline = [];
    }
    if (this.turnGoal !== null && this.turnGoal !== undefined) {
      const goal = this.turnGoal === 'player' ? Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z) : this.turnGoal;
      this.yaw = yawLerp(this.yaw, goal, 70 * DEG * dt);
      if (!a.move) this.walkAnim(0.3, true);
    }
    if (this.prayFreeze && a.move && a.move.name === 'pray' && a.move.t > 2.6) a.move.t = 2.6;

    // poise regen
    if (this.poiseTimer > 0) this.poiseTimer -= dt; else this.poise = Math.max(0, this.poise - this.T.poiseRegen * dt);

    const mv = a.move;
    if (this.state === 'idle' || this.state === 'walk') {
      this.tickChase(dt, player);
    } else if (this.state === 'attack' && mv) {
      this.tickAttack(dt, player, mv);
    } else if (this.state === 'attack' && !mv) {
      const next = this.pendingChain; this.pendingChain = null;
      if (next && !this.dead) { this.chain = (this.chain || 0) + 1; this.startAttack(next, player); return; }
      this.chain = 0;
      this.state = 'idle'; this.cooldown = rand(0.5, 1.3) / (this.phase === 2 ? (this.finale ? 1.75 : 1.5) : 1);
      this.recallSwords();
    } else if (this.state === 'stagger' && !mv) {
      this.state = 'idle'; this.staggered = false; this.cooldown = 0.4;
    }
    if (this.state === 'stagger' && mv && mv.t > 2.3) this.staggered = false;

    // flinch (small additive jolt when idle)
    if (this.flinchT > 0) this.flinchT -= dt;

    // wings
    const wantWings = this.phase === 2 && !this.dead ? 1 : 0;
    this.wingAlpha += (wantWings - this.wingAlpha) * (1 - Math.exp(-2 * dt));
    if (this.dissolve) this.wingAlpha *= Math.exp(-3 * dt);

    clampToArena(this.pos, this.arena, this.T.radius);
    for (const act of this.actors) { act.root.position.copy(this.pos); act.root.rotation.y = this.yaw; }
    a.update(dt);
    this.updateWings(dt);
    this.updateHalo();
    this.syncSwords(dt, player);
    if (this.trailOn) this.trail.push(a.bladeBase, a.bladeTip, this.fx.now);
    if (this.dead) {            // she fills with light while she kneels, then burns away (updateDissolve)
      this.deadT += dt;
      const look = a.char.model.userData.look;
      if (look) look.glow = Math.min(0.55, Math.max(0, this.deadT - 1.2) * 0.16);
    }
    this.updateDissolve(dt);
  }

  walkAnim(speed, turning = false) {
    const a = this.a;
    if (speed < 0.05 && !turning) { a.playBase('idle', { fade: 0.4 }); return; }
    a.playBase('walk', { fade: 0.4 });
    const nat = a.clipSpeed('walk') || 3.6;
    a.setBaseTimeScale(THREE.MathUtils.clamp((turning ? 0.9 : speed) / nat, 0.25, 1.2));
  }

  tickChase(dt, player) {
    if (player.dead) { this.walkAnim(0); return; }
    const d = horizDist(this.pos, player.pos);
    const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const turnRate = (this.phase === 2 ? this.T.turn2 : this.T.turn1) * DEG;
    this.yaw = yawLerp(this.yaw, want, turnRate * dt);
    this.cooldown -= dt;
    const speed = this.phase === 2 ? this.T.walk2 : this.T.walk1;
    if (this.cooldown <= 0) {
      const atk = this.chooseAttack(player);
      if (atk) { this.startAttack(atk, player); return; }
    }
    if (d > 4.2) {
      this.pos.x += Math.sin(this.yaw) * speed * dt;
      this.pos.z += Math.cos(this.yaw) * speed * dt;
      this.state = 'walk';
      this.walkAnim(speed);
      this.stepAcc += speed * dt;
      if (this.stepAcc > 2.1) {
        this.stepAcc = 0;
        const foot = this.a.bonePos(Math.random() < 0.5 ? 'LeftFoot' : 'RightFoot');
        this.fx.splash(foot, 1.3);
        this.fx.candles(foot.x, foot.z, 0.9, { knock: true });
        this.audio?.play('boss_step', { pos: foot });
        this.cam.addTrauma(Math.max(0, 0.12 - d * 0.004));
      }
    } else {
      this.state = 'idle';
      this.walkAnim(0, Math.abs(angleTo(this.pos, this.yaw, player.pos)) > 0.3);
    }
  }

  tickAttack(dt, player, mv) {
    const def = mv.def;
    if (def.chainAt !== undefined && mv.t >= def.chainAt && !mv.fired.has('chain')) {
      mv.fired.add('chain');
      const next = this.comboFollow(mv.name, player);
      if (next) { this.pendingChain = next; mv.speed *= 2.4; }
    }
    // the tell: a gold star on the blade the moment the wind-up peaks (it reads against the white window)
    if (def.glintAt !== undefined && mv.t >= def.glintAt && !mv.fired.has('glint')) {
      mv.fired.add('glint');
      this.fx.glint(this.a.bladeTip, 2.6, 0.45, 0xffd890);
      this.audio?.play('sword_glint', { pos: this.a.bladeTip, volume: 0.75 });
    }
    // delayed slam: hold the raised sword for a random beat
    if (mv.name === 'slam' && mv.holding && mv.hold >= this.holdFor) mv.holding = false;
    if (mv.name === 'slam' && mv.holding && mv.t >= def.holdAt && Math.random() < 0.15) this.fx.motes(this.a.bladeTip, 0.4, 1);
    // tracking
    if (def.track && mv.t >= def.track[0] && mv.t <= def.track[1]) {
      const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      this.yaw = yawLerp(this.yaw, want, def.track[2] * DEG * dt * (this.phase === 2 ? 1.25 : 1));
    }
    // root motion
    if (def.moveRoot) {
      for (const [t0, t1, dist, e] of def.moveRoot) {
        const u0 = THREE.MathUtils.clamp((mv.t - dt * mv.speed - t0) / (t1 - t0), 0, 1);
        const u1 = THREE.MathUtils.clamp((mv.t - t0) / (t1 - t0), 0, 1);
        const step = dist * ((ease[e || 'out'])(u1) - (ease[e || 'out'])(u0));
        if (step) {
          // don't run through the player on the lunge
          const d = horizDist(this.pos, player.pos);
          const s = d < 2.2 ? step * 0.2 : step;
          this.pos.x += Math.sin(this.yaw) * s; this.pos.z += Math.cos(this.yaw) * s;
          this.fx.candles(this.pos.x, this.pos.z, 1.1, { knock: true });
        }
      }
    }
    // blade hits
    const active = def.hits && def.hits.some(h => mv.t >= h[0] && mv.t <= h[1]);
    this.trailOn = !!active;
    if (def.hits) {
      def.hits.forEach(([t0, t1, info], idx) => {
        if (mv.t < t0 || mv.t > t1 || this.hitThisSwing.has(idx)) return;
        const cap = [{ a: player.pos.clone().setY(0.2), b: player.pos.clone().setY(1.55), r: 0.38 }];
        const hit = sweepBlade(this.a.prevBase, this.a.prevTip, this.a.bladeBase, this.a.bladeTip, cap, 0.3, 6);
        if (hit) {
          this.hitThisSwing.add(idx);
          const r = player.takeHit({ dmg: info.dmg * (this.phase === 2 ? 1.12 : 1), from: this.pos, kind: info.kind === 'sweep' ? 'light' : 'heavy', blockable: true });
          if (r === 'parry') this.parried(hit.point);
          else if (r) this.events.push({ type: 'hitPlayer' });
        }
      });
    }
    // swing sounds
    if (def.hits) for (const [t0] of def.hits) {
      const key = 'sw' + t0;
      if (mv.t >= t0 - 0.12 && !mv.fired.has(key)) { mv.fired.add(key); this.audio?.play('boss_swing', { pos: this.a.bladeTip }); }
    }
    // slam impact
    if (mv.name === 'slam' && !this.impacted && mv.t >= def.impactAt) {
      this.impacted = true;
      const p = this.a.bladeTip.clone(); p.y = 0;
      this.fx.shockwave(p, 4.2, 0.6);
      this.fx.splash(p, 2.6); this.fx.dust(p, 2.2, 50);
      this.fx.light(new THREE.Vector3(p.x, 1, p.z), 0xffe3b0, 70, 0.3, 14);
      this.audio?.play('boss_slam', { pos: p });
      const d = horizDist(player.pos, this.pos);
      this.cam.addTrauma(Math.max(0.2, 0.75 - d * 0.04));
      if (horizDist(player.pos, p) < 3.3) player.takeHit({ dmg: 30, from: p, kind: 'heavy' });
    }
    // volley: seven swords
    if (mv.name === 'volley' && this.lastAttack !== 'wing') {
      const n = this.phase === 2 ? 7 : 5;
      const ft = def.fireTimes;
      if (mv.t > 0.4 && !this.raised) { this.raiseSwords(n); this.raised = true; }   // once: n swords, not every frame
      while (this.fired < n && mv.t >= ft[this.fired]) { this.fireSword(this.fired, player); this.fired++; }
    }
    if (this.lastAttack === 'wing') this.tickWing(dt, player, mv);
    // prayer pillars
    if (mv.name === 'pray') {
      const pt = def.pillarTimes;
      while (this.pillars < pt.length && mv.t >= pt[this.pillars] - 1.0) {
        const lead = player.pos.clone();
        // predict a little
        const vx = Math.sin(player.yaw) * player.speed * 0.4, vz = Math.cos(player.yaw) * player.speed * 0.4;
        lead.x += vx; lead.z += vz;
        const count = this.phase === 2 ? 3 : 1;
        for (let k = 0; k < count; k++) {
          const off = k === 0 ? new THREE.Vector3() : new THREE.Vector3(rand(-3.5, 3.5), 0, rand(-3.5, 3.5));
          const p = lead.clone().add(off);
          this.fx.pillar(p, 1.7, 1.0, () => {
            this.audio?.play('pillar_blast', { pos: p });
            this.cam.addTrauma(0.25);
            if (horizDist(player.pos, p) < 1.9) player.takeHit({ dmg: 26, from: p, kind: 'heavy' });
          });
        }
        this.audio?.play('pillar_charge', { pos: lead });
        this.pillars++;
      }
    }
  }

  tickWing(dt, player, mv) {
    this.wingT += dt;
    this.wingCharge = Math.min(1, this.wingT / 1.2);
    if (!this.wingDone && this.wingT > 1.25) {
      this.wingDone = true;
      this.fx.shockwave(this.pos, 7.5, 0.7, new THREE.Color(1.0, 0.95, 0.8));
      this.fx.light(new THREE.Vector3(this.pos.x, 3, this.pos.z), 0xfff1d0, 160, 0.5, 26);
      this.fx.motes(this.pos, 5, 60);
      this.audio?.play('pillar_blast', { pos: this.pos, volume: 1.2, pitch: 0.8 });
      this.cam.addTrauma(0.6);
      if (horizDist(player.pos, this.pos) < 7.3) player.takeHit({ dmg: 32, from: this.pos, kind: 'heavy' });
    }
    if (this.wingT > 2.2 && mv) this.a.stopMove();
  }

  // --------------------------------------------------------------------------------------- the seven swords

  /** Socket transform for back sword i (tip slightly inside her back, blade fanning outward). */
  socket(i, outPos, outDirTip) {
    const rig = this.a.rig;
    const chest = this.a.bonePos('Spine2', _v);
    const n = 7, th = (i - (n - 1) / 2) * 17 * DEG;
    const outDir = _w.set(0, 0, 0).addScaledVector(rig.F, -0.55).addScaledVector(rig.U, Math.cos(th) * 1.0).addScaledVector(rig.R, Math.sin(th) * 0.95).normalize();
    const entry = chest.clone().addScaledVector(rig.F, -0.32).addScaledVector(rig.U, 0.1).addScaledVector(rig.R, Math.sin(th) * 0.18);
    const L = this.backSwords[i].obj.userData.length, gf = this.backSwords[i].obj.userData.gripFrac;
    // tip sits 0.35 m inside; holder origin (grip) is out along outDir
    outPos.copy(entry).addScaledVector(outDir, L * (1 - gf) - 0.35);
    outDirTip.copy(outDir).negate();
  }

  /** Any sword still waiting in the halo when an attack ends re-forms on her back. */
  recallSwords() {
    for (const s of this.backSwords) if (s.state === 'rising' || s.state === 'hover') { s.state = 'regrow'; s.t = 0; s.setOpacity(0); }
  }

  raiseSwords(n) {
    let k = 0;
    for (const s of this.backSwords) {
      if (s.state === 'back' && k < n) { s.state = 'rising'; s.t = 0; s.slot = k; k++; }
      else if (s.state === 'back') continue;
    }
  }

  haloPos(slot, n, out) {
    const rig = this.a.rig;
    const head = this.a.bonePos('Head', _v);
    const a = (slot / Math.max(1, n)) * Math.PI * 2 + this.fx.now * 0.6;
    return out.copy(head).addScaledVector(rig.F, -1.6).addScaledVector(rig.U, 2.4 + Math.sin(a) * 1.9).addScaledVector(rig.R, Math.cos(a) * 2.6);
  }

  fireSword(idx, player) {
    const s = this.backSwords.filter(b => b.state === 'rising' || b.state === 'hover').sort((x, y) => x.slot - y.slot)[0];
    if (!s) return;
    s.state = 'flying'; s.t = 0;
    const lead = player.pos.clone();
    lead.x += Math.sin(player.yaw) * player.speed * 0.35; lead.z += Math.cos(player.yaw) * player.speed * 0.35;
    s.target.copy(lead).setY(0);
    const from = s.tip(new THREE.Vector3());
    s.vel.subVectors(s.target, from).setLength(4);
    this.fx.glint(from, 2.2, 0.32);
    this.audio?.play('sword_glint', { pos: from, volume: 0.7, pitch: 1 + idx * 0.04 });
    s.delay = 0.28;
  }

  syncSwords(dt, player) {
    this.updateHalo();
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    let hoverN = this.backSwords.filter(s => s.state === 'rising' || s.state === 'hover').length;
    for (const s of this.backSwords) {
      s.t += dt;
      switch (s.state) {
        case 'back':
        case 'regrow': {
          this.socket(s.i, p, d);
          s.place(p, d);
          if (s.state === 'regrow') { s.setOpacity(Math.min(1, s.t / 1.5)); s.setGlow(Math.max(0, 2 - s.t)); if (s.t > 1.5) { s.state = 'back'; s.setGlow(0); } }
          break;
        }
        case 'rising':
        case 'hover': {
          this.socket(s.i, p, d);
          const h = this.haloPos(s.slot, hoverN, new THREE.Vector3());
          const f = Math.min(1, s.t / 0.6);
          const pos = p.clone().lerp(h, ease.inOut(f));
          const dir = d.clone().lerp(new THREE.Vector3().subVectors(player.pos, h).normalize(), ease.inOut(f)).normalize();
          s.place(pos, dir);
          s.setGlow(1.2 * f);
          if (f >= 1) s.state = 'hover';
          break;
        }
        case 'flying': {
          if (s.delay > 0) { s.delay -= dt; s.setGlow(2); const dir = new THREE.Vector3().subVectors(s.target, s.tip(new THREE.Vector3())).normalize(); s.place(s.pos, s.dir.lerp(dir, 0.3)); break; }
          const tip = s.tip(new THREE.Vector3());
          const to = new THREE.Vector3().subVectors(s.target, tip);
          const speed = 46;
          const step = Math.min(to.length(), speed * dt);
          const dir = to.normalize();
          s.place(s.pos.clone().addScaledVector(dir, step), dir);
          if (!s.whoosh) { s.whoosh = true; this.audio?.play('sword_fly', { pos: tip }); }
          const tipNow = s.tip(new THREE.Vector3());
          // direct hit on the player capsule
          if (!s.hitDone && tipNow.distanceTo(player.pos.clone().setY(Math.min(1.5, Math.max(0.2, tipNow.y)))) < 0.7) {
            s.hitDone = true; player.takeHit({ dmg: 16, from: tipNow, kind: 'light', blockable: true });
          }
          if (tipNow.y <= 0.05 || step < 0.01) {
            s.state = 'stuck'; s.t = 0; s.whoosh = false; s.hitDone = false;
            this.fx.splash(tipNow, 1.4); this.fx.hitSpark(tipNow.clone().setY(0.1), new THREE.Vector3(0, 1, 0), false);
            this.audio?.play('sword_impact', { pos: tipNow });
            this.fx.candles(tipNow.x, tipNow.z, 1.4, { knock: true, knockRadius: 0.8 });
            this.cam.addTrauma(0.12);
            if (horizDist(player.pos, tipNow) < 1.3) player.takeHit({ dmg: 14, from: tipNow, kind: 'light' });
          }
          break;
        }
        case 'stuck': {
          s.setGlow(Math.max(0, 1.5 - s.t));
          if (s.t > 3.5) s.setOpacity(Math.max(0, 1 - (s.t - 3.5) / 0.8));
          if (s.t > 4.3) { s.state = 'gone'; s.t = 0; }
          break;
        }
        case 'gone': {
          if (s.t > 2.5) { s.state = 'regrow'; s.t = 0; }
          break;
        }
        case 'drawn': { s.obj.visible = false; break; }
        case 'fallen': {
          if (s.fallTo) {
            const f = Math.min(1, s.t / 0.7);
            const L = s.obj.userData.length * (1 - s.obj.userData.gripFrac);
            const end = s.fallTo.clone().addScaledVector(s.fallDir, -L + 0.6);
            s.place(s.fallFrom.clone().lerp(end, ease.in(f)), s.dir.clone().lerp(s.fallDir, f).normalize());
            if (f >= 1 && !s.landed) { s.landed = true; this.fx.splash(s.fallTo, 1.2); this.fx.candles(s.fallTo.x, s.fallTo.z, 0.9, { knock: true }); this.audio?.play('sword_impact', { pos: s.fallTo, volume: 0.7 }); }
          }
          break;
        }
      }
    }
  }

  /** Called by the intro: pull the center back sword out and make it the hand sword. */
  drawFromBack() {
    const s = this.backSwords[3];
    s.state = 'drawn';
    this.armed(true);
    this.audio?.play('sword_draw', { pos: this.pos });
  }

  updateWings(dt) {
    const w = this.wings;
    w.grp.visible = this.wingAlpha > 0.01;
    if (!w.grp.visible) return;
    const rig = this.a.rig;
    const chest = this.a.bonePos('Spine2', _v);
    w.grp.position.copy(chest).addScaledVector(rig.F, -0.45);
    // right-handed basis: x = her right, y = up, z = backward (R x U = -F)
    w.grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rig.R, rig.U, rig.F.clone().negate()));
    const flap = Math.sin(this.fx.now * 1.3) * 0.12 + (this.wingCharge || 0) * 0.5;
    w.L.rotation.y = -0.35 - flap; w.R.rotation.y = 0.35 + flap;
    w.L.rotation.z = 0.25; w.R.rotation.z = -0.25;
    w.mat.opacity = this.wingAlpha * (0.2 + 0.06 * Math.sin(this.fx.now * 2.1)) + (this.wingCharge || 0) * 0.4;
    if (this.wingCharge && this.wingDone) this.wingCharge = Math.max(0, this.wingCharge - dt * 1.5);
  }

  updateDissolve(dt) {
    if (!this.dissolve) return;
    this.dissolve += dt / 4.5;
    const k = Math.min(1, this.dissolve);
    const look = this.a.char.model.userData.look;
    if (look) look.dissolve = k;     // burns away with a gold edge (src/look.js)
    else this.a.char.model.traverse(o => {
      if (o.isMesh && o.material) {
        o.material.transparent = true; o.material.opacity = 1 - k; o.material.depthWrite = k < 0.5;
        if (o.material.emissive) { o.material.emissive.setRGB(1, 0.9, 0.7); o.material.emissiveIntensity = k * 2.5; }
      }
    });
    if (Math.random() < 0.8) this.fx.motes(new THREE.Vector3(this.pos.x, 0.5, this.pos.z), 1.6, 3);
    if (k >= 1) { this.a.char.root.visible = false; this.dissolve = null; this.events.push({ type: 'dissolved' }); }
  }
}
