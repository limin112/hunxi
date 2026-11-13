// Cold moonlight slanting through the left clerestory lancets: one faint, soft shaft per lancet
// (camera-facing axial billboards, additive). The matching light patches come from the moon
// DirectionalLight, masked to the lancet projections in materials.js (arenaMoonMask).
import * as THREE from 'three';
import { NAVE } from './architecture.js';
import { MOON_DIR_ARR } from './materials.js';

export const MOON_DIR = new THREE.Vector3(...MOON_DIR_ARR);

export function createMoonShafts({ noise, floorY = 0.06, clerestory }) {
  const lancets = clerestory.filter((l) => Math.abs(l.zc) < 44);
  const n = lancets.length;
  const quad = new THREE.PlaneGeometry(1, 1, 1, 10);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const iStart = new Float32Array(n * 3), iShape = new Float32Array(n * 4);
  lancets.forEach((l, i) => {
    const y = l.sill + (l.straight + l.rise) * 0.45;
    const start = [-NAVE.pillarX + 0.1, y, l.zc];
    const len = (y - floorY) / -MOON_DIR.y;
    iStart.set(start, i * 3);
    iShape.set([len, l.hw * 0.95, l.hw * 1.35, 0.75 + ((i * 7919) % 13) / 26], i * 4);
  });
  geo.setAttribute('iStart', new THREE.InstancedBufferAttribute(iStart, 3));
  geo.setAttribute('iShape', new THREE.InstancedBufferAttribute(iShape, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    name: 'moon-shafts',
    uniforms: {
      uNoise: { value: noise },
      uTime: { value: 0 },
      uIntensity: { value: 0.01 },
      uColor: { value: new THREE.Color(0.42, 0.6, 0.95) },
      uDir: { value: MOON_DIR.clone() },
      uFloorY: { value: floorY },
    },
    vertexShader: /* glsl */`
      attribute vec3 iStart; attribute vec4 iShape;
      uniform vec3 uDir;
      varying float vS; varying float vT; varying float vI; varying float vLen; varying vec3 vWorld;
      void main() {
        float s = position.y + 0.5;
        vec3 P = iStart + uDir * (s * iShape.x);
        vec3 side = cross(uDir, cameraPosition - P);
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(0.0, 0.0, 1.0);
        P += side * position.x * 2.0 * mix(iShape.y, iShape.z, s);
        vS = s; vT = position.x * 2.0; vI = iShape.w; vLen = iShape.x; vWorld = P;
        gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime; uniform float uIntensity; uniform vec3 uColor; uniform float uFloorY;
      varying float vS; varying float vT; varying float vI; varying float vLen; varying vec3 vWorld;
      void main() {
        float across = smoothstep(1.0, 0.45, abs(vT));
        float along = smoothstep(0.0, 0.12, vS) * (1.0 - smoothstep(0.8, 1.0, vS));
        float n = texture(uNoise, vec2(vT * 0.3 + vWorld.z * 0.05, vS * vLen * 0.02 - uTime * 0.006)).g;
        float a = across * along * (0.55 + 0.9 * n) * vI;
        a *= smoothstep(uFloorY, uFloorY + 1.2, vWorld.y);
        a *= smoothstep(2.0, 10.0, distance(cameraPosition, vWorld));
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'moon-shafts';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return {
    mesh,
    update(time, intensity) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uIntensity.value = intensity;
      mesh.visible = intensity > 1e-4;
    },
  };
}
