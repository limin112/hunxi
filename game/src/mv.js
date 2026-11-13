// Opening MV: the launch cinematic (~49 s, skippable), scored by the 'opening' music state (src/audio/music.js).
//   1 candles in the dark           长夜无尽。
//   2 up a pier into the vault       圣堂里的烛火，燃了一千年。
//   3 along the kneeling wax knights 跪在这里的骑士，都化作了蜡像。
//   4 the seven swords in her back   她以七剑刺穿自己，替世人承受七苦。
//   5 the saint at prayer            她向神祈祷了一千年。
//   6 silence, the window            神从未回应。
//   7 a knight in the moonlit door   今夜，有人推开了圣堂的门。
//   8 the title (the title screen's own camera, so the menu fades in without a cut)
import * as THREE from 'three';
import { ease } from './pose.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The portal pushed ajar: a seam of moonlight between the leaves, its spill across the floor, a cold light outside. */
function makeDoorLight(scene, zDoor) {
  const g = new THREE.Group();
  const seam = canvasTex(128, 512, (x, w, h) => {
    const gx = x.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.42, 'rgba(255,255,255,0.55)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(0.58, 'rgba(255,255,255,0.55)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gx; x.fillRect(0, 0, w, h);
    const gy = x.createLinearGradient(0, 0, 0, h);            // brighter low, fading toward the arch
    gy.addColorStop(0, 'rgba(0,0,0,0.85)'); gy.addColorStop(0.35, 'rgba(0,0,0,0.2)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = gy; x.fillRect(0, 0, w, h);
  });
  const seamMat = new THREE.MeshBasicMaterial({ map: seam, color: new THREE.Color(1.2, 1.35, 1.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 8.2), seamMat);
  glow.position.set(0, 4.1, zDoor - 0.05); glow.rotation.y = Math.PI;
  const spill = canvasTex(256, 512, (x, w, h) => {           // a wedge widening away from the door
    x.beginPath(); x.moveTo(w * 0.44, 0); x.lineTo(w * 0.56, 0); x.lineTo(w * 0.95, h); x.lineTo(w * 0.05, h); x.closePath();
    const gy = x.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(255,255,255,0.9)'); gy.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gy.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gy; x.filter = 'blur(10px)'; x.fill();
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 16), new THREE.MeshBasicMaterial({ map: spill, color: new THREE.Color(0.38, 0.46, 0.66),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.rotation.z = Math.PI; floor.position.set(0, 0.1, zDoor - 8.2);
  const spot = new THREE.SpotLight(0xbfd3ff, 70, 34, 0.42, 0.7, 1.4);
  spot.position.set(0, 3.0, zDoor + 0.6); spot.target.position.set(0, 0.2, zDoor - 14);
  g.add(glow, floor, spot, spot.target);
  g.visible = false;
  scene.add(g);
  return g;
}

/** The title-screen camera (shared with main.js so the MV ends exactly where the title begins). */
export function titleCamera(camera, bossPos, time) {
  const a = Math.sin(time * 0.05) * 0.06;
  camera.position.set(-7.8 + a * 6, 2.1, bossPos.z + 7.2 + a * 4);
  camera.lookAt(bossPos.x + 2.6, 5.2, bossPos.z - 9);
}

export class OpeningMV {
  constructor({ camera, scene, boss, player, audio, arena, fx, textEl, onTitle, onDone, clock }) {
    Object.assign(this, { camera, scene, boss, player, audio, arena, fx, textEl, onTitle, onDone, clock });
    this.t = 0; this.done = false; this.fired = new Set(); this.line = -1;
    const bz = boss.pos.z;
    const rig = () => boss.a.rig;
    const head = () => boss.a.bonePos('Head', new THREE.Vector3());
    const back = () => boss.a.bonePos('Spine2', new THREE.Vector3());
    const swords = () => back().addScaledVector(rig().U, 1.3).addScaledVector(rig().F, -0.9);
    const win = arena.roseWindow?.center || V(0, 20, bz - 28);
    this.shots = [
      // 1 low over the altar-step candles, shallow focus
      { t0: 0, t1: 6.5, from: { pos: V(-3.5, 0.44, -25.4), look: V(-5.4, 0.34, -30.6), fov: 30 }, to: { pos: V(-4.3, 0.52, -26.5), look: V(-5.7, 0.38, -31.2), fov: 27 }, ap: 0.01, e: 'linear' },
      // 2 crane up beside a pier: the vault, the moon shafts, the window far away
      { t0: 6.5, t1: 13, from: { pos: V(9.4, 1.4, 22), look: V(1, 3.5, -12), fov: 46 }, to: { pos: V(9.0, 11.5, 17), look: V(0, 13, -42), fov: 44 }, ap: 0.0008, e: 'inOut' },
      // 3 down the row of kneeling knights from in front of them (they face the altar), so their bowed masks show
      { t0: 13, t1: 19.5, from: { pos: V(-10.1, 1.15, 12.4), look: V(-12.0, 0.95, 16.0), fov: 34 }, to: { pos: V(-10.1, 1.15, 20.4), look: V(-12.0, 0.95, 24.0), fov: 32 }, ap: 0.004, e: 'linear' },
      // 4 behind her: the seven swords fanned out of her back against the glass
      { t0: 19.5, t1: 26, from: { pos: () => back().addScaledVector(rig().F, -4.6).addScaledVector(rig().R, 2.2).setY(2.2), look: swords, fov: 38 },
        to: { pos: () => back().addScaledVector(rig().F, -4.2).addScaledVector(rig().R, -1.8).setY(2.6), look: swords, fov: 36 }, ap: 0.0016, e: 'inOut' },
      // 5 wide from behind: the saint at prayer under the rose window, a slow push in
      { t0: 26, t1: 33, from: { pos: V(0.2, 1.7, bz + 18), look: V(0, 6.6, bz - 12), fov: 40 }, to: { pos: V(0.1, 2.2, bz + 10.5), look: V(0, 6.4, bz - 12), fov: 38 }, ap: 0.0007, e: 'inOut' },
      // 6 up into the rose window, which goes dark: God never answered
      { t0: 33, t1: 38, from: { pos: V(0.7, 3.0, bz - 5.5), look: () => win.clone().add(V(0, -0.5, 0)), fov: 40 },
        to: { pos: V(0.5, 3.5, bz - 7.8), look: () => win.clone().add(V(0, -0.3, 0)), fov: 34 }, ap: 0.0006, e: 'linear' },
      // 7 the door: a masked knight walks in out of the moonlight, toward us
      { t0: 38, t1: 45, from: { pos: V(1.3, 1.3, 38.6), look: V(0, 1.75, 47.5), fov: 38 }, to: { pos: V(0.9, 1.2, 36.8), look: V(0, 1.7, 45.5), fov: 35 }, ap: 0.0018, e: 'linear' },
      // 8 the title
      { t0: 45, t1: 1e9, title: true },
    ];
    this.lines = [
      [1.6, 5.8, '长夜无尽。'],
      [7.6, 12.4, '圣堂里的烛火，燃了一千年。'],
      [14.0, 18.9, '跪在这里的骑士，都化作了蜡像。'],
      [20.4, 25.5, '她以七剑刺穿自己，替世人承受七苦。'],
      [27.0, 32.2, '她向神祈祷了一千年。'],
      [34.7, 37.7, '神从未回应。'],
      [39.2, 44.4, '今夜，有人推开了圣堂的门。'],
    ];
    this.duration = 49.5;
    this.dof = null;
    // cast: the saint kneels (title pose), the knight waits outside the door
    boss.a.startMove('rise'); boss.a.move.t = 0.2; boss.armed(false);
    this.door = makeDoorLight(scene, 49.65);
    this.knight = player.a.char.root;
    this.knight.visible = false;
    document.getElementById('letterbox').classList.add('on');
    audio?.setMusic('opening', { fade: 0.05 });
  }

  once(key, at, fn) { if (this.t >= at && !this.fired.has(key)) { this.fired.add(key); fn(); } }

  update(dt) {
    if (this.done) return;
    this.t += dt;
    const t = this.t, b = this.boss, p = this.player;
    // her pose: kneeling at prayer, the swords in her back
    if (b.a.move) b.a.move.t = 0.2;
    b.a.update(dt); b.syncSwords(dt, p);
    // the knight at the door (shot 7): walks in slowly out of the moonlight
    this.door.visible = t >= 37.5 && t < 45.2;
    if (t >= 38 && t < 45.2) {
      if (!this.knight.visible) { this.knight.visible = true; p.a.playBase('walk', { fade: 0 }); p.a.setBaseTimeScale?.(0.62); }
      const z = 48.3 - (t - 38) * 0.82;
      p.pos.set(0.15, 0, z); p.yaw = Math.PI;
      this.knight.position.copy(p.pos); this.knight.rotation.y = p.yaw;
      p.a.update(dt);
    } else if (t >= 45.2 && this.knight.visible) {
      this.knight.visible = false;
    }
    // events
    this.once('silence', 33.05, () => this.audio?.duck(0.82, 1.1));
    // the window dims while 'God never answered' is on screen, and comes back for the door
    this.arena.windowDim = t < 34 || t > 38.2 ? 0 : t < 37 ? 0.62 * ease.inOut((t - 34) / 3) : 0.62 * (1 - (t - 37) / 1.2);
    this.once('title', 45.0, () => { this.onTitle?.(); this.fx?.motes(b.lockPoint, 2.4, 50); });
    // narration
    const li = this.lines.findIndex(([a, z]) => t >= a && t < z);
    if (li !== this.line) {
      this.line = li;
      const el = this.textEl;
      if (el) {
        if (li >= 0) { el.textContent = this.lines[li][2]; el.classList.add('on'); }
        else el.classList.remove('on');
      }
    }
    // camera
    const shot = this.shots.find(s => t >= s.t0 && t < s.t1) || this.shots[this.shots.length - 1];
    if (shot.title) {
      titleCamera(this.camera, b.pos, this.clock());
      if (this.camera.fov !== 42) { this.camera.fov = 42; this.camera.updateProjectionMatrix(); }
      this.dof = null;
    } else {
      const f = (ease[shot.e] || ease.linear)(THREE.MathUtils.clamp((t - shot.t0) / (shot.t1 - shot.t0), 0, 1));
      const val = v => (typeof v === 'function' ? v() : v);
      const pos = val(shot.from.pos).clone().lerp(val(shot.to.pos), f);
      const look = val(shot.from.look).clone().lerp(val(shot.to.look), f);
      this.camera.position.copy(pos); this.camera.lookAt(look);
      const fov = shot.from.fov + (shot.to.fov - shot.from.fov) * f;
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.dof = { focus: pos.distanceTo(look), aperture: shot.ap, maxblur: 0.012 };
      this.audio?.setListener({ position: pos, forward: look.clone().sub(pos).normalize() });
    }
    // fades in and out of black between the shots
    const cut = this.shots.find(s => !s.title && Math.abs(t - s.t0) < 0.45 && s.t0 > 0);
    this.black = t < 1.2 ? 1 - t / 1.2 : cut ? 1 - Math.abs(t - cut.t0) / 0.45 : 0;
    if (t >= this.duration) this.finish();
  }

  skip() { if (!this.done) { this.audio?.setMusic('hymn', { fade: 1.5 }); this.finish(true); } }

  finish(skipped = false) {
    this.done = true;
    this.black = 0; this.dof = null; this.arena.windowDim = 0;
    this.scene.remove(this.door);
    this.door.traverse(o => { if (o.material) { o.material.map?.dispose(); o.material.dispose(); } if (o.geometry) o.geometry.dispose(); });
    this.knight.visible = true;
    if (this.textEl) this.textEl.classList.remove('on');
    document.getElementById('letterbox').classList.remove('on');
    this.onDone?.(skipped);
  }
}
