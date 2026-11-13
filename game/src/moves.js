// Move library: keyframed procedural poses (see pose.js) plus gameplay timing.
// Vectors are [right, up, forward] in character space. Arm targets are relative to the shoulder in arm lengths,
// leg targets relative to the hip joint in leg lengths. `blade` is the sword direction (grip -> tip).
//
// Move fields:
//   keys      pose keyframes (seconds)
//   hits      [[t0, t1, { dmg, poise, hitstop, kind }]]  active windows of the sword hitbox
//   cancel    time after which the next action may start (combos, rolls)
//   iframes   [t0, t1] invulnerability
//   moveRoot  [[t0, t1, meters, ease?]] forward displacement along the facing
//   track     [t0, t1, deg/s] turning toward the target allowed in this window
//   blendIn / blendOut  seconds
import { PoseTrack } from './pose.js';

const GUARD_P = {
  armR: { at: [0.06, -0.62, 0.52], pole: [0.6, -0.5, -0.35] },
  armL: { at: [-0.08, -0.78, 0.32], pole: [-0.6, -0.45, -0.3] },
  blade: [-0.04, 0.12, 0.99], grip: 1, spine: [0, 0, 0], head: [0, 0, 0], hips: [0, 0, 0],
};
// relaxed hold used under locomotion clips (arms partly free to swing)
export const HOLD_P = {
  armR: { at: [0.1, -0.82, 0.38], pole: [0.6, -0.4, -0.4], w: 0.75 },
  blade: [0.02, -0.42, 0.9], grip: 1,
};
const k = (t, o) => ({ t, ...o });

// sword raised across the body; the left hand braces the flat of the blade
export const BLOCK_P = {
  armR: { at: [-0.02, -0.16, 0.62], pole: [0.7, -0.5, -0.2] },
  armL: { at: [-0.3, -0.1, 0.56], pole: [-0.6, -0.6, -0.2], hand: [0.6, 0.5, 0.4] },
  blade: [-0.42, 0.82, 0.38], grip: 1, gripL: 0.4, spine: [8, -10, 0], head: [6, 6, 0], hips: [0, -0.05, -0.02],
};

