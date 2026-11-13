// Stone floor under a still sheet of water: one MeshStandardMaterial (lit stone, shadows, fog)
// extended with a planar reflection (half-res HDR render target rendered from a mirrored
// camera in onBeforeRender), Fresnel, and up to 16 analytic expanding ripples.
import * as THREE from 'three';

export const MAX_RIPPLES = 16;

const VERT_PARS = /* glsl */`
uniform mat4 wTexMatrix;
varying vec4 vReflCoord;
varying vec3 vWPos;
`;
const VERT_MAIN = /* glsl */`
{
  vec4 wWorld = modelMatrix * vec4(transformed, 1.0);
  vWPos = wWorld.xyz;
  vReflCoord = wTexMatrix * wWorld;
}
`;

const FRAG_PARS = /* glsl */`
uniform sampler2D wReflMap;
uniform vec4 wRipples[${MAX_RIPPLES}];
uniform float wTime;
uniform sampler2D wFloorMap;
uniform sampler2D wNoise;
uniform float wFloorScale;
uniform vec3 wTrans;
uniform vec3 wReflTint;
uniform float wReflBase;
uniform float wStir;
uniform float wDistort;
uniform float wGlint;
uniform vec3 wGlintColor;
uniform sampler2D wMandalaMap;
uniform vec3 wMandala;     // centre x, centre z, half extent (m)
uniform float wStreak;     // vertical reflection smear (uv)
varying vec4 vReflCoord;
varying vec3 vWPos;

// Sum of expanding ring wave packets. Returns the surface gradient (dh/dx, dh/dz).
vec2 wRippleGrad(vec2 p) {
  vec2 grad = vec2(0.0);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = wRipples[i];
    float age = wTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 4.0) continue;
    vec2 dv = p - r.xy;
    float d = length(dv) + 1e-4;
    float R = 0.08 + 1.05 * age;      // leading ring radius (m)
    float sig = 0.09 + 0.20 * age;    // packet width
    float x = d - R;
    if (x > 3.0 * sig || x < -4.0 * sig - 0.4) continue;
    float lam = 0.13 + 0.07 * age;    // wavelength grows as the packet spreads
    float k = 6.2831853 / lam;
    float env = exp(-(x * x) / (sig * sig));
    float amp = r.w * 0.0085 * exp(-0.9 * age) / sqrt(1.0 + 2.5 * d);
    float s = sin(k * x), c = cos(k * x);
    float dh = amp * env * (k * c - 2.0 * x / (sig * sig) * s);
    grad += dh * dv / d;
  }
  return grad;
}

`;

const FRAG_MAP = /* glsl */`
{
  vec2 fuv = vWPos.xz * wFloorScale;
  vec3 stone = texture2D(wFloorMap, fuv).rgb;
  float mac = texture2D(wNoise, vWPos.xz * 0.013).a;
  float mac2 = texture2D(wNoise, vWPos.xz * 0.071).r;
  stone *= mix(0.6, 1.12, smoothstep(0.2, 0.8, mac * 0.65 + mac2 * 0.35));
  float sl = dot(stone, vec3(0.299, 0.587, 0.114));
  stone = mix(stone, vec3(sl), 0.3);
  // inlaid mandala around the saint (pale marble lines, dark grooves, worn brass rings)
  vec2 muv = (vWPos.xz - wMandala.xy) / (2.0 * wMandala.z) + 0.5;
  float inM = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  vec3 mi = texture2D(wMandalaMap, clamp(muv, 0.0, 1.0)).rgb * inM;
  float wear = smoothstep(0.12, 0.55, texture2D(wNoise, vWPos.xz * 0.37).g);
  stone *= 1.0 - 0.55 * mi.g * (1.0 - mi.r);
  stone = mix(stone, vec3(0.7, 0.69, 0.66), mi.r * (0.45 + 0.4 * wear));
  stone = mix(stone, vec3(0.75, 0.52, 0.2), mi.b * 0.8 * wear);
  diffuseColor.rgb *= stone;
}
`;

const FRAG_MIX = /* glsl */`
{
  vec2 grad = wRippleGrad(vWPos.xz);
  vec2 nuv = vWPos.xz * 0.21 + vec2(wTime * 0.011, -wTime * 0.007);
  vec2 nuv2 = vWPos.xz * 0.53 + vec2(-wTime * 0.017, wTime * 0.013);
  grad += ((texture2D(wNoise, nuv).gb - 0.5) * 0.03 + (texture2D(wNoise, nuv2).gb - 0.5) * 0.015) * wStir;
  vec3 wN = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 wV = normalize(cameraPosition - vWPos);
  float ndv = clamp(dot(wN, wV), 0.0, 1.0);
  float fres = wReflBase + (1.0 - wReflBase) * pow(1.0 - ndv, 5.0);
  vec2 ruv = vReflCoord.xy / vReflCoord.w + grad * wDistort;
  // glossy vertical smear: candle flames become long streaks, the window a soft column
  vec2 st = vec2(0.0, wStreak);
  vec3 refl = texture2D(wReflMap, ruv).rgb * 0.36
    + (texture2D(wReflMap, ruv + st).rgb + texture2D(wReflMap, ruv - st).rgb) * 0.17
    + (texture2D(wReflMap, ruv + st * 2.4).rgb + texture2D(wReflMap, ruv - st * 2.4).rgb) * 0.1
    + (texture2D(wReflMap, ruv + st * 4.4).rgb + texture2D(wReflMap, ruv - st * 4.4).rgb) * 0.05
    + (texture2D(wReflMap, ruv + st * 7.0).rgb + texture2D(wReflMap, ruv - st * 7.0).rgb) * 0.02;
  refl *= wReflTint;
  outgoingLight = outgoingLight * wTrans * (1.0 - fres) + refl * fres;
  // crest sheen: faces tilted towards the viewer pick up the brighter haze, away-facing ones the dark floor
  float tilt = dot(grad, normalize(wV.xz + 1e-4));
  outgoingLight += wGlintColor * wGlint * (smoothstep(0.02, 0.3, length(grad)) * 0.6 + clamp(tilt * 3.0, -0.4, 1.0)) * (0.35 + fres);
}
`;

