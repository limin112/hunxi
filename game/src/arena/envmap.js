// Image-based lighting for PBR characters / armour: a crude proxy of the nave (dark stone, the
// bright rose window at -Z, warm candle bands, a cold sky hole) prefiltered with PMREM.
// One map per mood (cold night, gold phase two, warm dawn); the arena swaps them by phase.
import * as THREE from 'three';

function buildEnvScene({ window: [wr, wg, wb], windowI, walls, candles, sky, side }) {
  const s = new THREE.Scene();
  const basic = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), side: THREE.BackSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 50, 110), basic(walls));
  room.position.set(0, 20, 0);
  s.add(room);
  const front = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), side: THREE.DoubleSide });
  const rose = new THREE.Mesh(new THREE.CircleGeometry(8.5, 48), front([wr * windowI, wg * windowI, wb * windowI]));
  rose.position.set(0, 20, -49);
  s.add(rose);
  // a softer glow ring around the window (scattering)
  const glow = new THREE.Mesh(new THREE.RingGeometry(8.5, 15, 48), front([wr * windowI * 0.08, wg * windowI * 0.08, wb * windowI * 0.08]));
  glow.position.set(0, 20, -48.9);
  s.add(glow);
  // floor: dark water reflecting a little window light
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 110), front(walls.map((v) => v * 0.6)));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.9;
  s.add(floor);
  // candle bands along both sides and on the altar steps
  for (const x of [-12, 12]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 70), front(candles));
    band.position.set(x, 0.5, 0);
    s.add(band);
  }
  const altar = new THREE.Mesh(new THREE.BoxGeometry(24, 2.5, 3), front(candles.map((v) => v * 1.4)));
  altar.position.set(0, 1.2, -40);
  s.add(altar);
  // moonlit lancets high on both side walls (cold rim light on armour)
  for (const x of [-29.8, 29.8]) {
    for (let z = -40; z <= 40; z += 8) {
      const lw = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 7), front(side));
      lw.position.set(x, 24, z);
      lw.rotation.y = Math.PI / 2;
      s.add(lw);
    }
  }
  // broken vault: patches of sky
  for (const [x, z] of [[-4.5, 9], [5, -13], [-2, 31]]) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(5, 24), front(sky));
    hole.rotation.x = Math.PI / 2;
    hole.position.set(x, 44.9, z);
    s.add(hole);
  }
  return s;
}

export function buildEnvironmentMaps(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const moods = {
    cold: { window: [0.8, 0.88, 1.0], windowI: 3.2, walls: [0.006, 0.011, 0.02], candles: [1.0, 0.55, 0.2], sky: [0.06, 0.1, 0.18], side: [0.1, 0.17, 0.32] },
    gold: { window: [1.0, 0.82, 0.48], windowI: 4.5, walls: [0.012, 0.012, 0.016], candles: [1.4, 0.75, 0.28], sky: [0.05, 0.07, 0.11], side: [0.06, 0.09, 0.16] },
    dawn: { window: [1.0, 0.8, 0.58], windowI: 5.0, walls: [0.05, 0.04, 0.034], candles: [0.8, 0.42, 0.16], sky: [0.9, 0.58, 0.38], side: [0.5, 0.35, 0.25] },
  };
  const maps = {};
  for (const [k, mood] of Object.entries(moods)) {
    const scene = buildEnvScene(mood);
    maps[k] = pmrem.fromScene(scene, 0.035, 0.1, 200, { size: 256, position: new THREE.Vector3(0, 3, -6) }).texture;
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  pmrem.dispose();
  return maps;
}
