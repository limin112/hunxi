# 《火焰山 · 牛魔》架构契约

总导演定稿。所有模块按这里的接口和文件归属来写。玩法见 `docs/niumo_design.md`，美术见 `docs/niumo_style.md`。

新场景和圣堂游戏同在 `game/` 工程里，入口是 `game/niumo.html`。浏览器 ES 模块，无构建，Three.js 0.187（import map 与 `game/index.html` 相同）。坐标：米，+y 向上。

## 文件归属（只许改自己的文件）

| 负责方 | 拥有的文件 |
|---|---|
| 美术 / 3D | `prompts/niumo_d_*`、`concept/niumo_d_*`、`out/tripo/niumo_*`、`game/assets/models/niumo_*.glb`、`game/assets/textures/niumo_*`、`tools/build_niumo_assets.sh` |
| 场景 | `game/src/niumo/arena.js`、`game/src/niumo/arena/*`、`game/test/niumo_arena.html` |
| 音频 | `game/src/audio/*`、`game/src/audio.js`、`game/test/audio_check.mjs`（只做增量：新增音乐状态和音效，圣堂的全部保持不变） |
| 主角 | `game/src/niumo/monkey.js`、`game/src/niumo/moves_monkey.js`、`game/src/niumo/input.js`、`game/src/niumo/camera.js` |
| 牛魔王 | `game/src/niumo/bull.js`、`game/src/niumo/moves_bull.js` |
| 主程序 / 过场 | `game/niumo.html`、`game/src/niumo/main.js`、`game/src/niumo/ui.js`、`game/src/niumo/mv.js`、`game/src/niumo/cutscenes.js`、`game/test/niumo_smoke.mjs` |

共享引擎只读，可以 import，不许修改（音频负责方对 `src/audio*` 的增量修改除外）：`game/src/{actor,pose,look,fx,camera,input,ui,combat,assets,player,boss,cutscene,mv,main,arena}.js`、`game/src/arena/*`、`game/index.html`。圣堂游戏必须一直能跑：`cd game && node test/smoke.mjs fullfight` 通过。

## 可复用的引擎

- `src/assets.js`：`loadGLTF(url)`、`loadCharacter(url, {height, inPlace, cleanArms})` 返回 `{root, pivot, model, mesh, skeleton, bones, clips, height, scale}`（Tripo 模型朝 +X，已在加载时转正、身高归一）、`loadBlade(url, {length, gripFrac})`、`loadTexture(url, {srgb, repeat})`。
- `src/actor.js`：`new Actor(char, {lib, hold, sword, scene})`，`playBase(name, {fade, timeScale})`、`startMove(name, {speed})`、`stopMove()`、`update(dt)`、`jolt(dir, bend, shiver)`、`bonePos(name, out)`、`rig`（`R/U/F` 角色坐标轴）、`bladeBase/bladeTip/prevBase/prevTip`。
- `src/pose.js` + `src/moves.js` 的格式：招式是关键帧姿势（`k(t, {armR:{at,pole}, armL, legL, legR, blade, spine, head, hips, pivot})`，向量为角色空间 `[右, 上, 前]`，手臂目标以肩为原点、以臂长为单位）。新招式照这个格式写在各自的 moves 文件里。
- `src/look.js`：`applyLook(root, preset)`、`updateLooks(camera)`。要新预设就在自己的模块里调用前先往 `LOOK_PRESETS` 加一项（运行时追加，不改 look.js）。
- `src/fx.js`：`new FX(scene, {arena})`，`light`、`hitSpark`、`bloodHit`、`splash`、`dust`、`motes`、`glint`、`shockwave`、`warnRing`、`pillar`、`flashMesh`、`trail(opts)`、`update(dt)`。
- `src/combat.js`：`sweepBlade(prevBase, prevTip, base, tip, capsules, radius)`、`horizDist`、`angleTo`、`separate`、`clampToArena`。
- `src/camera.js`：`CameraRig`（`addTrauma`、`punch`、`zoomPunch`、碰撞 `blockers/bodies`）。
- `src/ui.js`：`UI`（血条、体力、boss 条、标题卡、字幕、提示）。`niumo.html` 需提供它用到的 DOM（照 `index.html`）。
- `src/audio.js`：`AudioSystem`（`unlock`、`setMusic`、`play`、`setListener`、`duck`、`setMuffle`、`setVolumes`、`update`）。

## 1. 场景 `src/niumo/arena.js`

```js
export async function createVolcanoArena({ scene, renderer, quality = 'high' }) -> {
  bounds: { minX, maxX, minZ, maxZ },      // 可走区域
  playerSpawn: { x, z, yaw },              // 约 z = +40，面向 -z
  bullSeat: { x, z, yaw },                 // 约 z = -30，牛魔王盘坐的位置，面向 +z
  groundY(x, z),                           // 可走地面高度（大部分为 0）
  lavaAt(x, z),                            // 0..1，熔岩危险程度（>0.5 会伤人）
  colliders: [{ x, z, r }],                // 石碑、石柱等圆形碰撞体
  cameraBlockers: { circles: [{ x, z, r }], bounds },
  update(dt, time, camera),
  setPhase(p),                             // 0 进场 1 一阶段 2 山崩喷发 3 结局下雨
  eruption(x, z, strength),                // 局部喷发特效（熔岩溅射、亮光）
  shake(k),                                // 场景层面的震动（落石、灰尘）
  gradeHints,                              // 当前阶段给主程序的调色建议 { exposure, warm, fog }
  group,
}
```