export const HEROINE = {
  guard: GUARD_P,
  light1: {
    hits: [[0.16, 0.30, { dmg: 1.0, poise: 12, hitstop: 0.075 }]],
    cancel: 0.44, moveRoot: [[0.04, 0.30, 0.6, 'out']], track: [0, 0.14, 720], stamina: 14,
    keys: [
      k(0, GUARD_P),
      k(0.13, { ease: 'windup', armR: { at: [0.55, 0.45, -0.05], pole: [0.7, -0.3, -0.5] }, blade: [0.35, 0.45, -0.82],
        spine: [-6, 28, 4], head: [0, -12, 0], hips: [0, -0.03, 0], armL: { at: [-0.25, -0.45, 0.6], pole: [-0.6, -0.5, -0.2] } }),
      k(0.22, { ease: 'snap', armR: { at: [0.05, 0.0, 0.92], pole: [0.6, -0.6, -0.2] }, blade: [-0.75, 0.1, 0.65],
        spine: [8, 0, 0], head: [0, 0, 0], hips: [0, -0.06, 0.03] }),
      k(0.30, { ease: 'out', armR: { at: [-0.55, -0.5, 0.5], pole: [0.4, -0.8, 0.2] }, blade: [-0.6, -0.55, -0.4],
        spine: [16, -30, -4], head: [4, 10, 0], hips: [0, -0.07, 0.04], armL: { at: [-0.2, -0.7, 0.1], pole: [-0.6, -0.4, -0.3] } }),
      k(0.48, { ease: 'out', armR: { at: [-0.5, -0.6, 0.45], pole: [0.4, -0.8, 0.2] }, blade: [-0.55, -0.65, -0.3], spine: [12, -26, -3] }),
      k(0.82, { ease: 'inOut', ...GUARD_P }),
    ],
  },
  light2: {
    hits: [[0.15, 0.28, { dmg: 1.0, poise: 12, hitstop: 0.075 }]],
    cancel: 0.42, moveRoot: [[0.04, 0.28, 0.55, 'out']], track: [0, 0.12, 720], stamina: 14,
    keys: [
      k(0, { ...GUARD_P, armR: { at: [-0.5, -0.6, 0.45], pole: [0.4, -0.8, 0.2] }, blade: [-0.55, -0.65, -0.3], spine: [12, -26, -3] }),
      k(0.12, { ease: 'windup', armR: { at: [-0.5, -0.45, 0.42], pole: [0.4, -0.8, 0.1] }, blade: [-0.65, -0.35, -0.55],
        spine: [10, -32, -3], head: [0, 10, 0], hips: [0, -0.04, 0] }),
      k(0.20, { ease: 'snap', armR: { at: [0.0, 0.0, 0.92], pole: [0.5, -0.7, -0.2] }, blade: [0.8, 0.15, 0.55],
        spine: [4, 0, 0], head: [0, 0, 0], hips: [0, -0.06, 0.03] }),
      k(0.29, { ease: 'out', armR: { at: [0.62, 0.28, 0.35], pole: [0.6, -0.5, -0.4] }, blade: [0.72, 0.52, -0.38],
        spine: [-4, 32, 4], head: [0, -8, 0], hips: [0, -0.05, 0.03], armL: { at: [-0.3, -0.55, 0.45], pole: [-0.6, -0.5, -0.2] } }),
      k(0.46, { ease: 'out', armR: { at: [0.6, 0.2, 0.3], pole: [0.6, -0.5, -0.4] }, blade: [0.7, 0.45, -0.45], spine: [-2, 28, 3] }),
      k(0.80, { ease: 'inOut', ...GUARD_P }),
    ],
  },
  light3: {
    hits: [[0.21, 0.35, { dmg: 1.3, poise: 18, hitstop: 0.095 }]],
    cancel: 0.55, moveRoot: [[0.06, 0.34, 0.8, 'out']], track: [0, 0.18, 600], stamina: 16,
    keys: [
      k(0, { ...GUARD_P, armR: { at: [0.6, 0.2, 0.3], pole: [0.6, -0.5, -0.4] }, blade: [0.7, 0.45, -0.45], spine: [-2, 28, 3] }),
      k(0.18, { ease: 'windup', armR: { at: [0.12, 0.88, 0.05], pole: [0.8, 0.0, -0.5] }, blade: [0.05, 0.35, -0.93],
        spine: [-14, 8, 0], head: [-8, 0, 0], hips: [0, 0.0, -0.02], armL: { at: [-0.2, -0.4, 0.6], pole: [-0.6, -0.5, -0.2] } }),
      k(0.27, { ease: 'snap', armR: { at: [0.05, -0.25, 0.92], pole: [0.6, -0.6, -0.2] }, blade: [-0.05, -0.6, 0.8],
        spine: [24, 0, 0], head: [6, 0, 0], hips: [0, -0.1, 0.05] }),
      k(0.36, { ease: 'out', armR: { at: [0.0, -0.6, 0.7], pole: [0.5, -0.7, -0.2] }, blade: [-0.05, -0.9, 0.35], spine: [28, -4, 0], hips: [0, -0.12, 0.06] }),
      k(0.58, { ease: 'out', spine: [24, -4, 0] }),
      k(0.98, { ease: 'inOut', ...GUARD_P }),
    ],
  },
  heavy: {
    hits: [[0.50, 0.63, { dmg: 2.4, poise: 38, hitstop: 0.13, heavy: true }]],
    cancel: 0.85, moveRoot: [[0.36, 0.6, 1.1, 'out']], track: [0, 0.4, 420], stamina: 30, chargeAt: 0.42, chargeMax: 0.7,
    keys: [
      k(0, GUARD_P),
      k(0.42, { ease: 'windup', armR: { at: [0.05, 0.92, -0.06], pole: [0.8, 0.1, -0.5] }, armL: { twoHand: true },
        blade: [0.0, 0.42, -0.9], spine: [-16, 6, 0], head: [-12, 0, 0], hips: [0, 0.02, -0.04] }),
      k(0.53, { ease: 'snap', armR: { at: [0.0, -0.2, 0.95], pole: [0.6, -0.6, -0.2] }, blade: [0.0, -0.55, 0.83],
        spine: [26, 0, 0], head: [8, 0, 0], hips: [0, -0.13, 0.08] }),
      k(0.62, { ease: 'out', armR: { at: [0.0, -0.55, 0.75], pole: [0.5, -0.7, -0.2] }, blade: [0.0, -0.86, 0.5], spine: [32, 0, 0], hips: [0, -0.15, 0.09] }),
      k(0.95, { ease: 'out', spine: [28, 0, 0] }),
      k(1.35, { ease: 'inOut', ...GUARD_P, armL: GUARD_P.armL }),
    ],
  },
  // running attack: out of a sprint, a long lunging thrust that carries the momentum into her legs
  runAttack: {
    hits: [[0.17, 0.36, { dmg: 1.35, poise: 22, hitstop: 0.1 }]],
    cancel: 0.62, moveRoot: [[0.0, 0.17, 1.1, 'linear'], [0.17, 0.42, 2.0, 'out']], track: [0, 0.16, 600], stamina: 20, blendIn: 0.05,
    keys: [
      k(0, GUARD_P),
      k(0.12, { ease: 'windup', armR: { at: [0.32, -0.38, -0.12], pole: [0.7, -0.4, -0.5] }, blade: [0.02, 0.1, 0.99],
        armL: { at: [-0.1, -0.1, 0.62], pole: [-0.6, -0.5, -0.2] }, spine: [-2, 26, 0], head: [0, -16, 0], hips: [0, -0.08, 0],
        legL: { at: [-0.05, -0.9, 0.25], pole: [0, 0, 1] }, legR: { at: [0.07, -0.88, -0.28], pole: [0, 0, 1] } }),
      k(0.22, { ease: 'snap', armR: { at: [0.04, 0.04, 0.99], pole: [0.6, -0.6, -0.3] }, blade: [0.0, 0.14, 0.99],
        armL: { at: [-0.45, -0.5, -0.35], pole: [-0.5, -0.6, 0.3] }, spine: [16, -20, 0], head: [-6, 10, 0], hips: [0, -0.16, 0.12],
        legL: { at: [-0.05, -0.78, 0.55], pole: [0, 0, 1] }, legR: { at: [0.08, -0.8, -0.55], pole: [0, 0, 1] } }),
      k(0.4, { ease: 'out', armR: { at: [0.04, 0.0, 0.97], pole: [0.6, -0.6, -0.3] }, blade: [0.0, 0.08, 1.0], spine: [18, -20, 0], hips: [0, -0.17, 0.13] }),
      k(0.62, { ease: 'out', armR: { at: [0.06, -0.3, 0.8], pole: [0.6, -0.5, -0.3] }, blade: [0.0, 0.05, 1.0], spine: [10, -10, 0], hips: [0, -0.1, 0.06],
        legL: { at: [-0.05, -0.84, 0.35], pole: [0, 0, 1] }, legR: { at: [0.08, -0.86, -0.3], pole: [0, 0, 1] } }),
      k(0.95, { ease: 'inOut', ...GUARD_P, legL: { at: [-0.05, -0.95, 0.05], pole: [0, 0, 1], w: 0 }, legR: { at: [0.08, -0.95, -0.05], pole: [0, 0, 1], w: 0 } }),
    ],
  },
  roll: {
    iframes: [0.05, 0.4], cancel: 0.5, moveRoot: [[0.0, 0.5, 3.6, 'out']], stamina: 18, blendIn: 0.04, blendOut: 0.1,
    keys: [
      k(0, { ...GUARD_P, pivot: { pitch: 0 } }),
      k(0.07, { ease: 'out', pivot: { pitch: 35 }, hips: [0, -0.25, 0.05], spine: [40, 0, 0], head: [30, 0, 0],
        armR: { at: [0.15, -0.35, 0.45], pole: [0.6, -0.6, -0.2] }, armL: { at: [-0.15, -0.35, 0.45], pole: [-0.6, -0.6, -0.2] }, blade: null,
        legL: { at: [-0.05, -0.55, 0.35], pole: [0, 0, 1] }, legR: { at: [0.05, -0.55, 0.35], pole: [0, 0, 1] } }),
      k(0.21, { ease: 'linear', pivot: { pitch: 165 }, legL: { at: [-0.05, -0.32, 0.38], pole: [0, 0, 1] }, legR: { at: [0.05, -0.32, 0.38], pole: [0, 0, 1] } }),
      k(0.36, { ease: 'linear', pivot: { pitch: 300 } }),
      k(0.46, { ease: 'out', pivot: { pitch: 360 }, hips: [0, -0.2, 0.04], spine: [24, 0, 0], head: [12, 0, 0],
        legL: { at: [-0.06, -0.75, 0.15], pole: [0, 0, 1] }, legR: { at: [0.06, -0.75, 0.15], pole: [0, 0, 1] } }),
      k(0.62, { ease: 'inOut', ...GUARD_P, pivot: { pitch: 360 }, legL: { at: [-0.08, -0.98, 0.0], pole: [0, 0, 1], w: 0 }, legR: { at: [0.08, -0.98, 0.0], pole: [0, 0, 1], w: 0 } }),
    ],
  },
  // critical on the kneeling saint: dash in, drive the blade up into her chest, hold, wrench it free, step back
  critical: {
    iframes: [0, 1.6], cancel: 1.45, hitAt: 0.42, moveRoot: [[1.0, 1.3, -1.1, 'out']], blendIn: 0.05, blendOut: 0.2,
    keys: [
      k(0, GUARD_P),
      k(0.22, { ease: 'out', armR: { at: [0.35, -0.25, -0.42], pole: [0.7, -0.4, -0.4] }, blade: [0.05, 0.55, 0.83],
        armL: { at: [-0.25, -0.4, 0.5], pole: [-0.6, -0.5, -0.2] }, spine: [12, 22, 0], head: [-6, -8, 0], hips: [0, -0.16, -0.05] }),
      k(0.4, { ease: 'snap', armR: { at: [0.05, 0.78, 0.7], pole: [0.8, -0.2, -0.4] }, armL: { twoHand: true }, blade: [0.0, 0.72, 0.69],
        spine: [-14, 0, 0], head: [-22, 0, 0], hips: [0, 0.02, 0.06], pivot: { y: 0.05 } }),
      k(0.9, { ease: 'linear', spine: [-16, 0, 0], head: [-24, 0, 0], pivot: { y: 0.04 } }),
      k(1.1, { ease: 'in', armR: { at: [0.25, -0.35, 0.45], pole: [0.7, -0.5, -0.3] }, blade: [0.1, -0.2, 0.97], armL: GUARD_P.armL,
        spine: [16, 10, 0], head: [6, 0, 0], hips: [0, -0.1, -0.06], pivot: { y: 0 } }),
      k(1.6, { ease: 'inOut', ...GUARD_P, pivot: { y: 0 } }),
    ],
  },
  blockHit: {
    cancel: 0.22, moveRoot: [[0.0, 0.16, -0.55, 'out']], blendIn: 0.02, blendOut: 0.12,
    keys: [
      k(0, BLOCK_P),
      k(0.06, { ease: 'out', ...BLOCK_P, spine: [-5, -16, 0], head: [-6, 8, 0], hips: [0, -0.09, -0.08] }),
      k(0.32, { ease: 'inOut', ...BLOCK_P }),
    ],
  },
  hurt: {
    cancel: 0.36, moveRoot: [[0.0, 0.2, -0.45, 'out']], blendIn: 0.03,
    keys: [
      k(0, GUARD_P),
      k(0.07, { ease: 'out', spine: [-16, 10, -6], head: [-20, 6, 0], hips: [0, -0.04, -0.06],
        armR: { at: [0.4, -0.45, 0.2], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.45, -0.4, 0.25], pole: [-0.6, -0.4, -0.4] } }),
      k(0.4, { ease: 'inOut', ...GUARD_P }),
    ],
  },
  knockdown: {
    iframes: [0.25, 1.35], cancel: 1.45, moveRoot: [[0.0, 0.42, -1.8, 'out']], blendIn: 0.03,
    keys: [
      k(0, { ...GUARD_P, pivot: { pitch: 0, y: 0 } }),
      k(0.12, { ease: 'out', pivot: { pitch: -25, y: 0 }, spine: [-25, 0, 0], head: [-25, 0, 0],
        armR: { at: [0.5, -0.1, 0.1], pole: [0.6, -0.4, -0.4] }, armL: { at: [-0.5, -0.1, 0.1], pole: [-0.6, -0.4, -0.4] } }),
      k(0.38, { ease: 'in', pivot: { pitch: -86, y: -0.3 }, spine: [-5, 0, 0], head: [12, 0, 0],
        legL: { at: [-0.1, -0.85, 0.35], pole: [0, 0, 1] }, legR: { at: [0.1, -0.9, 0.2], pole: [0, 0, 1] } }),
      k(0.95, { ease: 'linear', pivot: { pitch: -84, y: -0.3 } }),
      k(1.25, { ease: 'inOut', pivot: { pitch: -15, y: -0.06 }, hips: [0, -0.22, 0.06], spine: [30, 0, 0], head: [10, 0, 0],
        legL: { at: [-0.06, -0.6, 0.35], pole: [0, 0, 1] }, legR: { at: [0.06, -0.7, 0.1], pole: [0, 0, 1] } }),
      k(1.55, { ease: 'inOut', ...GUARD_P, pivot: { pitch: 0, y: 0 }, legL: { at: [-0.08, -0.98, 0.0], w: 0 }, legR: { at: [0.08, -0.98, 0.0], w: 0 } }),
    ],
  },
  heal: {
    cancel: 1.05, healAt: 0.62, speedMul: 0.35,
    keys: [
      k(0, GUARD_P),
      k(0.28, { ease: 'out', armL: { at: [0.32, 0.5, 0.42], pole: [-0.7, -0.6, -0.2] }, gripL: 0.8, head: [-6, 0, 0] }),
      k(0.55, { ease: 'inOut', armL: { at: [0.3, 0.6, 0.36], pole: [-0.7, -0.6, -0.2] }, head: [-22, 0, 0] }),
      k(0.8, { ease: 'linear', head: [-20, 0, 0] }),
      k(1.1, { ease: 'inOut', ...GUARD_P, gripL: 0 }),
    ],
  },
};

