#!/usr/bin/env node
// Scenario runner: node test/smoke.mjs <scenario> [outDir]
//   start   - title -> approach, screenshot the nave
//   intro   - walk up, play the intro cutscene, screenshot each shot
//   fight   - skip intro, lock on, attack / roll / get hit, screenshots + state checks
//   phase2  - drop the boss to the phase-two threshold and capture the transition
import fs from 'node:fs';
import { startServer } from '../serve.mjs';

const require = (await import('node:module')).createRequire(import.meta.url);
const puppeteer = require('../../tools/render/node_modules/puppeteer-core');
const [scenario = 'start', outDir = 'test/out/smoke'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const W = +(process.env.W || 1280), H = +(process.env.H || 720);

const server = await startServer(0);
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 900000,
  args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`],
});
const errors = [];
const page = await browser.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
page.on('console', m => { if (['error', 'warning', 'warn'].includes(m.type()) && !/404|favicon/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
await page.setViewport({ width: W, height: H });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async name => { await page.screenshot({ path: `${outDir}/${scenario}_${name}.png` }); console.log('shot', name); };
const G = expr => page.evaluate(`(() => { const G = window.__game; return ${expr}; })()`);
const press = a => page.evaluate(a => window.__game.input.press(a), a);
const state = () => G(`({ state: G.state, php: Math.round(G.player.hp), pst: Math.round(G.player.st), pstate: G.player.state,
  bhp: Math.round(G.boss.hp), bstate: G.boss.state, bmove: G.boss.a.move && G.boss.a.move.name, phase: G.boss.phase,
  dist: +Math.hypot(G.player.pos.x - G.boss.pos.x, G.player.pos.z - G.boss.pos.z).toFixed(2), locked: G.camRig.locked,
  t: +G.time.toFixed(2), hs: +G.hitstop.toFixed(3), sm: G.slowmo, paused: G.paused, pmove: G.player.a.move && G.player.a.move.name })`);

async function open(q) {
  await page.goto(`http://127.0.0.1:${port}/index.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || window.__error', { timeout: 120000, polling: 250 });
  const err = await page.evaluate('window.__error || null');
  if (err) throw new Error('boot failed: ' + err);
  // the game survives a broken arena module with a plain fallback floor: that must never pass as a good run
  if (!(await page.evaluate('!!(window.__game && window.__game.arena && window.__game.arena.cameraBlockers)'))) throw new Error('arena.js failed to load (fallback arena in use)');
}