规模：牛魔王盘坐身高约 22 米，站起约 40 米；战场以他身前为中心，半径约 40 米可走。按美术圣经做：暗色结壳的熔岩河、玄武岩、断碑、牌坊、骸骨与兵器、飘落的火灰、热浪扭曲、远山与暗红的天。

## 2. 牛魔王 `src/niumo/bull.js`

```js
export class BullKing {
  constructor({ char, scene, fx, audio, arena, cam, staff })
  pos, yaw, hp, maxHp, phase /* 1 盘坐 2 站起 */, dead, state, events /* [{type, ...}] */
  update(dt, player)
  hurtZones()      // [{ part: 'handL'|'handR'|'kneeL'|'kneeR'|'head'|'body', a: Vector3, b: Vector3, r }]
  lockTargets()    // [{ part, pos: Vector3 }]，给镜头和自动锁定
  takeHit({ dmg, poise, point, dir, heavy, from, part })
  criticalOpen(player)                 // 低头可处决时为 true
  takeCritical({ dmg, from })
}
```

- 招式与弱点按 `docs/niumo_design.md`：一阶段盘坐（横扫、砸棍、拍掌、吐火、抓），二阶段站起（踏地、角扫、火雨、掷棍）。
- 每招都有清楚的预兆（光、声、地面提示）；打玩家用 `player.takeHit({ dmg, from, kind, blockable })`。
- 弱点：双手背、双膝的熔岩裂口各有血量，打碎两个他就俯身低头，`criticalOpen` 为 true，执行「牵牛鼻子」处决。
- 事件：`damage`、`stagger`、`phase2`（开始山崩过场）、`dead`、`critical`。

## 3. 主角 `src/niumo/monkey.js` + `input.js` + `camera.js`

```js
export class NiumoInput extends Input { }     // 键位：WASD 移动，空格点按翻滚/按住奔跑，J 轻击，K 重击（按住蓄力），L 格挡（按住，准时弹反），I 芭蕉扇
export class Monkey {
  constructor({ actor, fx, audio, cam, input, arena, staff })
  pos, yaw, hp, st, mp /* 法力，芭蕉扇消耗 */, dead, state, events
  update(dt, boss)
  takeHit({ dmg, from, kind, blockable })     // 返回 true | 'block' | 'parry' | false
  reset(spawn)
}
export class AutoCam { /* 只用键盘：自动框住猴子和牛魔王正在出招的部位，大招自动拉远，碰撞场景；addTrauma/punch/zoomPunch 同 CameraRig */ }
```

猴子身高 1.5 米，武器是金箍棒（`staff` 为一个 Object3D，沿 +Y 从握把到棍头）。棍法：三段轻击、蓄力重击、格挡弹反、翻滚无敌帧；芭蕉扇是向前的扇形风：扇灭地上的火、吹回吐火、让弱点短暂失衡。

## 4. 音频

新增音乐状态：`niumo_opening`（约 50 秒一次性，与开场 MV 分镜对齐）、`niumo_phase1`（循环）、`niumo_phase2`（循环，与一阶段无缝衔接）、`niumo_ending`（雨声和拨弦）。
新增音效：`staff_swing`、`staff_hit`、`staff_hit_heavy`、`bull_roar`、`bull_stomp`、`bull_slam`、`fire_breath`、`fan_wind`、`lava_burst`、`rock_crack`、`rain`。
接口不变：`audio.setMusic(state)`、`audio.play(name, { pos, volume, pitch })`。风格见美术圣经「音乐与声音」。

## 5. 主程序 `niumo.html` + `src/niumo/main.js`

- 流程：splash（点击开始）→ mv（开场 MV）→ title → approach（走进火山口）→ wake（他睁眼的短过场）→ fight → transition（山崩过场）→ fight 二阶段 → ending（下雨）；死亡 → 重来。
- 后处理与圣堂一致：bloom、调色（读 `arena.gradeHints`）、ACES、FXAA；过场开景深。
- 调试：`window.__niumo`，参数 `?skipmv`、`?skipintro`、`?god`、`?debug`、`?autostart`。
- 模型缺失时自动用占位，不能报错：`assets/models/niumo_bull.glb` 缺 → 用 `boss_p2.glb` 压暗、放大到约 40 米；`niumo_monkey.glb` 缺 → 用 `heroine.glb`（1.5 米）；`niumo_staff.glb` 缺 → 程序生成的铁棒。

## 6. 测试

- `game/test/niumo_smoke.mjs` 场景：boot（无控制台错误或警告、真实场景已加载）、mv（播到标题）、fight（打中弱点、他的招式能命中）、phase2、ending。
- 测试一律用 `startServer(0)` 起随机端口，不要碰 5173（用户的服务器在用）。用 `tools/render/node_modules/puppeteer-core` 和 `/Applications/Google Chrome.app`，参数 `--use-angle=metal`。
- 截图放 `game/test/out/niumo/`。
