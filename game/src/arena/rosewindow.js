// Rose window: emissive stained-glass disc (casts tracery-patterned shadows through an
// alpha-tested depth material), a scattering halo, and a volumetric light beam.
//
// The beam is an oblique cylinder = the window disc swept along the key-light direction down to
// the floor. Its back faces are rasterised; the fragment shader intersects the view ray with the
// cylinder / window plane / floor analytically and integrates in-scattered light along it,
// back-projecting every sample onto the window to look up the glass transmission. The tracery
// therefore carves real light shafts into the haze, coloured by the glass.
import * as THREE from 'three';
import { GLSL_GLASS_MASK } from './textures.js';
import { GLSL_IGN, rng } from './util.js';

const OUT = /* glsl */`
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

export function createRoseWindow({ map, transmission, noise, center, radius, dir, floorY, quality = 'high' }) {
  const group = new THREE.Group();
  group.name = 'rose-window';

  // --- glass ---------------------------------------------------------------------------------
  const discMat = new THREE.ShaderMaterial({
    name: 'rose-glass',
    uniforms: {
      uMap: { value: map },
      uIntensity: { value: 3 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uHot: { value: 1.2 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      ${GLSL_GLASS_MASK}
      uniform sampler2D uMap; uniform float uIntensity; uniform vec3 uTint; uniform float uHot; uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec3 tex = texture2D(uMap, vUv).rgb;
        float m = arenaGlassMask(tex);
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float hot = 1.0 + uHot * exp(-r * r * 4.0);
        float shimmer = 0.96 + 0.04 * sin(uTime * 0.6 + r * 7.0 + atan(c.y, c.x) * 3.0);
        vec3 col = tex * (0.05 + m * uIntensity * hot * shimmer) * uTint;
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
    fog: false,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 128), discMat);
  disc.name = 'rose-glass';
  disc.position.copy(center);
  disc.castShadow = true;
  // shadow pass: glass lets light through, tracery blocks it
  const depthMat = new THREE.MeshDepthMaterial({ map: transmission });
  depthMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', 'if (diffuseColor.a > 0.45) discard;');
  };
  depthMat.customProgramCacheKey = () => 'arena-rose-depth';
  disc.customDepthMaterial = depthMat;
  group.add(disc);

  // --- halo (forward scattering around the window, sits just in front of the wall) ----------
  const haloSize = radius * 5;
  const haloMat = new THREE.ShaderMaterial({
    name: 'rose-halo',
    uniforms: {
      uIntensity: { value: 0.3 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uR: { value: radius },
    },
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uIntensity; uniform vec3 uTint; uniform float uR;
      varying vec2 vP;
      void main() {
        float r = length(vP) / uR;
        float rim = exp(-pow(max(r - 0.97, 0.0) * 2.6, 1.3));
        float veil = exp(-r * r * 0.55);
        float g = (rim * 0.65 * smoothstep(0.6, 1.0, r) + veil * 0.35) * smoothstep(2.5, 1.6, r);
        gl_FragColor = vec4(uTint * g * uIntensity, 1.0);
        ${OUT}
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(haloSize, haloSize), haloMat);
  halo.name = 'rose-halo';
  halo.position.set(center.x, center.y, center.z + 0.75);
  halo.renderOrder = 2;
  group.add(halo);

  // --- volumetric beam ---------------------------------------------------------------------------
  const d = dir.clone().normalize();
  const margin = 0.35;
  const Rb = radius + margin;
  const tMax = (center.y + Rb - floorY) / -d.y + 2;
  const NJ = 56, NK = 56;
  const pos = [];
  const idx = [];
  const fy = floorY + 0.03;
  for (let j = 0; j <= NJ; j++) {
    const t = (j / NJ) * tMax;
    for (let k = 0; k < NK; k++) {
      const a = (k / NK) * Math.PI * 2;
      const x = center.x + Math.cos(a) * Rb + d.x * t;
      const y = center.y + Math.sin(a) * Rb + d.y * t;
      const z = center.z + d.z * t + 0.15;
      pos.push(x, Math.max(fy, y), z);
    }
  }
  for (let j = 0; j < NJ; j++) {
    for (let k = 0; k < NK; k++) {
      const a = j * NK + k, b = j * NK + ((k + 1) % NK), c = (j + 1) * NK + k, e = (j + 1) * NK + ((k + 1) % NK);
      idx.push(a, b, c, b, e, c);
    }
  }
  const capC = pos.length / 3;
  pos.push(center.x, center.y, center.z + 0.15);
  for (let k = 0; k < NK; k++) idx.push(capC, (k + 1) % NK, k);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  beamGeo.setIndex(idx);
  beamGeo.computeBoundingSphere();

  const steps = quality === 'low' ? 8 : quality === 'medium' ? 10 : 14;
  const beamMat = new THREE.ShaderMaterial({
    name: 'rose-beam',
    defines: { BEAM_STEPS: steps },
    uniforms: {
      uC: { value: center.clone() },
      uR: { value: radius },
      uD: { value: d.clone() },
      uFloorY: { value: floorY },
      uTrans: { value: transmission },
      uNoise: { value: noise },
      uIntensity: { value: 0.04 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 },
      uLod: { value: 1.0 },
      uStreak: { value: 0.6 },
      uDensityFloor: { value: 0.35 },
      uAtten: { value: 0.014 },
      uNear: { value: new THREE.Vector2(2.5, 16.0) },  // in-scatter fades in over this camera distance
      uMax: { value: 0.32 },                             // soft cap of the accumulated radiance
      uAxisDim: { value: 0.22 },                         // keep the glass readable when looking up the beam
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_IGN}
      uniform vec3 uC; uniform float uR; uniform vec3 uD; uniform float uFloorY;
      uniform sampler2D uTrans; uniform sampler2D uNoise;
      uniform float uIntensity; uniform vec3 uTint; uniform float uTime; uniform float uLod;
      uniform float uStreak; uniform float uDensityFloor; uniform float uAtten;
      uniform vec2 uNear; uniform float uMax; uniform float uAxisDim;
      varying vec3 vWorld;
      void main() {
        vec3 O = cameraPosition;
        vec3 toP = vWorld - O;
        float sBack = length(toP);
        vec3 V = toP / sBack;
        // oblique cylinder: back-projection of the ray onto the window plane must stay in the disc
        float tO = (O.z - uC.z) / uD.z;
        vec2 A = O.xy - uD.xy * tO - uC.xy;
        vec2 B = V.xy - uD.xy * (V.z / uD.z);
        float a = dot(B, B), b = dot(B, A), c = dot(A, A) - uR * uR;
        float s0 = 0.0, s1 = sBack + 0.5;
        if (a > 1e-8) {
          float disc = b * b - a * c;
          if (disc <= 0.0) discard;
          float sq = sqrt(disc);
          s0 = max(s0, (-b - sq) / a);
          s1 = min(s1, (-b + sq) / a);
        } else if (c > 0.0) discard;
        if (abs(V.z) > 1e-6) {
          float sz = (uC.z - O.z) / V.z;
          if (V.z < 0.0) s1 = min(s1, sz); else s0 = max(s0, sz);
        }
        if (abs(V.y) > 1e-6) {
          float sy = (uFloorY - O.y) / V.y;
          if (V.y < 0.0) s1 = min(s1, sy); else s0 = max(s0, sy);
        }
        if (s1 <= s0) discard;
        float ds = (s1 - s0) / float(BEAM_STEPS);
        float jit = arenaIGN(gl_FragCoord.xy);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < BEAM_STEPS; i++) {
          float s = s0 + (float(i) + jit) * ds;
          vec3 P = O + V * s;
          float t = (P.z - uC.z) / uD.z;
          vec2 w = P.xy - uD.xy * t;
          vec2 uv = (w - uC.xy) / (2.0 * uR) + 0.5;
          vec3 tr = textureLod(uTrans, uv, uLod).rgb;
          // dust: fine streaks constant along the beam + slow drifting density
          float n1 = texture(uNoise, w * 0.31 + vec2(0.0, uTime * 0.004)).g;
          float n2 = texture(uNoise, vec2(w.x * 0.045 + t * 0.011 - uTime * 0.005, w.y * 0.045 + t * 0.004 + uTime * 0.002)).r;
          float streak = smoothstep(0.38, 0.72, n1);
          float dens = mix(1.0, streak * streak * 2.6, uStreak) * (0.45 + 1.1 * n2 * n2);
          dens *= 1.0 + uDensityFloor * exp(-max(P.y - uFloorY, 0.0) * 0.4);
          dens *= exp(-t * uAtten);
          dens *= smoothstep(uNear.x, uNear.y, s);
          acc += tr * dens;
        }
        vec3 col = acc * ds * uIntensity * uTint;
        col *= mix(1.0, uAxisDim, smoothstep(0.88, 0.995, dot(V, -uD)));
        col = uMax * (vec3(1.0) - exp(-col / uMax));
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.name = 'rose-beam';
  beam.renderOrder = 3;
  group.add(beam);

  // --- ray fan: soft axial billboards spreading from the glass (the painterly god rays) ---------
  const r = rng(808);
  const NR = quality === 'low' ? 14 : 26;
  const rayQuad = new THREE.PlaneGeometry(1, 1, 1, 12);
  const rayGeo = new THREE.InstancedBufferGeometry();
  rayGeo.index = rayQuad.index;
  rayGeo.setAttribute('position', rayQuad.attributes.position);
  const iStart = new Float32Array(NR * 3), iDir = new Float32Array(NR * 3), iShape = new Float32Array(NR * 4);
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < NR; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * radius * 0.85;
    const start = new THREE.Vector3(center.x + Math.cos(a) * rr, center.y + Math.sin(a) * rr, center.z + 0.3);
    e.set(r.range(-0.24, 0.1) + (Math.sin(a) * rr / radius) * 0.12, r.range(-0.3, 0.3) + (Math.cos(a) * rr / radius) * 0.1, 0, 'YXZ');
    const dirI = d.clone().applyQuaternion(q.setFromEuler(e)).normalize();
    const len = dirI.y < -0.05 ? Math.min(72, (start.y - floorY - 0.3) / -dirI.y) : 60;
    const w0 = r.range(0.25, 0.9);
    iStart.set([start.x, start.y, start.z], i * 3);
    iDir.set([dirI.x, dirI.y, dirI.z], i * 3);
    iShape.set([len, w0, w0 * r.range(2.5, 5.0), r.range(0.35, 1.0) * (r() < 0.3 ? 1.6 : 1)], i * 4);
  }
  rayGeo.setAttribute('iStart', new THREE.InstancedBufferAttribute(iStart, 3));
  rayGeo.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 3));
  rayGeo.setAttribute('iShape', new THREE.InstancedBufferAttribute(iShape, 4));
  rayGeo.instanceCount = NR;
  rayGeo.boundingSphere = new THREE.Sphere(center.clone().add(new THREE.Vector3(0, -8, 25)), 60);
  const rayMat = new THREE.ShaderMaterial({
    name: 'rose-rays',
    uniforms: {
      uNoise: { value: noise },
      uTime: { value: 0 },
      uIntensity: { value: 0.05 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uFloorY: { value: floorY },
    },
    vertexShader: /* glsl */`
      attribute vec3 iStart; attribute vec3 iDir; attribute vec4 iShape;
      varying float vS; varying float vT; varying float vI; varying float vLen; varying float vSeed; varying vec3 vWorld;
      void main() {
        float s = position.y + 0.5;
        vec3 P = iStart + iDir * (s * iShape.x);
        vec3 side = cross(iDir, cameraPosition - P);
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
        P += side * position.x * 2.0 * mix(iShape.y, iShape.z, s);
        vS = s; vT = position.x * 2.0; vI = iShape.w; vLen = iShape.x;
        vSeed = fract(iStart.x * 0.137 + iStart.y * 0.311);
        vWorld = P;
        gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime; uniform float uIntensity; uniform vec3 uTint; uniform float uFloorY;
      varying float vS; varying float vT; varying float vI; varying float vLen; varying float vSeed; varying vec3 vWorld;
      void main() {
        float across = exp(-vT * vT * 2.8) * (1.0 - smoothstep(0.75, 1.0, abs(vT)));
        float along = smoothstep(0.0, 0.05, vS) * (1.0 - smoothstep(0.35, 1.0, vS));
        float n = texture(uNoise, vec2(vS * vLen * 0.035 - uTime * 0.012, vSeed)).r;
        float n2 = texture(uNoise, vec2(vT * 0.25 + vSeed * 3.0, vS * vLen * 0.01 + uTime * 0.004)).g;
        float a = across * along * (0.45 + 1.1 * n * n2);
        a *= smoothstep(uFloorY, uFloorY + 1.5, vWorld.y);
        a *= smoothstep(3.0, 14.0, distance(cameraPosition, vWorld));
        gl_FragColor = vec4(uTint * a * vI * uIntensity, 1.0);
        ${OUT}
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  const rays = new THREE.Mesh(rayGeo, rayMat);
  rays.name = 'rose-rays';
  rays.frustumCulled = false;
  rays.renderOrder = 3;
  group.add(rays);

  return {
    group, disc, halo, beam, rays,
    tMax,
    set({ window, windowTint, hot, halo: haloI, haloTint, beam: beamI, beamTint, streak, beamMax, rays: raysI, time }) {
      if (raysI !== undefined) { rayMat.uniforms.uIntensity.value = raysI; rays.visible = raysI > 1e-4; }
      if (beamTint) rayMat.uniforms.uTint.value.copy(beamTint);
      if (window !== undefined) discMat.uniforms.uIntensity.value = window;
      if (windowTint) discMat.uniforms.uTint.value.copy(windowTint);
      if (hot !== undefined) discMat.uniforms.uHot.value = hot;
      if (haloI !== undefined) haloMat.uniforms.uIntensity.value = haloI;
      if (haloTint) haloMat.uniforms.uTint.value.copy(haloTint);
      if (beamI !== undefined) beamMat.uniforms.uIntensity.value = beamI;
      if (beamTint) beamMat.uniforms.uTint.value.copy(beamTint);
      if (streak !== undefined) beamMat.uniforms.uStreak.value = streak;
      if (beamMax !== undefined) beamMat.uniforms.uMax.value = beamMax;
      if (time !== undefined) { discMat.uniforms.uTime.value = time; beamMat.uniforms.uTime.value = time; rayMat.uniforms.uTime.value = time; }
    },
    beamUniforms: beamMat.uniforms,
    dispose() {
      depthMat.dispose();
    },
  };
}