export function createWater({ floorMap, noise, rect, waterY, mandala, quality = 'high' }) {
  const { x0, x1, z0, z1 } = rect;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, waterY, (z0 + z1) / 2);

  const rtScale = quality === 'low' ? 0.35 : 0.5;
  const rt = new THREE.WebGLRenderTarget(16, 16, {
    type: THREE.HalfFloatType,
    samples: quality === 'high' ? 4 : 0,
  });
  rt.texture.name = 'arena-water-reflection';
  rt.texture.generateMipmaps = false;

  const texMatrix = new THREE.Matrix4();
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
  const uniforms = {
    wReflMap: { value: rt.texture },
    wTexMatrix: { value: texMatrix },
    wRipples: { value: ripples },
    wTime: { value: 0 },
    wFloorMap: { value: floorMap },
    wNoise: { value: noise },
    wFloorScale: { value: 1 / 4.6 },
    wTrans: { value: new THREE.Color(0.12, 0.14, 0.17) },   // stone seen through the water
    wReflTint: { value: new THREE.Color(0.8, 0.83, 0.87) },
    wReflBase: { value: 0.035 },
    wStir: { value: 0 },
    wDistort: { value: 0.05 },
    wGlint: { value: 1.0 },
    wMandalaMap: { value: mandala ? mandala.texture : null },
    wMandala: { value: new THREE.Vector3(mandala ? mandala.x : 0, mandala ? mandala.z : 0, mandala ? mandala.extent : 1) },
    wStreak: { value: 0.006 },

    wGlintColor: { value: new THREE.Color(0.05, 0.055, 0.065) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  mat.name = 'arena-water';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <opaque_fragment>', FRAG_MIX + '\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'arena-water-v3';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.receiveShadow = true;

  // --- planar reflection (adapted from three/addons/objects/Reflector.js) ---------------------
  const reflCam = new THREE.PerspectiveCamera();
  const normal = new THREE.Vector3(0, 1, 0);
  const planePoint = new THREE.Vector3(0, waterY, 0);
  const camPos = new THREE.Vector3(), view = new THREE.Vector3(), lookAt = new THREE.Vector3(), target = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const size = new THREE.Vector2();
  const noReflect = [];
  const hidden = [];
  let frameId = 0, renderedFrame = -1, driven = false;

  mesh.onBeforeRender = (renderer, scene, camera) => {
    if (driven && renderedFrame === frameId) return; // once per arena.update()
    renderedFrame = frameId;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(planePoint, camPos);
    if (view.dot(normal) > 0) return; // camera under the water
    view.reflect(normal).negate().add(planePoint);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(planePoint, lookAt).reflect(normal).negate().add(planePoint);
    reflCam.position.copy(view);
    reflCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    reflCam.lookAt(target);
    reflCam.far = camera.far;
    reflCam.near = camera.near;
    reflCam.layers.mask = camera.layers.mask;
    reflCam.updateMatrixWorld();
    reflCam.projectionMatrix.copy(camera.projectionMatrix);
    reflCam.projectionMatrix.elements[8] *= -1;
    reflCam.projectionMatrix.elements[12] *= -1;
    texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    texMatrix.multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
    // oblique near plane = water plane (Lengyel)
    plane.setFromNormalAndCoplanarPoint(normal, planePoint).applyMatrix4(reflCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = reflCam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1;
    q.w = (1 + pm[10]) / pm[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1; pm[14] = clip.w;
    reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();

    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, Math.round(size.x * rtScale)), h = Math.max(2, Math.round(size.y * rtScale));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

    mesh.visible = false;
    hidden.length = 0;
    for (const o of noReflect) if (o.visible) { o.visible = false; hidden.push(o); }
    const curRT = renderer.getRenderTarget();
    const xr = renderer.xr.enabled, autoShadow = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, reflCam);
    renderer.xr.enabled = xr;
    renderer.shadowMap.autoUpdate = autoShadow;
    renderer.setRenderTarget(curRT);
    if (camera.viewport !== undefined) renderer.state.viewport(camera.viewport);
    for (const o of hidden) o.visible = true;
    mesh.visible = true;
  };

  let next = 0;
  let now = 0;
  return {
    mesh,
    uniforms,
    noReflect,
    renderTarget: rt,
    ripple(x, z, strength = 1) {
      // reuse the oldest slot (ring buffer)
      ripples[next].set(x, z, now, Math.max(0, strength));
      next = (next + 1) % MAX_RIPPLES;
    },
    update(time) {
      now = time;
      uniforms.wTime.value = time;
      frameId++;
      driven = true;
    },
    dispose() {
      rt.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}
