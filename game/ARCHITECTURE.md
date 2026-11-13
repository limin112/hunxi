# 长夜圣堂 · Boss fight prototype (Three.js)

Browser game, no build step. `node serve.mjs` then open http://127.0.0.1:5173/.
Three.js 0.187 is vendored in `node_modules/three` and loaded through the import map in `index.html`:

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
```

## World conventions (all modules)

- Units are meters, +Y is up. The nave runs along Z.
- Player (female warrior) is **1.70 m** tall. Boss is **5.10 m** (3x).
- Player spawns at the entrance end, `z = +38`, facing **-Z** (toward the altar).
- Boss kneels at `z = -22`, facing **-Z** (her back to the player), in front of the altar and the rose window (rose window around `z = -50`, center height ~20 m).
- Walkable fight area is roughly `x ∈ [-11, 11]`, `z ∈ [-36, 44]` (the arena reports the exact numbers).
- Floor at `y = 0`, a still sheet of ankle-deep water at `y ≈ 0.06`.
- `yaw` = rotation about +Y in radians; `yaw = Math.PI` faces -Z.

## Modules

| file | owner | role |
|---|---|---|
| `src/main.js` | core | bootstrap, renderer, post-processing, game state machine, loop |
| `src/input.js` | core | keyboard / mouse (pointer lock) / gamepad |
| `src/camera.js` | core | third-person camera + **lock-on** |
| `src/player.js` | core | heroine controller (move, sprint, roll, attacks, heal, stamina) |
| `src/boss.js` | core | boss AI, attacks, phases, seven swords |
| `src/combat.js` | core | hitboxes, damage, i-frames, hitstop, poise |
| `src/fx.js` | core | particles, trails, shockwaves, screen shake, flashes |
| `src/pose.js` | core | procedural posing (aim-based) on Mixamo skeletons |
| `src/actor.js` | core | one rigged character: base clips, procedural moves, overlays, blade, `jolt()` hit reaction (shiver in hitstop, then recoil) |
| `src/look.js` | core | fighter materials: metal by colour, rim, key light, wet legs, `flash` / `dissolve` / `glow` |
| `src/ui.js` | core | HUD, boss bar, reticle, title cards |
| `src/cutscene.js` | core | intro (kneel → rise), skippable |
| `src/audio.js` | audio | procedural music + SFX (Web Audio) — contract below |
| `src/arena.js` | arena | cathedral environment — contract below |

### `src/audio.js` contract

```js
export class AudioSystem {
  constructor(opts?)
  async unlock()              // call from the first user gesture; creates the AudioContext
  get ready()                 // boolean
  setMusic(state, { fade = 2 } = {})   // 'off' | 'hymn' | 'tension' | 'phase1' | 'phase2' | 'finale' | 'victory' | 'defeat'
  play(name, { volume = 1, pitch = 1, pos = null, delay = 0 } = {})   // one-shot SFX; pos = {x,y,z} world position or null (2D)
  setListener({ position, forward })   // plain {x,y,z} objects, called every frame
  duck(amount = 0.5, seconds = 1)      // briefly lower the music bus
  setMuffle(k)                         // 0..1 lowpass on the music (low health, slow motion)
  setVolumes({ master, music, sfx })
  update(dt)
}
```

SFX names: `swing_light, swing_heavy, hit_flesh, hit_heavy, player_hurt, roll, step_water, boss_step, boss_swing, boss_slam, sword_glint, sword_fly, sword_impact, pillar_charge, pillar_blast, heal, lockon, ui, wax_crack, sword_draw, phase_shift, stagger, boss_death, player_death, bell, block, parry, critical, heartbeat`.
If `assets/audio/<state>.mp3` exists (e.g. `phase1.mp3`), it replaces the synthesized music for that state.

### `src/arena.js` contract

```js
export async function createArena({ scene, renderer, textures, quality = 'high' })
// textures: { roseWindow, stoneFloor, stoneWall } — THREE.Texture or null (fallback: procedural)
// returns:
{
  bounds: { minX, maxX, minZ, maxZ },  // walkable rectangle
  colliders: [{ x, z, r }],            // round obstacles inside the bounds (may be empty)
  floorY: 0, waterY,
  playerSpawn: { x, z, yaw }, bossSpawn: { x, z, yaw },
  roseWindow: { center: THREE.Vector3, radius },
  keyLight,                            // shadow-casting DirectionalLight covering the fight area
  waxKnightSlots: [{ x, z, yaw }],     // kneeling wax-knight positions along the aisle, facing the altar
  update(dt, elapsed, camera),
  setPhase(p),                         // 0 pre-fight, 1 fight, 2 phase two (brighter, warmer), 3 victory (dawn)
  ripple(x, z, strength = 1),          // expanding ripple on the water
  dispose(),
}
```

## Assets

- `assets/models/heroine.glb`, `boss_p1.glb` (aged), `boss_p2.glb` (pristine), `boss_sword.glb`, `player_sword.glb`, `knight.glb` (wax knights) — Tripo3D, Mixamo-spec skeletons, model faces **+X** in the file (rotated at load).
- `assets/textures/rose_window.png`, `stone_floor.png`, `stone_wall.png` — Codex image.

## Testing

Headless Chrome via `../tools/render/node_modules/puppeteer-core` with
`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`.
Test pages and scripts live in `test/`.
