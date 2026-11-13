// The heroine: movement, stamina, light combo, charged heavy, roll with i-frames, heal, hit reactions, death.
import * as THREE from 'three';
import { ease } from './pose.js';
import { sweepBlade, clampToArena, yawLerp, angleTo, horizDist } from './combat.js';
import { BLOCK_P } from './moves.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

export const PLAYER_TUNING = {
  maxHp: 100, maxSt: 100, flasks: 4, flaskHeal: 48,
  runSpeed: 4.1, walkSpeed: 1.6, sprintSpeed: 6.2, sprintCost: 13,
  stRegen: 46, stDelay: 0.55, stDelayEmpty: 1.1,
  baseDmg: 22, radius: 0.36,
};

export class Player {
  constructor({ actor, fx, audio, cam, input, arena, trail }) {
    this.a = actor;
    this.root = actor.root;
    this.fx = fx; this.audio = audio; this.cam = cam; this.input = input; this.arena = arena;
    this.trail = trail;
    const T = PLAYER_TUNING;
    this.T = T;
    this.hp = T.maxHp; this.st = T.maxSt; this.flasks = T.flasks;
    this.state = 'idle';
    this.yaw = Math.PI;
    this.speed = 0;
    this.stDelay = 0;
    this.combo = 0;
    this.hitThisSwing = false;
    this.iframes = false;
    this.footAcc = 0; this.footSide = 0;
    this.dead = false;
    this.lockOn = false;
    this.healed = false;
    this.charge = 0;
    this.events = [];      // gameplay events for main (e.g. hitstop requests)
    this.trailOn = false;
    this.blocking = false; this.guardW = 0; this.blockStart = 0;
  }

  get pos() { return this.root.position; }

  reset(spawn) {
    const T = this.T;
    this.hp = T.maxHp; this.st = T.maxSt; this.flasks = T.flasks; this.dead = false;
    this.state = 'idle'; this.a.stopMove(); this.a.playBase('idle', { fade: 0 });
    this.root.position.set(spawn.x, 0, spawn.z); this.yaw = spawn.yaw; this.root.rotation.y = this.yaw;
  }

  canAct() { return !this.dead && (this.state === 'idle' || this.state === 'move'); }

  inCancelWindow() {
    const mv = this.a.move;
    return mv && mv.def.cancel !== undefined && mv.t >= mv.def.cancel;
  }

  spend(n) { this.st -= n; this.stDelay = this.st <= 0 ? this.T.stDelayEmpty : this.T.stDelay; }

  /** World-space desired move direction from input (camera relative), magnitude 0..1. */
  wishDir(out) {
    const m = this.input.move();
    this.cam.forward(_f); this.cam.right(_r);
    out.set(0, 0, 0).addScaledVector(_r, m.x).addScaledVector(_f, m.y);
    return Math.min(1, Math.hypot(m.x, m.y));
  }

  startMove(name, opts = {}) {
    this.a.startMove(name, opts);
    this.state = name.startsWith('light') || name === 'heavy' || name === 'runAttack' ? 'attack' : name;
    this.hitThisSwing = false;
    this.healed = false;
    this.moveRootDone = 0;
  }