// ---------------------------------------------------------------------------------------------- boss

const B_GUARD = {
  armR: { at: [0.16, -0.8, 0.45], pole: [0.6, -0.4, -0.4] },
  armL: { at: [-0.12, -0.86, 0.3], pole: [-0.6, -0.4, -0.4] },
  blade: [0.06, -0.5, 0.86], grip: 1, spine: [4, 0, 0], head: [6, 0, 0], hips: [0, 0, 0],
};
export const B_HOLD = { armR: { ...B_GUARD.armR, w: 0.85 }, blade: B_GUARD.blade, grip: 1 };

// kneeling in prayer (sitting back on the heels, hands joined before the chest, head bowed)
// kneeling upright in prayer: thighs straight down (the robe is skinned to them, so it keeps hanging instead of jutting
// out), shins flat on the floor behind (the soles show under the hem instead of piercing the robe in mid-air),
// hands together well in front of the chest (clear of the hood)
export const B_KNEEL = {
  hips: [0, -0.5, 0.0], spine: [12, 0, 0], head: [24, 0, 0],
  legL: { at: [-0.08, -0.52, -0.46], pole: [0, -0.3, 1] }, legR: { at: [0.08, -0.52, -0.46], pole: [0, -0.3, 1] },
  armR: { at: [-0.3, -0.3, 0.52], pole: [0.7, -0.6, -0.3], hand: [-0.2, 1, 0.35] },
  armL: { at: [0.3, -0.3, 0.52], pole: [-0.7, -0.6, -0.3], hand: [0.2, 1, 0.35] },
  grip: 0, blade: null,
};
// one knee down, the other foot planted forward (rising / staggered)
const B_GENUFLECT = {
  hips: [0, -0.15, 0.04], spine: [18, 0, 0], head: [14, 0, 0],
  legL: { at: [-0.08, -0.84, -0.05], pole: [0, -0.2, 1] }, legR: { at: [0.08, -0.84, 0.03], pole: [0, -0.2, 1] },
};

