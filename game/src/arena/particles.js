// Dust motes (bright only where they drift through the rose-window beam: each mote is
// back-projected onto the window and looks up the glass transmission) and slowly falling ash.
// All motion happens in the vertex shader; no per-frame CPU work.
import * as THREE from 'three';
import { rng } from './util.js';

const COMMON_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform float uSpeed;
uniform vec3 uC; uniform float uR; uniform vec3 uD;
uniform sampler2D uTrans;
uniform float uViewportH;
uniform float uSize;
varying float vBright;
varying float vAlpha;
varying vec3 vTr;
float beamAt(vec3 p, out vec3 tr) {
  float tw = (p.z - uC.z) / uD.z;
  vec2 w = p.xy - uD.xy * tw;
  vec2 uv = (w - uC.xy) / (2.0 * uR) + 0.5;
  tr = vec3(0.0);
  if (tw <= 0.0 || uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return 0.0;
  vec4 t = textureLod(uTrans, uv, 2.0);
  tr = t.rgb / max(t.a, 0.05);
  return t.a;
}
void finishPoint(vec3 p, float worldSize) {
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float px = worldSize * projectionMatrix[1][1] * 0.5 * uViewportH / max(-mv.z, 0.05);
  float clamped = clamp(px, 1.5, 9.0);
  vAlpha = clamp((px * px) / (clamped * clamped), 0.0, 1.0) * smoothstep(0.3, 1.2, -mv.z);
  gl_PointSize = clamped;
  gl_Position = projectionMatrix * mv;
}
`;

export function createParticles({ beam, floorY = 0, quality = 'high', seed = 31 }) {
  const r = rng(seed);
  const group = new THREE.Group();
  group.name = 'particles';
  const { center, radius, dir, tMax } = beam;
  const d = dir.clone().normalize();
  const nDust = quality === 'low' ? 1400 : quality === 'medium' ? 2400 : 3600;
  const nAsh = quality === 'low' ? 300 : quality === 'medium' ? 500 : 800;

  const uniformsBase = () => ({
    uTime: { value: 0 },
    uSpeed: { value: 1 },
    uC: { value: center.clone() },
    uR: { value: radius },
    uD: { value: d.clone() },
    uTrans: { value: beam.transmission },
    uViewportH: { value: 1080 },
    uSize: { value: 0.012 },
    uIntensity: { value: 1 },
    uTint: { value: new THREE.Color(1, 0.95, 0.85) },
  });

  // --- dust motes ---------------------------------------------------------------------------------
  const dPos = new Float32Array(nDust * 3), dSeed = new Float32Array(nDust * 4);
  for (let i = 0; i < nDust; i++) {
    let x, y, z;
    if (i < nDust * 0.65) {
      do {
        const t = Math.pow(r(), 0.8) * tMax;
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * radius * 1.05;
        x = center.x + Math.cos(a) * rr + d.x * t;
        y = center.y + Math.sin(a) * rr + d.y * t;
        z = center.z + d.z * t;
      } while (y < floorY + 0.25);
    } else {
      x = r.range(-13, 13); y = r.range(0.3, 27); z = r.range(-49, 47);
    }
    dPos.set([x, y, z], i * 3);
    dSeed.set([r(), r(), r(), r()], i * 4);
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 4));
  dGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, -5), 70);
  const dustU = uniformsBase();
  const dustMat = new THREE.ShaderMaterial({
    name: 'dust-motes',
    uniforms: dustU,
    vertexShader: /* glsl */`
      ${COMMON_VERT}
      void main() {
        float t = uTime * uSpeed;
        vec3 p = position;
        p.x += sin(t * (0.07 + aSeed.x * 0.08) + aSeed.y * 6.28) * 0.7;
        p.y += sin(t * (0.05 + aSeed.z * 0.06) + aSeed.x * 6.28) * 0.45 + t * (aSeed.w - 0.45) * 0.03;
        p.z += cos(t * (0.06 + aSeed.y * 0.07) + aSeed.z * 6.28) * 0.7;
        p.y = 0.2 + mod(p.y - 0.2, 28.0);
        vec3 tr;
        float inB = beamAt(p, tr);
        vTr = tr;
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.x * 2.2) + aSeed.z * 31.0);
        vBright = mix(0.035, 1.0, inB) * tw;
        finishPoint(p, uSize * (0.45 + aSeed.w * 1.1));
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform vec3 uTint;
      varying float vBright; varying float vAlpha; varying vec3 vTr;
      void main() {
        float q = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-q * q * 3.5) * (1.0 - smoothstep(0.75, 1.0, q));
        vec3 col = uTint * mix(vec3(1.0), vTr, 0.5) * vBright * a * vAlpha * uIntensity;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const dust = new THREE.Points(dGeo, dustMat);
  dust.name = 'dust';
  dust.frustumCulled = false;
  dust.renderOrder = 5;
  group.add(dust);

  // --- ash ------------------------------------------------------------------------------------------
  const aPos = new Float32Array(nAsh * 3), aSeed = new Float32Array(nAsh * 4);
  for (let i = 0; i < nAsh; i++) {
    aPos.set([r.range(-14, 14), r.range(0, 30), r.range(-48, 46)], i * 3);
    aSeed.set([r(), r(), r(), r()], i * 4);
  }
  const aGeo = new THREE.BufferGeometry();
  aGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  aGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  aGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 15, 0), 70);
  const ashU = uniformsBase();
  ashU.uSize.value = 0.03;
  ashU.uTint.value.setRGB(0.55, 0.52, 0.5);
  const ashMat = new THREE.ShaderMaterial({
    name: 'ash',
    uniforms: ashU,
    vertexShader: /* glsl */`
      ${COMMON_VERT}
      varying float vSpin;
      void main() {
        float t = uTime * uSpeed;
        vec3 p = position;
        float fall = t * (0.12 + aSeed.x * 0.18) + aSeed.y * 30.0;
        p.y = 30.0 - mod(30.0 - p.y + fall, 30.0);
        p.x += sin(t * 0.4 + aSeed.z * 6.28 + p.y * 0.2) * (0.4 + aSeed.w);
        p.z += cos(t * 0.33 + aSeed.x * 6.28 + p.y * 0.17) * (0.4 + aSeed.y);
        vec3 tr;
        float inB = beamAt(p, tr);
        vTr = tr;
        vBright = inB;
        vSpin = 0.35 + 0.65 * abs(sin(t * (1.5 + aSeed.w * 3.0) + aSeed.z * 10.0)); // tumbling flake
        finishPoint(p, uSize * (0.5 + aSeed.w));
        vAlpha *= smoothstep(0.0, 1.5, p.y) * smoothstep(30.0, 26.0, p.y);
      }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform vec3 uTint;
      varying float vBright; varying float vAlpha; varying vec3 vTr; varying float vSpin;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        c.y /= max(vSpin, 0.2);
        float q = length(c) * 2.0;
        float a = 1.0 - smoothstep(0.55, 1.0, q);
        vec3 lit = vTr * 1.4 + 0.08;
        vec3 col = mix(uTint * 0.06, lit * uTint * 1.6, vBright);
        gl_FragColor = vec4(col * uIntensity, a * vAlpha * 0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const ash = new THREE.Points(aGeo, ashMat);
  ash.name = 'ash';
  ash.frustumCulled = false;
  ash.renderOrder = 5;
  group.add(ash);

  return {
    group, dust, ash,
    update(time, { speed = 1, dustIntensity = 1, dustTint, ashIntensity = 1, viewportH = 1080 } = {}) {
      for (const u of [dustU, ashU]) {
        u.uTime.value = time;
        u.uSpeed.value = speed;
        u.uViewportH.value = viewportH;
      }
      dustU.uIntensity.value = dustIntensity;
      if (dustTint) dustU.uTint.value.copy(dustTint);
      ashU.uIntensity.value = ashIntensity;
    },
  };
}
