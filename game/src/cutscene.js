// Intro: the kneeling saint, the hymn that stops, the long rise, the sword drawn from her own back.
import * as THREE from 'three';
import { ease } from './pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Intro {
  constructor({ camera, boss, player, audio, ui, arena, fx, onDone }) {
    Object.assign(this, { camera, boss, player, audio, ui, arena, fx, onDone });
    this.t = 0;
    this.done = false;
    this.fired = new Set();
    const bz = boss.pos.z, pz = player.pos.z;
    const head = () => boss.a.bonePos('Head', new THREE.Vector3());
    const chest = () => boss.lockPoint;
    const hands = () => boss.a.bonePos('RightHand', new THREE.Vector3()).lerp(boss.a.bonePos('LeftHand', new THREE.Vector3()), 0.5);
    const win = arena.roseWindow?.center || V(0, 20, bz - 28);
    // the shot where her head eclipses the rose window: camera on the line window -> head, behind her
    const eclipse = () => {
      const h = head();
      const dir = h.clone().sub(win).normalize();
      const p = h.clone().addScaledVector(dir, 9.5);
      p.y = Math.max(0.35, p.y);
      return p;
    };
    this.shots = [
      { t0: 0, t1: 4.2, from: { pos: V(0.4, 2.3, pz + 4.6), look: V(0, 2.6, bz), fov: 42 }, to: { pos: V(0.2, 2.2, pz + 1.2), look: V(0, 2.4, bz), fov: 38 }, e: 'inOut' },
      { t0: 4.2, t1: 7.2, from: { pos: V(5.2, 2.3, bz - 1.4), look: () => hands().lerp(head(), 0.5), fov: 32 }, to: { pos: V(4.7, 2.4, bz - 0.9), look: () => hands().lerp(head(), 0.5), fov: 30 }, e: 'linear' },
      { t0: 7.2, t1: 10.2, from: { pos: V(3.2, 3.4, bz + 6.5), look: chest, fov: 40 }, to: { pos: V(2.6, 3.1, bz + 5.4), look: chest, fov: 38 }, e: 'linear' },
      { t0: 10.2, t1: 13.2, from: { pos: V(-2.6, 2.6, bz - 1.6), look: head, fov: 28 }, to: { pos: V(-2.4, 2.65, bz - 1.4), look: head, fov: 26 }, e: 'linear' },
      { t0: 13.2, t1: 20.6, from: { pos: V(1.6, 0.45, bz + 6.8), look: head, fov: 46 }, to: { pos: V(1.2, 0.4, bz + 6.0), look: head, fov: 50 }, e: 'inOut' },
      { t0: 20.6, t1: 24.6, from: { pos: eclipse, look: () => win.clone().lerp(head(), 0.85), fov: 34 }, to: { pos: eclipse, look: () => win.clone().lerp(head(), 0.8), fov: 31 }, e: 'linear' },
      { t0: 24.6, t1: 29.4, from: { pos: V(0.9, 1.95, pz + 2.4), look: chest, fov: 44 }, to: { pos: V(0.8, 1.85, pz + 2.0), look: chest, fov: 42 }, e: 'linear' },
      { t0: 29.4, t1: 32.6, from: { pos: () => head().add(V(0.5, -0.15, 3.0)), look: head, fov: 30 }, to: { pos: () => head().add(V(0.35, -0.1, 2.6)), look: head, fov: 28 }, e: 'linear' },
    ];
    this.duration = 32.6;
    this.boss.a.startMove('rise');
    this.boss.a.move.t = 0.2;
    this.boss.armed(false);
    this.ui.showHUD(false);
    document.getElementById('letterbox').classList.add('on');
    this.ui.setHint('Enter 跳过');
  }

  once(key, at, fn) { if (this.t >= at && !this.fired.has(key)) { this.fired.add(key); fn(); } }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const t = this.t, b = this.boss;
    // boss pose timeline (rise track time)
    const mv = b.a.move;
    if (mv && mv.name === 'rise') {
      let rt;
      if (t < 10.2) rt = Math.max(0.2, Math.min(1.6, t * 0.1));
      else if (t < 13.2) rt = 1.6 + (t - 10.2) / 3 * 0.6;
      else if (t < 20.6) rt = 2.2 + ease.inOut((t - 13.2) / 7.4) * 4.4;
      else rt = 6.6;
      mv.t = rt;
      if (t >= 20.6 && t < 24.6) mv.t = 6.59;
    }
    // events
    this.once('wax-drop', 5.5, () => this.fx.motes(b.a.bonePos('RightHand'), 0.05, 3, new THREE.Color(1.0, 0.88, 0.6)));
    this.once('hymn-stop', 6.1, () => { this.audio?.setMusic('tension', { fade: 0.08 }); this.fx.splash(b.a.bonePos('RightHand').setY(0), 0.25); });
    this.once('tremble', 8.0, () => { b.tremble = 1.6; this.audio?.play('sword_glint', { pos: b.lockPoint, volume: 0.25, pitch: 0.7 }); });
    this.once('crack1', 10.4, () => this.audio?.play('bell', { pos: b.pos, volume: 0.35, pitch: 0.5 }));
    this.once('crack2', 13.5, () => { this.audio?.play('phase_shift', { pos: b.pos, volume: 0.45 }); this.fx.motes(b.pos.clone().setY(1.2), 2.2, 90); this.fx.dust(b.pos, 2.8, 40); });
    this.once('step1', 16.2, () => { this.audio?.play('boss_step', { pos: b.pos }); this.fx.splash(b.a.bonePos('RightFoot'), 1.6); });
    this.once('step2', 19.4, () => { this.audio?.play('boss_step', { pos: b.pos, volume: 1.2 }); this.fx.splash(b.a.bonePos('LeftFoot'), 1.8); this.fx.dust(b.pos, 3, 40); });
    this.once('draw', 24.7, () => { b.a.stopMove(); b.a.startMove('draw'); });
    this.once('drawn', 24.7 + 0.95, () => b.drawFromBack());
    this.once('turn', 27.3, () => { this.turning = { from: b.yaw, to: Math.atan2(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z), t: 0 }; });
    this.once('line', 29.7, () => this.ui.subtitle('……你也是来祈祷的吗。', 2.8));
    if (this.turning) {
      const tr = this.turning;
      tr.t = Math.min(1, tr.t + dt / 1.7);
      const d = Math.atan2(Math.sin(tr.to - tr.from), Math.cos(tr.to - tr.from));
      b.yaw = tr.from + d * ease.inOut(tr.t);
      if (tr.t < 1 && !b.a.move) b.walkAnim(0.4, true);
      if (tr.t >= 1) { b.a.playBase('idle', { fade: 0.5 }); this.turning = null; }
    }
    if (b.tremble > 0) {
      b.tremble -= dt;
      const s = b.backSwords[5];
      s.obj.rotation.z += Math.sin(t * 80) * 0.01 * b.tremble;
    }
    // camera
    const shot = this.shots.find(s => t >= s.t0 && t < s.t1) || this.shots[this.shots.length - 1];
    const f = (ease[shot.e] || ease.linear)(THREE.MathUtils.clamp((t - shot.t0) / (shot.t1 - shot.t0), 0, 1));
    const val = v => (typeof v === 'function' ? v() : v);
    const pos = val(shot.from.pos).clone().lerp(val(shot.to.pos), f);
    const look = val(shot.from.look).clone().lerp(val(shot.to.look), f);
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    const ap = { 0: 0.0007, 1: 0.006, 2: 0.0016, 3: 0.007, 4: 0.0012, 5: 0.0008, 6: 0.0014, 7: 0.006 }[this.shots.indexOf(shot)] ?? 0.001;
    this.dof = { focus: pos.distanceTo(look), aperture: ap, maxblur: 0.012 };
    const fov = shot.from.fov + (shot.to.fov - shot.from.fov) * f;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.audio?.setListener({ position: pos, forward: look.clone().sub(pos).normalize() });
    if (t >= this.duration) this.finish();
  }

  skip() {
    if (this.done) return;
    const b = this.boss;
    b.a.stopMove();
    if (!b.backSwords[3] || b.backSwords[3].state !== 'drawn') b.drawFromBack();
    b.yaw = Math.atan2(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z);
    b.a.playBase('idle', { fade: 0 });
    this.audio?.setMusic('tension', { fade: 0.1 });
    this.finish(true);
  }

  finish(skipped = false) {
    this.done = true;
    document.getElementById('letterbox').classList.remove('on');
    this.ui.setHint('');
    this.onDone?.(skipped);
  }
}