export const BOSS = {
  guard: B_GUARD,
  kneel: B_KNEEL,
  slam: {
    hits: [[1.38, 1.56, { dmg: 34, kind: 'slam' }]], impactAt: 1.52, holdAt: 1.0, holdMax: 0.7, glintAt: 0.98, chainAt: 2.0,
    track: [0, 1.25, 75], moveRoot: [[1.3, 1.5, 1.2, 'out']],
    keys: [
      k(0, B_GUARD),
      k(0.75, { ease: 'windup', armR: { at: [0.08, 0.95, -0.1], pole: [0.7, 0.0, -0.6] }, armL: { twoHand: true },
        blade: [0.0, 0.42, -0.9], spine: [-16, 0, 0], head: [-12, 0, 0], hips: [0, 0.03, -0.03] }),
      k(1.0, { ease: 'linear', spine: [-19, 0, 0], blade: [0.0, 0.5, -0.86] }),
      k(1.47, { ease: 'snap', armR: { at: [0.0, -0.35, 0.85], pole: [0.6, -0.6, -0.2] }, blade: [0.0, -0.55, 0.83],
        spine: [30, 0, 0], head: [10, 0, 0], hips: [0, -0.14, 0.06] }),
      k(1.56, { ease: 'out', armR: { at: [0.0, -0.5, 0.75], pole: [0.6, -0.6, -0.2] }, blade: [0.0, -0.74, 0.67], spine: [33, 0, 0], hips: [0, -0.16, 0.07] }),
      k(2.35, { ease: 'linear', spine: [31, 0, 0] }),
      k(3.0, { ease: 'inOut', ...B_GUARD, armL: B_GUARD.armL }),
    ],
  },
  // a giant fighting someone a third her size swings low: an explicit arc through right-front, front, left-front,
  // with the tip about 4.6 m out and 1.3 m up as it crosses her front (linear between those keys)
  sweep: {
    hits: [[0.64, 0.92, { dmg: 26, kind: 'sweep' }], [1.32, 1.6, { dmg: 26, kind: 'sweep' }]], glintAt: 0.5, chainAt: 1.85,
    track: [0, 0.58, 90], moveRoot: [[0.62, 0.9, 0.8, 'out'], [1.3, 1.55, 0.6, 'out']],
    keys: [
      k(0, B_GUARD),
      k(0.56, { ease: 'windup', armR: { at: [0.8, -0.45, -0.2], pole: [0.3, -0.8, -0.4] }, blade: [0.82, -0.35, -0.45],
        spine: [12, 38, 0], head: [6, -10, 0], hips: [0, -0.1, 0] }),
      k(0.68, { ease: 'in', armR: { at: [0.45, -0.55, 0.7], pole: [0.4, -0.8, -0.2] }, blade: [0.55, -0.4, 0.73], spine: [16, 18, 0], head: [8, -4, 0] }),
      k(0.76, { ease: 'linear', armR: { at: [0.0, -0.6, 0.8], pole: [0.4, -0.8, -0.2] }, blade: [-0.08, -0.45, 0.89], spine: [20, 0, 0], head: [10, 0, 0], hips: [0, -0.12, 0.04] }),
      k(0.84, { ease: 'linear', armR: { at: [-0.45, -0.55, 0.65], pole: [0.3, -0.85, 0.0] }, blade: [-0.62, -0.42, 0.66], spine: [20, -20, 0] }),
      k(0.96, { ease: 'out', armR: { at: [-0.75, -0.5, 0.3], pole: [0.2, -0.9, 0.1] }, blade: [-0.85, -0.38, -0.35], spine: [18, -42, 0], head: [8, 12, 0] }),
      k(1.24, { ease: 'inOut', armR: { at: [-0.72, -0.48, 0.26], pole: [0.2, -0.9, 0.1] }, blade: [-0.82, -0.36, -0.42], spine: [16, -44, 0] }),
      k(1.36, { ease: 'in', armR: { at: [-0.4, -0.55, 0.7], pole: [0.3, -0.85, 0.0] }, blade: [-0.55, -0.42, 0.72], spine: [18, -20, 0] }),
      k(1.44, { ease: 'linear', armR: { at: [0.05, -0.6, 0.8], pole: [0.4, -0.8, -0.2] }, blade: [0.08, -0.45, 0.89], spine: [20, 0, 0], head: [10, 0, 0] }),
      k(1.52, { ease: 'linear', armR: { at: [0.45, -0.55, 0.65], pole: [0.4, -0.8, -0.3] }, blade: [0.62, -0.42, 0.66], spine: [18, 20, 0] }),
      k(1.64, { ease: 'out', armR: { at: [0.8, -0.5, 0.25], pole: [0.4, -0.7, -0.4] }, blade: [0.85, -0.38, -0.35], spine: [14, 36, 0], head: [6, -10, 0] }),
      k(2.3, { ease: 'inOut', ...B_GUARD }),
    ],
  },
  thrust: {
    hits: [[0.92, 1.22, { dmg: 30, kind: 'thrust' }]], glintAt: 0.66, chainAt: 1.5,
    track: [0, 0.82, 110], moveRoot: [[0.86, 1.18, 7.5, 'out']],
    keys: [
      k(0, B_GUARD),
      k(0.72, { ease: 'windup', armR: { at: [0.36, -0.3, -0.45], pole: [0.6, -0.6, -0.4] }, blade: [0.04, -0.5, 0.86],
        spine: [-2, 28, 0], head: [4, -14, 0], hips: [0, -0.1, -0.1], armL: { at: [-0.35, -0.4, 0.6], pole: [-0.6, -0.5, -0.3] } }),
      k(1.0, { ease: 'snap', armR: { at: [0.04, -0.42, 1.0], pole: [0.6, -0.7, -0.2] }, blade: [0.0, -0.6, 0.8],
        spine: [24, -6, 0], head: [12, 0, 0], hips: [0, -0.16, 0.12], armL: { at: [-0.4, -0.5, -0.2], pole: [-0.6, -0.5, -0.3] } }),
      k(1.45, { ease: 'linear', spine: [22, -4, 0] }),
      k(2.35, { ease: 'inOut', ...B_GUARD }),
    ],
  },
  volley: {
    fireTimes: [1.0, 1.32, 1.64, 1.96, 2.28, 2.6, 2.92], track: [0, 3.2, 60],
    keys: [
      k(0, B_GUARD),
      k(0.6, { ease: 'inOut', armL: { at: [-0.12, 1.0, 0.28], pole: [-0.8, 0.0, -0.5], hand: [0, 1, 0.4] }, head: [-22, 0, 0], spine: [-8, 0, 0] }),
      k(3.1, { ease: 'linear', head: [-18, 0, 0] }),
      k(3.6, { ease: 'inOut', ...B_GUARD }),
    ],
  },
  pray: {
    pillarTimes: [1.35, 2.35, 3.35], track: [0, 0.3, 40],
    keys: [
      k(0, B_GUARD),
      k(0.9, { ease: 'inOut', ...B_KNEEL }),
      k(3.9, { ease: 'linear', ...B_KNEEL, head: [30, 0, 0] }),
      k(4.6, { ease: 'inOut', ...B_GENUFLECT, armR: B_GUARD.armR, armL: B_GUARD.armL, blade: B_GUARD.blade, grip: 1 }),
      k(5.3, { ease: 'inOut', ...B_GUARD, legL: { ...B_GENUFLECT.legL, w: 0 }, legR: { ...B_GENUFLECT.legR, w: 0 } }),
    ],
  },
  stagger: {
    keys: [
      k(0, B_GUARD),
      k(0.3, { ease: 'out', hips: B_KNEEL.hips, legL: B_KNEEL.legL, legR: B_KNEEL.legR, spine: [30, 0, 10], head: [22, 0, 0],
        armR: { at: [0.24, -0.78, 0.32], pole: [0.6, -0.4, -0.4] }, blade: [0.1, -0.86, 0.5], armL: { at: [-0.2, -0.6, 0.5], pole: [-0.6, -0.5, -0.3] } }),
      k(2.2, { ease: 'linear', spine: [27, 0, 8] }),
      k(2.5, { ease: 'inOut', ...B_GENUFLECT, armR: { at: [0.2, -0.8, 0.35], pole: [0.6, -0.4, -0.4] }, blade: [0.1, -0.7, 0.7] }),
      k(2.8, { ease: 'inOut', ...B_GUARD, legL: { ...B_GENUFLECT.legL, w: 0 }, legR: { ...B_GENUFLECT.legR, w: 0 } }),
    ],
  },
  hurt: {
    keys: [
      k(0, B_GUARD),
      k(0.08, { ease: 'out', spine: [-6, 8, -4], head: [-10, 4, 0] }),
      k(0.4, { ease: 'inOut', ...B_GUARD }),
    ],
  },
  // intro: kneeling in prayer, then the long rise (cutscene drives the timing)
  rise: {
    keys: [
      k(0, B_KNEEL),
      k(1.6, { ease: 'linear', ...B_KNEEL, head: [30, 0, 0] }),
      k(2.2, { ease: 'inOut', ...B_KNEEL, head: [18, -12, 0], spine: [12, -6, 0] }),
      k(4.4, { ease: 'inOut', ...B_GENUFLECT, armR: { at: [0.2, -0.6, 0.35], pole: [0.6, -0.5, -0.3] }, armL: { at: [-0.25, -0.55, 0.5], pole: [-0.6, -0.5, -0.3] }, grip: 0 }),
      k(6.6, { ease: 'inOut', ...B_GUARD, hips: [0, 0, 0], spine: [-4, 0, 0], head: [-6, 0, 0], legL: { ...B_GENUFLECT.legL, w: 0 }, legR: { ...B_GENUFLECT.legR, w: 0 }, armR: { at: [0.1, -0.85, 0.2], pole: [0.6, -0.4, -0.4] }, blade: null, grip: 0 }),
    ],
  },
  // reach over the right shoulder, pull the first sword out of her own back
  draw: {
    drawAt: 0.95,
    keys: [
      k(0, { armR: { at: [0.1, -0.85, 0.2], pole: [0.6, -0.4, -0.4] }, blade: null, grip: 0 }),
      k(0.8, { ease: 'inOut', armR: { at: [0.05, 0.62, -0.42], pole: [0.8, 0.4, 0.2], hand: [0, -0.3, -1] }, head: [0, 20, 0], spine: [-6, 14, 0], grip: 0.6 }),
      k(1.05, { ease: 'linear', grip: 1 }),
      k(1.9, { ease: 'inOut', armR: { at: [0.5, 0.75, 0.12], pole: [0.8, -0.2, -0.3] }, blade: [0.3, 0.9, 0.2], head: [-8, 0, 0], spine: [-8, 6, 0] }),
      k(2.8, { ease: 'inOut', ...B_GUARD }),
    ],
  },
};

export function buildTracks(lib) {
  for (const [name, mv] of Object.entries(lib)) {
    if (mv && mv.keys) mv.track_ = new PoseTrack(mv.keys, { name });
  }
  return lib;
}
buildTracks(HEROINE);
buildTracks(BOSS);