  tryActions(boss) {
    const inp = this.input;
    if (this.dead) return;
    const free = this.canAct();
    const cancel = this.inCancelWindow() && ['attack', 'roll', 'hurt', 'blockHit'].includes(this.state);
    if (!free && !cancel) return;
    if (inp.peek('roll', 0.3) && this.st > 0) {
      inp.take('roll', 0.3);
      const m = this.wishDir(_v);
      if (m > 0.2) this.yaw = Math.atan2(_v.x, _v.z);
      this.spend(this.a.lib.roll.stamina);
      this.startMove('roll');
      this.audio?.play('roll', { pos: this.pos });
      this.fx.splash(this.pos, 0.8);
      return;
    }
    // running attack: any attack out of a full sprint becomes a lunging thrust (Shift is held, so LMB reads as heavy)
    if ((inp.peek('light', 0.35) || inp.peek('heavy', 0.3)) && free && this.state === 'move' && this.speed > 5.0 && this.st > 0
        && !(boss && boss.criticalOpen && boss.criticalOpen(this))) {
      inp.take('light', 0.35); inp.take('heavy', 0.3);
      this.faceTarget(boss, Math.PI * 0.5);
      this.spend(this.a.lib.runAttack.stamina);
      this.startMove('runAttack');
      this.combo = 0;
      return;
    }
    if (inp.peek('heavy', 0.3) && this.st > 0 && (free || this.state === 'attack' || this.state === 'roll')
        && !(boss && boss.criticalOpen && boss.criticalOpen(this))) {
      inp.take('heavy', 0.3);
      this.faceTarget(boss, Math.PI);
      this.spend(this.a.lib.heavy.stamina);
      this.startMove('heavy');
      this.a.move.holding = true; this.charge = 0;
      this.combo = 0;
      return;
    }
    // critical: the saint is down on one knee in front of us
    if ((inp.peek('light', 0.35) || inp.peek('heavy', 0.3)) && boss && boss.criticalOpen && boss.criticalOpen(this) && (free || cancel)) {
      inp.take('light', 0.35); inp.take('heavy', 0.3);
      this.yaw = Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z);
      this.startMove('critical');
      this.state = 'critical'; this.critDone = false;
      // the stab needs her chest: slide in to about 2 m before her
      const f = new THREE.Vector3(Math.sin(boss.yaw), 0, Math.cos(boss.yaw));
      this.critTarget = boss.pos.clone().addScaledVector(f, 2.0);
      this.audio?.play('swing_heavy', { pos: this.pos, pitch: 0.9 });
      return;
    }
    if (inp.peek('light', 0.35) && this.st > 0 && (free || this.state === 'attack' || this.state === 'roll')) {
      inp.take('light', 0.35);
      const next = this.state === 'attack' && this.a.move && this.a.move.name.startsWith('light')
        ? ['light1', 'light2', 'light3'][this.combo % 3] : 'light1';      // combo counts the swings so far: 1 -> light2, 2 -> light3, 3 -> light1
      this.combo = next === 'light1' ? 1 : this.combo + 1;
      this.faceTarget(boss, Math.PI * 0.5);
      this.spend(this.a.lib[next].stamina);
      this.startMove(next);
      return;
    }
    if (free && inp.take('heal', 0.3)) {
      if (this.flasks > 0) { this.startMove('heal'); this.flasks--; }
      else this.audio?.play('ui', { volume: 0.5 });
    }
  }

  /** Snap facing toward the boss (when locked or roughly in front) at the start of an attack. */
  faceTarget(boss, maxAngle) {
    const m = this.wishDir(_v);
    if (this.lockOn && boss && !boss.dead) {
      this.yaw = Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z);
    } else if (m > 0.2) {
      this.yaw = Math.atan2(_v.x, _v.z);
    } else if (boss && !boss.dead && horizDist(boss.pos, this.pos) < 9 && Math.abs(angleTo(this.pos, this.yaw, boss.pos)) < maxAngle) {
      this.yaw = Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z);
    }
  }

  takeHit({ dmg, from, kind = 'light', blockable = false }) {
    if (this.dead) return false;
    if (this.a.move && this.a.move.def.iframes && this.a.inWindow(this.a.move.def.iframes)) return false;
    if (blockable && this.blocking && this.guardW > 0.4) {
      const toward = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      if (Math.abs(Math.atan2(Math.sin(toward - this.yaw), Math.cos(toward - this.yaw))) < 1.35) return this.block(dmg, from);
    }
    this.hp -= dmg;
    const dir = _v.set(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
    const chest = this.a.bonePos('Spine2', new THREE.Vector3());
    this.fx.bloodHit(chest, dir, kind !== 'light');
    this.fx.flashMesh(this.a.char.model, new THREE.Color(1, 0.3, 0.25), 0.14, 0.8);
    this.a.jolt(dir, kind === 'light' ? 0.12 : 0.18, 0.018);
    this.audio?.play('player_hurt', { pos: this.pos, volume: kind === 'light' ? 0.8 : 1 });
    this.cam.addTrauma(kind === 'light' ? 0.45 : 0.75);
    this.cam.punch(dir, kind === 'light' ? 0.18 : 0.32);
    this.input.rumble(kind === 'light' ? 0.5 : 1.0, 0.6, kind === 'light' ? 140 : 260);
    this.events.push({ type: 'hurt', kind, hitstop: kind === 'light' ? 0.09 : 0.14 });
    this.trailOn = false;
    if (this.god) this.hp = Math.max(this.hp, 1);
    if (this.hp <= 0) { this.die(from); return true; }
    this.yaw = Math.atan2(-dir.x, -dir.z);   // face the attacker
    this.startMove(kind === 'light' ? 'hurt' : 'knockdown');
    this.combo = 0;
    return true;
  }

  /** A blade caught on the guard: a perfect guard (pressed just before the hit) costs nothing and staggers her. */
  block(dmg, from) {
    const now = performance.now() / 1000;
    const dir = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
    const spark = this.a.bladeBase.clone().lerp(this.a.bladeTip, 0.35);
    if (now - this.blockStart < 0.18) {
      this.fx.hitSpark(spark, dir.clone().negate(), true);
      this.fx.light(spark, 0xfff2d0, 80, 0.25, 10);
      this.audio?.play('parry', { pos: spark });
      this.audio?.play('stagger', { pos: spark, volume: 0.45, pitch: 1.35 });
      this.cam.addTrauma(0.3); this.cam.zoomPunch(3);
      this.input.rumble(0.9, 0.5, 160);
      this.events.push({ type: 'parry' });
      this.startMove('blockHit');
      return 'parry';
    }
    this.st -= dmg * 1.9; this.stDelay = this.T.stDelay * 1.4;
    this.a.jolt(dir, 0.1, 0.014);
    this.fx.hitSpark(spark, dir.clone().negate(), false);
    this.audio?.play('block', { pos: spark, pitch: 0.95 + Math.random() * 0.1 });
    this.cam.addTrauma(0.22); this.cam.punch(dir, 0.12);
    this.input.rumble(0.5, 0.4, 110);
    if (this.st <= 0) {                               // guard broken
      this.st = 0; this.blocking = false; this.guardW = 0;
      this.hp -= dmg * 0.6;
      if (this.god) this.hp = Math.max(this.hp, 1);
      this.audio?.play('player_hurt', { pos: this.pos });
      this.events.push({ type: 'guardbreak', hitstop: 0.12 });
      if (this.hp <= 0) { this.die(from); return true; }
      this.startMove('knockdown');
      return true;
    }
    this.hp -= dmg * 0.12;
    if (this.god) this.hp = Math.max(this.hp, 1);
    if (this.hp <= 0) { this.die(from); return true; }
    this.events.push({ type: 'block', hitstop: 0.06 });
    this.startMove('blockHit');
    return 'block';
  }

  die(from) {
    this.dead = true; this.state = 'dead'; this.hp = 0;
    this.a.stopMove();
    this.yaw = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
    this.a.playBase('fall', { fade: 0.15, once: true });
    this.audio?.play('player_death');
    this.events.push({ type: 'dead' });
  }

  update(dt, boss) {
    const a = this.a, T = this.T;
    if (dt <= 0) { a.update(0); this.syncRoot(); return; }
    this.tryActions(boss);

    // guard: hold to block (also while recoiling from a blocked hit)
    const wantBlock = this.input.isHeld('block') && !this.dead;
    const canGuard = this.canAct() || (a.move && a.move.name === 'blockHit');
    if (wantBlock && canGuard) {
      if (!this.blocking) { this.blocking = true; this.blockStart = performance.now() / 1000; }
    } else this.blocking = false;
    this.guardW += ((this.blocking ? 1 : 0) - this.guardW) * (1 - Math.exp(-16 * dt));
    a.guard = BLOCK_P; a.guardW = this.guardW;

    // stamina
    if (this.stDelay > 0) this.stDelay -= dt;
    else if (this.state !== 'attack' && this.state !== 'roll') this.st = Math.min(T.maxSt, this.st + T.stRegen * dt * (this.state === 'heal' ? 0.5 : this.blocking ? 0.35 : 1));

    let wish = 0;
    const mv = a.move;
    if (this.dead) {
      this.speed = 0;
    } else if (mv) {
      const def = mv.def;
      // charge: hold the heavy at its peak while the button stays down
      if (mv.name === 'heavy' && mv.holding) {
        if (!this.input.isHeld('heavy') || mv.hold >= def.chargeMax) mv.holding = false;
        else if (mv.t >= def.chargeAt) { this.charge = mv.hold / def.chargeMax; if (Math.random() < 0.3) this.fx.motes(a.bladeTip, 0.15, 1); }
      }
      // root motion
      if (def.moveRoot) {
        for (const [t0, t1, dist, e] of def.moveRoot) {
          const u0 = THREE.MathUtils.clamp((mv.t - dt * mv.speed - t0) / (t1 - t0), 0, 1);
          const u1 = THREE.MathUtils.clamp((mv.t - t0) / (t1 - t0), 0, 1);
          const f = ease[e || 'out'];
          const step = dist * (f(u1) - f(u0));
          if (step) { this.pos.x += Math.sin(this.yaw) * step; this.pos.z += Math.cos(this.yaw) * step; }
        }
      }
      // tracking toward the boss during wind-up
      if (def.track && boss && !boss.dead && mv.t >= def.track[0] && mv.t <= def.track[1] && (this.lockOn || horizDist(boss.pos, this.pos) < 8)) {
        const want = Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z);
        this.yaw = yawLerp(this.yaw, want, def.track[2] * Math.PI / 180 * dt);
      }
      if (mv.name === 'critical' && mv.t < 0.34 && this.critTarget) {
        const k = 1 - Math.exp(-14 * dt);
        this.pos.x += (this.critTarget.x - this.pos.x) * k; this.pos.z += (this.critTarget.z - this.pos.z) * k;
        this.yaw = Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z);
      }
      // the critical lands
      if (mv.name === 'critical' && boss && !this.critDone && mv.t >= def.hitAt) {
        this.critDone = true;
        boss.takeCritical({ dmg: this.T.baseDmg * 7, point: this.a.bladeTip.clone(), dir: this.a.bladeDir.clone(), from: this.pos });
        this.events.push({ type: 'critical' });
      }
      if (mv.name === 'critical' && mv.t >= 1.0 && !mv.fired.has('rip')) { mv.fired.add('rip'); this.audio?.play('sword_draw', { pos: this.a.bladeTip, pitch: 1.2 }); }
      // rolling through the candles knocks them over
      if (mv.name === 'roll' && mv.t < 0.5) this.fx.candles(this.pos.x, this.pos.z, 0.5, { knock: true });
      // heal
      if (mv.name === 'heal') {
        wish = this.wishDir(_v) * def.speedMul;
        if (wish > 0.05) this.moveFree(_v, T.walkSpeed * def.speedMul / 0.35 * 0.35, dt, boss);
        if (!this.healed && mv.t >= def.healAt) {
          this.healed = true;
          this.hp = Math.min(T.maxHp, this.hp + T.flaskHeal);
          this.audio?.play('heal', { pos: this.pos });
          this.fx.motes(new THREE.Vector3(this.pos.x, 0.6, this.pos.z), 0.5, 26);
          this.fx.light(new THREE.Vector3(this.pos.x, 1.5, this.pos.z), 0xffe2a8, 18, 0.6, 5);
        }
      }
      // sword whoosh just before the blade comes through
      if (def.hits && !mv.fired.has('swing') && mv.t >= def.hits[0][0] - 0.07) {
        mv.fired.add('swing');
        const heavy = mv.name === 'heavy' || mv.name === 'light3' || mv.name === 'runAttack';
        this.audio?.play(heavy ? 'swing_heavy' : 'swing_light', { pos: this.a.bladeTip, pitch: heavy ? 0.95 : 1 + (this.combo % 3) * 0.04 });
      }
      // hits
      this.checkHits(boss, mv);
    } else {
      // locomotion
      wish = this.wishDir(_v);
      const sprint = wish > 0.3 && this.input.sprinting() && this.st > 0 && !this.blocking;
      let target = wish < 0.05 ? 0 : wish < 0.6 ? T.walkSpeed : T.runSpeed;
      if (this.blocking) target = Math.min(target, T.walkSpeed * 0.85);
      if (sprint) { target = T.sprintSpeed; this.st -= T.sprintCost * dt; this.stDelay = T.stDelay; }
      this.speed += (target - this.speed) * (1 - Math.exp(-(target > this.speed ? 10 : 14) * dt));
      let twist = 0;
      this.backpedal = false;
      if (wish > 0.05) {
        const want = Math.atan2(_v.x, _v.z);
        if (this.lockOn && boss && !boss.dead && !sprint) {
          this.yaw = yawLerp(this.yaw, Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z), 9 * dt);
          const rel = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
          if (Math.abs(rel) > 1.95) { this.backpedal = true; twist = rel - Math.sign(rel) * Math.PI; this.speed = Math.min(this.speed, T.walkSpeed * 1.35); }
          else twist = THREE.MathUtils.clamp(rel, -1.05, 1.05);
        } else {
          this.yaw = yawLerp(this.yaw, want, 11 * dt);
        }
        this.pos.x += Math.sin(want) * this.speed * dt;
        this.pos.z += Math.cos(want) * this.speed * dt;
        this.state = 'move';
      } else {
        if (this.lockOn && boss && !boss.dead) this.yaw = yawLerp(this.yaw, Math.atan2(boss.pos.x - this.pos.x, boss.pos.z - this.pos.z), 6 * dt);
        this.pos.x += Math.sin(this.yaw) * this.speed * dt * 0.3;
        this.pos.z += Math.cos(this.yaw) * this.speed * dt * 0.3;
        this.state = 'idle';
      }
      this.twist = (this.twist || 0) + (twist - (this.twist || 0)) * (1 - Math.exp(-10 * dt));
      const tw = this.twist * 180 / Math.PI;
      this.a.extra = { hipsTurn: [0, tw, 0], spine: [0, -tw * 0.8, 0] };
      this.a.extraW = Math.min(1, Math.abs(this.twist) * 3);
      this.updateLocomotionAnim();
      this.footsteps(dt);
    }
    if (!a.move && ['attack', 'roll', 'hurt', 'knockdown', 'heal', 'blockHit', 'critical'].includes(this.state)) this.state = 'idle';
    if (this.state === 'idle' && !mv && this.speed < 0.1 && a.baseName !== 'idle') a.playBase('idle', { fade: 0.3 });

    // trail during active frames
    const active = mv && mv.def.hits && mv.def.hits.some(h => mv.t >= h[0] - 0.05 && mv.t <= h[1] + 0.04);
    if (active) this.trail.push(a.bladeBase, a.bladeTip, this.fx.now);

    clampToArena(this.pos, this.arena, T.radius);
    this.syncRoot();
    a.update(dt);
  }

  moveFree(dir, speed, dt) {
    this.pos.x += dir.x * speed * dt; this.pos.z += dir.z * speed * dt;
  }

  syncRoot() {
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  updateLocomotionAnim() {
    const a = this.a;
    if (this.speed < 0.15) { a.playBase('idle', { fade: 0.25 }); return; }
    const useRun = this.speed > 2.6 && !this.backpedal;
    const name = useRun ? 'run' : 'walk';
    const natural = a.clipSpeed(name) || (useRun ? 4 : 1.2);
    a.playBase(name, { fade: 0.22 });
    a.setBaseTimeScale(THREE.MathUtils.clamp(this.speed / natural, 0.55, 1.7) * (this.backpedal ? -1 : 1));
  }

  footsteps(dt) {
    if (this.speed < 0.4) { this.footAcc = 0; return; }
    const stride = this.speed > 2.6 ? 1.1 : 0.75;
    this.footAcc += this.speed * dt;
    if (this.footAcc >= stride) {
      this.footAcc -= stride;
      this.footSide ^= 1;
      const foot = this.a.bonePos(this.footSide ? 'LeftFoot' : 'RightFoot', new THREE.Vector3());
      this.fx.splash(foot, this.speed > 4.5 ? 0.55 : 0.35);
      this.fx.candles(foot.x, foot.z, 0.2, { knock: true });
      this.audio?.play('step_water', { pos: foot, volume: this.speed > 4.5 ? 0.9 : 0.6 });
    }
  }

  checkHits(boss, mv) {
    const def = mv.def;
    if (!def.hits || !boss || boss.dead || this.hitThisSwing) return;
    for (const [t0, t1, info] of def.hits) {
      if (mv.t < t0 || mv.t > t1) continue;
      const a = this.a;
      const hit = sweepBlade(a.prevBase, a.prevTip, a.bladeBase, a.bladeTip, boss.hurtCapsules(), 0.08);
      if (!hit) continue;
      this.hitThisSwing = true;
      const charge = mv.name === 'heavy' ? 1 + this.charge * 0.6 : 1;
      const dmg = this.T.baseDmg * info.dmg * charge;
      const dir = _v.subVectors(a.bladeTip, a.prevTip).normalize();
      boss.takeHit({ dmg, poise: info.poise * charge, point: hit.point, dir, heavy: !!info.heavy, from: this.pos });
      this.events.push({ type: 'hit', hitstop: info.hitstop * (boss.staggered ? 1.4 : 1), heavy: !!info.heavy });
      return;
    }
  }
}