try {
  if (scenario === 'start') {
    await open('autostart&debug');
    await sleep(2500); await shot('approach');
    await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
    await shot('walking'); console.log(await state());
  }
  if (scenario === 'intro') {
    await open('autostart&debug');
    await sleep(1500);
    await G(`(G.player.pos.z = G.boss.pos.z + 16.5, true)`);
    for (const t of [1.5, 5.0, 8.5, 11.5, 15.5, 19.5, 22.5, 26.0, 28.5, 30.5, 33.5]) {
      await page.waitForFunction(t => window.__game.intro ? window.__game.intro.t >= t : window.__game.state === 'fight', { timeout: 60000, polling: 50 }, t);
      await shot('t' + t);
    }
    console.log(await state());
  }
  if (scenario === 'fight') {
    await open('autostart&debug&skipintro');
    await sleep(1500);
    await G(`(G.player.pos.set(G.boss.pos.x, 0, G.boss.pos.z + 7), true)`);
    await sleep(500); await shot('locked'); console.log(await state());
    await page.keyboard.down('KeyW'); await sleep(900); await page.keyboard.up('KeyW');
    for (let i = 0; i < 3; i++) { await press('light'); await sleep(260); }
    await sleep(100); await shot('combo');
    await sleep(900); console.log(await state());
    await press('heavy'); await sleep(700); await shot('heavy'); await sleep(900);
    await press('roll'); await sleep(250); await shot('roll'); await sleep(800);
    console.log(await state());
    for (let i = 0; i < 6; i++) { await sleep(1500); await shot('boss' + i); console.log(await state()); }
  }
  if (scenario === 'combat') {
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, G.player.pos.set(G.boss.pos.x + 0.6, 0, G.boss.pos.z + 3.4), true)`);
    await sleep(700); await shot('ready');
    await press('light'); await sleep(170); await shot('light_swing'); await sleep(90); await shot('light_hit');
    await sleep(700);
    await press('light'); await sleep(230); await shot('light2');
    await sleep(700);
    await press('heavy'); await sleep(1250); await shot('heavy_hit'); await sleep(900);
    await G(`(G.player.pos.set(G.boss.pos.x + 2.5, 0, G.boss.pos.z + 5), true)`);
    await press('roll'); await sleep(200); await shot('roll_mid');
    await sleep(1200); console.log(await state());
  }
  if (scenario === 'fullfight') {
    // title -> approach -> intro (skipped after a few seconds) -> fight with a simple bot -> phase 2 -> victory
    await open('autostart&debug&god');
    await sleep(1500); await shot('approach');
    await G(`(G.player.pos.z = G.boss.pos.z + 16.5, true)`);
    await page.waitForFunction(() => window.__game.state === 'intro', { timeout: 20000 });
    await sleep(6000); await shot('intro'); await press('skip');
    await page.waitForFunction(() => window.__game.state === 'fight', { timeout: 20000 });
    await G(`(G.boss.hp = 620, true)`);   // shorter test: starts above the phase-two line
    let last = '', t0 = Date.now(), shots = 0;
    while (Date.now() - t0 < 150000) {
      const s = await G(`({ st: G.state, bs: G.boss.state, mv: G.boss.a.move && G.boss.a.move.name, mt: G.boss.a.move ? G.boss.a.move.t : 0,
        d: Math.hypot(G.player.pos.x - G.boss.pos.x, G.player.pos.z - G.boss.pos.z), ps: G.player.state, bhp: Math.round(G.boss.hp), ph: G.boss.phase,
        music: G.audio.musicState, dead: G.boss.dead, locked: G.camRig.locked, php: Math.round(G.player.hp) })`);
      const line = `${s.st} boss=${s.bs}/${s.mv || '-'} hp=${s.bhp} ph=${s.ph} music=${s.music} php=${s.php} d=${s.d.toFixed(1)}`;
      if (line.split(' d=')[0] !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's ' + line); last = line.split(' d=')[0]; }
      if (s.st === 'victory') { await sleep(3000); await shot('victory'); break; }
      if (!s.locked && s.bs !== 'transition' && !s.dead) await press('lock');
      const threat = s.bs === 'attack' && s.d < 8 && s.mt > 0.35 && s.mt < 1.6;
      if (threat && s.ps !== 'roll') { await press('roll'); await sleep(260); continue; }
      if (s.d > 3.2) { await page.keyboard.down('KeyW'); await sleep(220); await page.keyboard.up('KeyW'); }
      else { await press('light'); await sleep(240); }
      if (shots < 6 && Math.random() < 0.04) { await shot('fight' + shots); shots++; }
    }
    console.log('final', JSON.stringify(await state()));
  }
  if (scenario === 'critical') {
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.chooseAttack = () => null, G.boss.cooldown = 1e9, G.boss.a.stopMove(), G.boss.state = 'idle', G.boss.yaw = 0,
      G.player.pos.set(G.boss.pos.x + 0.3, 0, G.boss.pos.z + 4.0), G.player.yaw = Math.PI, true)`);
    await sleep(300);
    await G(`(G.boss.stagger(), true)`);
    await sleep(500);
    const before = await G(`({ open: G.boss.criticalOpen(G.player), hp: Math.round(G.boss.hp), hint: document.querySelector('#hint').textContent })`);
    await press('light');
    await sleep(380); await shot('crit_stab');
    await sleep(500); await shot('crit_hold');
    await sleep(900); await shot('crit_after');
    console.log('before', JSON.stringify(before), 'after', JSON.stringify(await G(`({ hp: Math.round(G.boss.hp), pstate: G.player.state, bmove: G.boss.a.move && G.boss.a.move.name })`)));
    if (await G('G.boss.criticalOpen(G.player)')) throw new Error('a second execution is open in the same kneel');
  }
  if (scenario === 'block') {
    await open('autostart&debug&skipintro');
    await sleep(1200);
    const setup = `(G.boss.chooseAttack = () => null, G.boss.cooldown = 1e9, G.boss.a.stopMove(), G.boss.state = 'idle',
      G.player.pos.set(G.boss.pos.x - 0.5, 0, G.boss.pos.z + 4.6), G.player.hp = 100, G.player.st = 100,
      G.boss.yaw = 0, G.player.yaw = Math.PI, G.boss.poise = 0, true)`;
    // plain block: hold the guard well before the sweep connects
    await G(setup); await sleep(300);
    await press('block');
    await sleep(400);
    await G(`(G.boss.startAttack('sweep', G.player), true)`);
    await sleep(700); await shot('blocked');
    await sleep(700);
    console.log('block:', JSON.stringify(await G(`({ hp: Math.round(G.player.hp), st: Math.round(G.player.st), pstate: G.player.state, poise: Math.round(G.boss.poise) })`)));
    await G(`(G.input.release('block'), true)`); await sleep(1500);
    // perfect guard: press the instant before the first sweep hit (window opens at 0.68 s)
    await G(setup); await sleep(300);
    await G(`(G.boss.startAttack('sweep', G.player), true)`);
    await page.waitForFunction(() => { const m = window.__game.boss.a.move; return m && m.t >= 0.6; }, { polling: 'raf', timeout: 5000 });
    await press('block');
    await sleep(150); await shot('parry');
    await sleep(600);
    console.log('parry:', JSON.stringify(await G(`({ hp: Math.round(G.player.hp), st: Math.round(G.player.st), pstate: G.player.state, poise: Math.round(G.boss.poise) })`)));
    await G(`(G.input.release('block'), true)`);
  }
  if (scenario === 'candles') {
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.chooseAttack = () => null, G.boss.cooldown = 1e9, G.boss.a.stopMove(), G.boss.state = 'idle', G.boss.yaw = 0,
      G.player.pos.set(G.boss.pos.x + 7, 0, G.boss.pos.z + 3), true)`);
    await sleep(300);
    await G(`(G.boss.startAttack('slam', G.player), G.boss.holdFor = 0.1, true)`);
    await sleep(1900);
    await G(`(G.debugCam = { pos: new G.boss.pos.constructor(G.boss.pos.x + 5.5, 2.2, G.boss.pos.z + 9.5), look: new G.boss.pos.constructor(G.boss.pos.x, 0.2, G.boss.pos.z + 4.2), fov: 50 }, true)`);
    await sleep(200); await shot('after_slam');
    await sleep(1800); await shot('smoke_settled');
  }
  if (scenario === 'moves') {
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    const force = async (name, dist, waits, phase2 = false) => {
      await G(`(G.boss.chooseAttack = () => null, G.boss.cooldown = 1e9, G.boss.a.stopMove(), G.boss.state = 'idle',
        G.player.pos.set(G.boss.pos.x + 1.0, 0, G.boss.pos.z + ${dist}), G.boss.yaw = 0, true)`);
      if (phase2) await G(`(G.boss.phase === 1 && G.boss.swapToPhase2(), G.boss.state = 'idle', G.boss.invulnerable = false, true)`);
      await sleep(400);
      await G(`(G.boss.startAttack('${name}', G.player), true)`);
      let t0 = 0;
      for (const w of waits) { await sleep(w - t0); t0 = w; await shot(name + '_' + w); }
      await sleep(1500);
    };
    await force('slam', 6, [900, 1700, 1900]);
    await force('sweep', 4.5, [700, 900]);
    await force('thrust', 9, [800, 1100]);
    await force('volley', 11, [900, 1500, 2300, 3200]);
    await force('pray', 8, [1000, 1500, 2500]);
    await force('wing', 5, [1000, 1400], true);
    console.log(await state());
  }
  if (scenario === 'strafe') {
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, G.player.pos.set(G.boss.pos.x, 0, G.boss.pos.z + 9), true)`);
    await sleep(600);
    await page.keyboard.down('KeyA'); await sleep(900); await shot('strafe_left'); await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyS'); await sleep(900); await shot('backpedal'); console.log(await G(`({ back: G.player.backpedal, ts: G.player.a.actions.walk.getEffectiveTimeScale().toFixed(2), tw: (G.player.twist||0).toFixed(2) })`)); await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyD'); await sleep(900); await shot('strafe_right'); await page.keyboard.up('KeyD');
  }
  if (scenario === 'victory') {
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    // VD=<m> player distance (default 9), VP2=1 kill her in phase two, VDT=<ms> between shots
    const vd = +(process.env.VD || 9), vdt = +(process.env.VDT || 1100);
    if (process.env.VP2) { await G(`(G.boss.swapToPhase2(), true)`); await sleep(2500); }
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, G.player.pos.set(G.boss.pos.x, 0, G.boss.pos.z + ${vd}), G.boss.hp = 5, true)`);
    await sleep(300);
    await G(`(G.boss.takeHit({ dmg: 30, poise: 0, point: G.boss.lockPoint, dir: new G.boss.pos.constructor(0, 0, -1), heavy: true }), true)`);
    for (let i = 0; i < 10; i++) { await sleep(vdt); await shot('v' + i); }
    console.log(await state());
  }
  if (scenario === 'death') {
    await open('autostart&debug&skipintro');
    await sleep(1200);
    await G(`(G.player.pos.set(G.boss.pos.x, 0, G.boss.pos.z + 3), G.player.hp = 5, true)`);
    for (let i = 0; i < 9; i++) { await sleep(1000); await shot('d' + i); console.log(JSON.stringify(await state())); }
  }
  if (scenario === 'phase2') {
    await open('autostart&debug&skipintro&god');
    await sleep(1500);
    await G(`(G.player.pos.set(G.boss.pos.x, 0, G.boss.pos.z + 9), G.boss.hp = G.boss.T.maxHp * 0.505, true)`);
    await sleep(300);
    await G(`(G.boss.takeHit({ dmg: 30, poise: 0, point: G.boss.lockPoint, dir: new G.boss.pos.constructor(0, 0, -1), heavy: true }), true)`);
    for (let i = 0; i < 9; i++) { await sleep(900); await shot('p' + i); console.log(await state()); }
  }
  if (scenario === 'look') {
    // phase-one vs phase-two readability at three distances (boss passive, player locked on)
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, true)`);
    const place = d => G(`(G.player.pos.set(G.boss.pos.x + 0.8, 0, G.boss.pos.z + ${d}), G.player.yaw = Math.PI, true)`);
    for (const ph of [1, 2]) {
      if (ph === 2) { await G(`(G.boss.swapToPhase2(), true)`); if (process.env.LOOKX) await G(process.env.LOOKX); await sleep(5000); }
      for (const d of [10, 5, 2.4]) { await place(d); await sleep(900); await shot(`p${ph}_d${d}`); }
    }
    console.log(await state());
  }
  if (scenario === 'muffle') {
    // low health closes the music in (lowpass) and starts the heartbeat; full health opens it again
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, true)`);
    const lp = () => G(`Math.round(G.audio._eng.musicLP[0].frequency.value)`);
    const beats = () => G(`G.audio.stats().created`);
    const f0 = await lp();
    await G(`(G.player.hp = 15, true)`); const b0 = await beats(); await sleep(2500);
    const f1 = await lp(), b1 = await beats();
    await G(`(G.player.hp = 100, true)`); await sleep(1500);
    const f2 = await lp();
    console.log(JSON.stringify({ full: f0, low: f1, voicesDuringLow: b1 - b0, healed: f2 }));
    if (!(f0 > 8000 && f1 < 3000 && f2 > 8000)) throw new Error('muffle not working');
  }
  if (scenario === 'runattack') {
    // sprint at her and attack: the lunge must fire, close the gap and land
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, G.player.pos.set(G.boss.pos.x + 0.5, 0, G.boss.pos.z + 9.5), G.player.yaw = Math.PI, true)`);
    await sleep(600);
    const hp0 = await G('G.boss.hp');
    await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(() => { const G = window.__game; return G.player.speed > 5.2 && Math.hypot(G.player.pos.x - G.boss.pos.x, G.player.pos.z - G.boss.pos.z) < 5.6; }, { timeout: 6000, polling: 16 });
    const d0 = await G('Math.hypot(G.player.pos.x - G.boss.pos.x, G.player.pos.z - G.boss.pos.z)');
    await press('heavy');
    await sleep(110); await shot('windup');
    const mv = await G('G.player.a.move && G.player.a.move.name');
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    await sleep(110); await shot('strike');
    await sleep(500); await shot('after');
    const r = await G(`({ hp: G.boss.hp, d: Math.hypot(G.player.pos.x - G.boss.pos.x, G.player.pos.z - G.boss.pos.z), st: G.player.st })`);
    console.log(JSON.stringify({ move: mv, startDist: +d0.toFixed(2), endDist: +r.d.toFixed(2), dmg: Math.round(hp0 - r.hp), st: Math.round(r.st) }));
    if (mv !== 'runAttack') throw new Error('running attack did not start');
  }
  if (scenario === 'camwall') {
    // locked on near the side wall / behind her: the camera must stay in the nave and out of her body
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, G.boss.turnGoal = null, true)`);
    const spots = [[10.5, 2.0, 'wall_r'], [-10.6, -1.5, 'wall_l'], [6.5, 7.5, 'diag'], [0.3, -3.5, 'behind_her']];
    for (const [dx, dz, name] of spots) {
      await G(`(G.player.pos.set(G.boss.pos.x + ${dx}, 0, G.boss.pos.z + ${dz}), true)`);
      await sleep(1300); await shot(name);
      console.log(name, JSON.stringify(await G(`({ cam: G.camRig.cam.position.toArray().map(v => +v.toFixed(2)), locked: G.camRig.locked })`)));
    }
  }
  if (scenario === 'camsweep') {
    // walk the player along both side walls while locked on: no pier may ever stand between camera and player
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    const res = await page.evaluate(async () => {
      const G = window.__game, sleep = ms => new Promise(r => setTimeout(r, ms));
      G.boss.cooldown = 1e9; G.boss.chooseAttack = () => null; G.boss.update = () => {};
      const piers = (G.arena.cameraBlockers || { circles: [] }).circles;
      const occluded = (a, b) => piers.some(({ x, z }) => {
        const dx = b.x - a.x, dz = b.z - a.z; let t = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
        t = Math.max(0, Math.min(1, t)); const px = a.x + t * dx - x, pz = a.z + t * dz - z; return px * px + pz * pz < 1.25 * 1.25;
      });
      let n = 0, bad = 0, minD = 99;
      for (const side of [-1, 1]) for (let z = -34; z <= 42; z += 2) {
        G.player.pos.set(side * 10.8, 0, z); await sleep(450);
        const c = G.camRig.cam.position, p = G.player.pos; n++;
        minD = Math.min(minD, Math.hypot(c.x - p.x, c.z - p.z));
        if (occluded(c, p)) bad++;
      }
      return { positions: n, occluded: bad, minCamDist: +minD.toFixed(2) };
    });
    console.log(JSON.stringify(res));
    if (res.occluded) throw new Error('camera lost the player behind a pier');
  }
  if (scenario === 'settings') {
    // pause panel: sliders apply at once and survive a reload
    await open('autostart&debug&skipintro');
    await sleep(1200);
    await page.keyboard.press('Escape'); await sleep(300);
    await shot('pause');
    const setVal = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input')); }, id, v);
    await setVal('s-music', 40); await setVal('s-sens', 150); await setVal('s-shake', 0); await setVal('s-invy', true);
    const applied = await G(`({ music: G.audio._vol.music, sens: +G.input.lookSensitivity.toFixed(4), shake: G.camRig.shakeScale, invY: G.input.invertY, paused: G.paused })`);
    await page.click('#p-resume'); await sleep(200);
    const resumed = await G('G.paused');
    await open('autostart&debug&skipintro');
    const kept = await G(`({ music: G.audio._vol.music, sens: +G.input.lookSensitivity.toFixed(4), shake: G.camRig.shakeScale, invY: G.input.invertY })`);
    console.log(JSON.stringify({ applied, resumed, kept }));
    await page.evaluate(() => localStorage.removeItem('hunxi.settings.v1'));
    if (applied.music !== 0.4 || applied.shake !== 0 || !applied.invY || resumed || kept.sens !== 0.0036) throw new Error('settings not applied / persisted');
  }
  if (scenario === 'bossmoves') {
    // every attack from the player's locked-on view, frozen at its key moments (MOVES=slam,sweep,... P2=1)
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    if (process.env.P2) { await G(`(G.boss.swapToPhase2(), true)`); await sleep(9000); }
    const plan = { slam: [0.75, 1.0, 1.47, 1.6], sweep: [0.56, 0.76, 0.96, 1.44], thrust: [0.72, 0.95, 1.1, 1.4], volley: [0.6, 1.4, 2.2, 3.0],
      pray: [0.9, 1.4, 2.4, 3.4], wing: [0.5, 1.0, 1.3, 1.6] };
    const names = (process.env.MOVES || 'slam,sweep,thrust').split(',');
    for (const name of names) {
      await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, G.boss.state = 'idle', G.boss.a.stopMove(), true)`);
      await G(`(G.player.pos.set(G.boss.pos.x + 0.6, 0, G.boss.pos.z + ${process.env.DIST || 6.5}), G.player.yaw = Math.PI, G.boss.yaw = 0, true)`);
      await sleep(900);
      await G(`(G.boss.startAttack('${name}', G.player), true)`);
      for (const t of plan[name]) {
        await page.waitForFunction(t => { const m = window.__game.boss.a.move; return !m || m.t >= t; }, { timeout: 15000, polling: 8 }, t);
        await G('(G.paused = true, true)'); await sleep(120);
        await shot(`${name}_${t}`);
        await G('(G.paused = false, true)');
      }
      await sleep(2500);
    }
  }
  if (scenario === 'scale') {
    // how big does she look next to the knight from the locked-on camera? LENS="distAdd,fovAdd" overrides the rig
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, true)`);
    if (process.env.LENS) { const [a, b] = process.env.LENS.split(',').map(Number); await G(`(G.camRig.lockDistAdd = ${a}, G.camRig.lockFovAdd = ${b}, true)`); }
    for (const d of [2.5, 6.5, 12]) {
      await G(`(G.player.pos.set(G.boss.pos.x + 0.6, 0, G.boss.pos.z + ${d}), true)`); await sleep(1400);
      // projected heights: boss head vs feet, knight head vs feet
      const r = await G(`(() => { const cam = G.camRig.cam, V = G.boss.pos.constructor; const h = (p, y) => new V(p.x, y, p.z).project(cam).y;
        const bh = h(G.boss.pos, 5.1) - h(G.boss.pos, 0), ph = h(G.player.pos, 1.7) - h(G.player.pos, 0);
        return { bossScreen: +(bh / 2).toFixed(2), knightScreen: +(ph / 2).toFixed(2), ratio: +(bh / ph).toFixed(2), fov: +cam.fov.toFixed(1) }; })()`);
      console.log('d=' + d, JSON.stringify(r)); await shot('d' + d);
    }
  }
  if (scenario === 'volley') {
    // the seven-sword volley in both phases: after it ends no sword may be left hanging in the halo
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    for (const p2 of [false, true]) {
      const r = await page.evaluate(async (p2) => {
        const G = window.__game, b = G.boss, sleep = ms => new Promise(r => setTimeout(r, ms));
        if (p2) { b.swapToPhase2(); await sleep(9000); }
        b.cooldown = 1e9; b.chooseAttack = () => null; b.state = 'idle'; b.a.stopMove();
        G.player.pos.set(b.pos.x + 0.6, 0, b.pos.z + 6.5); await sleep(800);
        b.startAttack('volley', G.player);
        let flown = 0; for (let i = 0; i < 20; i++) { await sleep(250); flown = Math.max(flown, b.backSwords.filter(s => s.state === 'flying' || s.state === 'stuck').length); }
        return { phase: b.phase, flown, left: b.backSwords.filter(s => s.state === 'rising' || s.state === 'hover').length };
      }, p2);
      console.log(JSON.stringify(r));
      if (r.left) throw new Error(`a sword was left hovering after the volley (phase ${r.phase})`);
      if (r.flown < (p2 ? 6 : 5)) throw new Error(`only ${r.flown} swords flew (phase ${r.phase})`);
    }
  }
  if (scenario === 'aistats') {
    // let her fight a player who keeps circling at melee / mid range; tally which attacks she picks and how often she chains
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    const res = await page.evaluate(async (secs) => {
      const G = window.__game, b = G.boss, sleep = ms => new Promise(r => setTimeout(r, ms));
      const log = []; const orig = b.startAttack.bind(b);
      b.startAttack = (name, player) => { log.push({ name, chain: b.chain || 0, phase: b.phase }); return orig(name, player); };
      const run = async (seconds) => {
        const t0 = performance.now(); let k = 0;
        while (performance.now() - t0 < seconds * 1000) {
          // hop between three ranges around her so every branch of her choice gets exercised
          const r = [3.2, 4.5, 7.5][k % 3], a = (k * 0.9) % (Math.PI * 2);
          G.player.pos.set(b.pos.x + Math.sin(a) * r, 0, b.pos.z + Math.cos(a) * r);
          k++; await sleep(2600);
        }
      };
      await run(secs);
      b.swapToPhase2(); await sleep(9000);
      await run(secs);
      return log;
    }, +(process.env.SECS || 90));
    const tally = {};
    for (const e of res) { const k = `p${e.phase}`; tally[k] = tally[k] || { total: 0, chained: 0 }; tally[k].total++; tally[k][e.name] = (tally[k][e.name] || 0) + 1; if (e.chain) tally[k].chained++; }
    console.log(JSON.stringify(tally));
  }
  if (scenario === 'pmoves') {
    // the knight's own moves from the locked-on camera, frozen at their key moments
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    await G(`(G.boss.cooldown = 1e9, G.boss.chooseAttack = () => null, true)`);
    const plan = [['light', 'light1', [0.13, 0.22, 0.3]], ['light', 'light2', [0.15, 0.25]], ['light', 'light3', [0.18, 0.27, 0.36]],
      ['heavy', 'heavy', [0.42, 0.53, 0.62]], ['roll', 'roll', [0.1, 0.21, 0.36]], ['heal', 'heal', [0.5, 1.0]]];
    for (const [action, move, times] of plan) {
      if (move === 'light1' || move === 'heavy' || move === 'roll' || move === 'heal') {
        await G(`(G.player.a.stopMove(), G.player.state = 'idle', G.player.pos.set(G.boss.pos.x + 0.8, 0, G.boss.pos.z + 3.6), G.player.st = 100, true)`);
        await sleep(700);
      }
      await press(action);
      if (action === 'heavy') { await sleep(120); await G(`(G.input.release('heavy'), true)`); }
      await page.waitForFunction(m => { const mv = window.__game.player.a.move; return mv && mv.name === m; }, { timeout: 4000, polling: 8 }, move);
      for (const t of times) {
        await page.waitForFunction((m, t) => { const mv = window.__game.player.a.move; return !mv || mv.name !== m || mv.t >= t; }, { timeout: 4000, polling: 4 }, move, t);
        await G('(G.paused = true, true)'); await sleep(90); await shot(`${move}_${t}`); await G('(G.paused = false, true)');
      }
      if (move.startsWith('light') && move !== 'light3') continue;   // the next light continues the combo
      await sleep(1300);
    }
  }
  if (scenario === 'combo') {
    // mashing light must walk the whole three-swing chain in order
    await open('autostart&debug&skipintro&god');
    await sleep(1200);
    const seq = await page.evaluate(async () => {
      const G = window.__game, sleep = ms => new Promise(r => setTimeout(r, ms));
      G.boss.cooldown = 1e9; G.boss.chooseAttack = () => null;
      G.player.pos.set(G.boss.pos.x + 0.8, 0, G.boss.pos.z + 3.6); await sleep(600);
      const seen = []; let last = null; const t0 = performance.now();
      while (performance.now() - t0 < 4200) {
        const mv = G.player.a.move, n = mv && mv.name;
        if (n && n !== last) seen.push(n); last = n;
        if (!mv || mv.t > 0.32) G.input.press('light');
        await sleep(40);
      }
      return seen;
    });
    console.log(seq.join(' -> '));
    if (seq.slice(0, 4).join() !== 'light1,light2,light3,light1') throw new Error('light combo out of order: ' + seq.join(','));
  }
  if (scenario === 'mv') {
    // the opening MV: frames from every shot, then the title menu must appear (MVT=comma list of times overrides)
    await page.goto(`http://127.0.0.1:${port}/index.html?debug&mv`, { waitUntil: 'load' });
    await page.waitForFunction('window.__game && window.__game.state === "mv"', { timeout: 120000, polling: 250 });
    if (!(await page.evaluate('!!window.__game.arena.cameraBlockers'))) throw new Error('arena.js failed to load (fallback arena in use)');
    const times = (process.env.MVT || '3,9,12,16,22,24,29,32,35.5,40,43,46.5,49').split(',').map(Number);
    for (const t of times) {
      await page.waitForFunction(t => { const G = window.__game; return G.state !== 'mv' || G.mv.t >= t; }, { timeout: 90000, polling: 8 }, t);
      await G('(G.paused = true, true)'); await sleep(110); await shot('t' + t); await G('(G.paused = false, true)');
    }
    await page.waitForFunction('window.__game.state === "title"', { timeout: 30000, polling: 100 });
    const menu = await page.evaluate(() => !document.getElementById('title').classList.contains('nomenu') && !document.getElementById('title').classList.contains('hide'));
    await sleep(1500); await shot('title');
    console.log(JSON.stringify({ state: await G('G.state'), menu, music: await G('G.audio.musicState') }));
    if (!menu) throw new Error('title menu did not appear after the MV');
  }
} catch (e) {
  console.error('ERROR', e.message);
  await shot('error').catch(() => {});
} finally {
  if (errors.length) console.log('console errors:\n  ' + [...new Set(errors)].slice(0, 15).join('\n  '));
  await browser.close(); server.close();
}
