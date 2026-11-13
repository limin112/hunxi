// World-space triplanar material for all masonry (walls, pillars, vault, steps, rubble, pews).
// MeshStandardMaterial + onBeforeCompile: albedo from a tiling texture sampled in three planes,
// procedural roughness / relief from the texture luminance, grime streaks, wet band at the water
// line and darkening with height so the vault dissolves into darkness.
import * as THREE from 'three';
import { NAVE } from './architecture.js';

const f = (v) => v.toFixed(5);
// The key light only enters through the rose window: light reaching a point must back-project
// (against the light direction) into the window disc. Applied analytically to the arena's own
// surfaces so walls / piers outside the shadow-camera frustum are not lit by it (three.js treats
// fragments outside a shadow frustum as fully lit).
export const GLSL_KEY_MASK = /* glsl */`
float arenaKeyMask(vec3 p) {
  const vec3 rose = vec3(${f(NAVE.rose.x)}, ${f(NAVE.rose.y)}, ${f(NAVE.rose.z)});
  const vec3 kd = vec3(${f(NAVE.keyDir[0])}, ${f(NAVE.keyDir[1])}, ${f(NAVE.keyDir[2])});
  float t = (p.z - rose.z) / kd.z;
  vec2 w = p.xy - kd.xy * t;
  float r = length(w - rose.xy);
  return step(-0.3, t) * smoothstep(${f(NAVE.rose.r + 0.8)}, ${f(NAVE.rose.r - 0.3)}, r);
}
`;
// The moon (second directional light, unshadowed) only enters through the left clerestory
// lancets (x = -14, two per bay) and the left aisle lancets (x = -23, one per bay).
export const MOON_DIR_ARR = [0.7, -0.68, -0.2].map((v, i, a) => v / Math.hypot(...a)); // ~44 deg elevation
export const GLSL_MOON_MASK = /* glsl */`
float arenaLancet(vec3 p, float wallX, float sill, float straight, float rise, float hw0, float pairOffset) {
  const vec3 md = vec3(${f(MOON_DIR_ARR[0])}, ${f(MOON_DIR_ARR[1])}, ${f(MOON_DIR_ARR[2])});
  float t = (p.x - wallX) / md.x;
  vec3 w = p - md * t;
  float bc = clamp(floor(w.z / 8.0 + 0.5), -5.0, 5.0) * 8.0;
  float u = abs(abs(w.z - bc) - pairOffset);
  float y = w.y - sill;
  float arch = clamp((y - straight) / rise, 0.0, 1.0);
  float hw = hw0 * sqrt(max(1.0 - arch * arch, 0.0));
  return step(0.0, t) * smoothstep(hw + 0.15, hw - 0.1, u) * smoothstep(-0.15, 0.15, y)
       * step(y, straight + rise) * step(abs(w.z), 44.0);
}
uniform float arenaMoonGain; // arena surfaces get more moon than the (unmasked) characters
float arenaMoonMask(vec3 p) {
  float clere = arenaLancet(p, -14.0, 20.0, 5.4, 2.3, 0.85, 1.35);
  float aisle = arenaLancet(p, -23.0, 3.2, 8.6, 2.9, 1.15, 0.0);
  return max(clere, aisle * (p.x < -13.3 ? 1.0 : 0.6)) * arenaMoonGain;
}
`;
const DIR_HOOK = 'getDirectionalLightInfo( directionalLight, directLight );';
if (!THREE.ShaderChunk.lights_fragment_begin.includes(DIR_HOOK)) console.warn('[arena] lights_fragment_begin changed; key-light mask disabled');
/** lights_fragment_begin with the first directional light (the shadow-casting key) masked. */
function keyMaskedLights(posVar) {
  return THREE.ShaderChunk.lights_fragment_begin.replace(DIR_HOOK, `${DIR_HOOK}
    #if ( UNROLLED_LOOP_INDEX == 0 )
      directLight.color *= arenaKeyMask(${posVar});
    #elif ( UNROLLED_LOOP_INDEX == 1 )
      directLight.color *= arenaMoonMask(${posVar});
    #endif`);
}

// Cheap stand-in for the occlusion a forward renderer does not have: the side aisles (under the
// aisle vaults, behind the arcades) and the high vault get far less indirect light.
export const GLSL_ARENA_AO = /* glsl */`
float arenaAO(vec3 p) {
  float aisle = smoothstep(14.6, 16.4, abs(p.x));
  float ao = mix(1.0, 0.16, aisle);
  ao *= mix(1.0, 0.4, smoothstep(17.0, 40.0, p.y));
  return ao;
}
`;

/** Uniforms shared by every arena material (updated once per frame by arena.js). */
export const ARENA_SHARED = {
  arenaBounce: { value: new THREE.Color(0, 0, 0) }, // light bounced off the window's floor pool
  arenaFogGlow: { value: new THREE.Color(0, 0, 0) }, // fog in-scatter towards the rose window
  arenaCandleMap: { value: null },                    // top-down splat of candle light (R)
  arenaCandleRect: { value: new THREE.Vector4(-24, -52, 1 / 48, 1 / 104) }, // x0, z0, 1/w, 1/d
  arenaCandleColor: { value: new THREE.Color(0, 0, 0) },
  arenaMoonGain: { value: 3.3 },
};
// Fog with forward scattering: looking towards the rose window the haze glows, elsewhere it is the
// plain (dark) fog colour. Distant piers silhouette against the glow; the foreground stays clean.
const FOG_GLOW = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogV = normalize(FOG_POS - cameraPosition);
  vec3 fogW = normalize(vec3(${f(NAVE.rose.x)}, ${f(NAVE.rose.y)}, ${f(NAVE.rose.z)}) - cameraPosition);
  float fogMu = max(dot(fogV, fogW), 0.0);
  vec3 fogC = fogColor + arenaFogGlow * (pow(fogMu, 6.0) * 0.6 + pow(fogMu, 40.0) * 0.6);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );
#endif
`;
const POOL = { z: -9.5 }; // centre of the beam footprint on the floor (z ~ -27 .. +8)
const GLSL_BOUNCE_PARS = /* glsl */`
uniform vec3 arenaBounce;
uniform vec3 arenaFogGlow;
uniform sampler2D arenaCandleMap;
uniform vec4 arenaCandleRect;
uniform vec3 arenaCandleColor;
float arenaCandleLight(vec3 p) {
  vec2 uv = (p.xz - arenaCandleRect.xy) * arenaCandleRect.zw;
  float g = texture2D(arenaCandleMap, clamp(uv, 0.0, 1.0)).r;
  // reference height: the floor, or the tread of the altar steps
  float yRef = p.z < -36.5 ? clamp(floor((-36.5 - p.z) / 0.6) + 1.0, 0.0, 8.0) * 0.17 : 0.0;
  return g * exp(-max(p.y - yRef - 0.2, 0.0) * 0.9);
}
`;
// Bounce from the sunlit pool: a broad, elongated source on the floor that lifts the piers and
// arcades around the fight (no extra dynamic light). Then the occlusion field darkens the aisles.
const AO_APPLY = /* glsl */`
{
  vec3 bN = inverseTransformDirection(normal, viewMatrix);
  vec3 toPool = vec3(0.0, 0.6, ${POOL.z.toFixed(2)}) - AO_POS;
  vec3 e = toPool * vec3(0.8, 1.0, 0.4);
  float fall = 1.0 / (1.0 + dot(e, e) * 0.012);
  float ndl = clamp(dot(bN, normalize(toPool)) * 0.6 + 0.4, 0.0, 1.0);
  reflectedLight.indirectDiffuse += material.diffuseColor * arenaBounce * (fall * ndl);
}
{ float aoF = arenaAO(AO_POS); reflectedLight.indirectDiffuse *= aoF; reflectedLight.indirectSpecular *= aoF; }
reflectedLight.indirectDiffuse += material.diffuseColor * arenaCandleColor * arenaCandleLight(AO_POS);
#include <aomap_fragment>
`;

/** Chain the arena occlusion field onto any lit built-in material (instancing aware). */
export function withArenaAO(mat) {
  const own = (k) => Object.prototype.hasOwnProperty.call(mat, k);
  const prev = own('onBeforeCompile') ? mat.onBeforeCompile : null;
  const prevKey = own('customProgramCacheKey') ? mat.customProgramCacheKey : null;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    shader.uniforms.arenaBounce = ARENA_SHARED.arenaBounce;
    shader.uniforms.arenaFogGlow = ARENA_SHARED.arenaFogGlow;
    shader.uniforms.arenaCandleMap = ARENA_SHARED.arenaCandleMap;
    shader.uniforms.arenaCandleRect = ARENA_SHARED.arenaCandleRect;
    shader.uniforms.arenaCandleColor = ARENA_SHARED.arenaCandleColor;
    shader.uniforms.arenaMoonGain = ARENA_SHARED.arenaMoonGain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAOPos;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        { vec4 aw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            aw = instanceMatrix * aw;
          #endif
          vAOPos = (modelMatrix * aw).xyz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAOPos;\n' + GLSL_ARENA_AO + GLSL_KEY_MASK + GLSL_MOON_MASK + GLSL_BOUNCE_PARS)
      .replace('#include <lights_fragment_begin>', keyMaskedLights('vAOPos'))
      .replace('#include <aomap_fragment>', AO_APPLY.replaceAll('AO_POS', 'vAOPos'))
      .replace('#include <fog_fragment>', FOG_GLOW.replaceAll('FOG_POS', 'vAOPos'));
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : mat.type) + '|arena-ao-key-b-fog-c-moon';
  return mat;
}

const VERT_PARS = /* glsl */`
varying vec3 vTpPos;
varying vec3 vTpNrm;
`;

const VERT_MAIN = /* glsl */`
{
  vec4 tpW = vec4(transformed, 1.0);
  vec3 tpN = objectNormal;
  #ifdef USE_INSTANCING
    tpW = instanceMatrix * tpW;
    tpN = mat3(instanceMatrix) * tpN;
  #endif
  tpW = modelMatrix * tpW;
  vTpPos = tpW.xyz;
  vTpNrm = normalize(mat3(modelMatrix) * tpN);
}
`;

const FRAG_PARS = /* glsl */`
${GLSL_ARENA_AO}
${GLSL_KEY_MASK}
${GLSL_MOON_MASK}
${GLSL_BOUNCE_PARS}
varying vec3 vTpPos;
varying vec3 vTpNrm;
uniform sampler2D tpMap;
uniform sampler2D tpNoise;
uniform float tpScale;
uniform vec3 tpTint;
uniform float tpDesat;
uniform float tpGrime;
uniform vec3 tpDarkTop;   // start y, end y, multiplier at the end
uniform float tpWet;      // wet band height (0 = none)
uniform float tpBump;
uniform float tpRoughVar;
uniform float tpMacro;

vec3 tpPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const FRAG_MAP = /* glsl */`
vec3 tpNw = normalize(vTpNrm);
vec3 tpBl = pow(abs(tpNw), vec3(5.0));
tpBl /= (tpBl.x + tpBl.y + tpBl.z + 1e-5);
vec3 tpP = vTpPos * tpScale;
vec3 tpC = texture2D(tpMap, tpP.zy + vec2(0.31, 0.0)).rgb * tpBl.x
         + texture2D(tpMap, tpP.xz + vec2(0.0, 0.17)).rgb * tpBl.y
         + texture2D(tpMap, tpP.xy).rgb * tpBl.z;
float tpLum = dot(tpC, vec3(0.299, 0.587, 0.114));
// relief from the albedo luminance; faded out once a pixel covers more than a few texels
// (grazing walls / distance), otherwise the derivative aliases into bright streaks.
float tpFoot = max(length(dFdx(vTpPos)), length(dFdy(vTpPos)));
vec2 tpDH = vec2(dFdx(tpLum), dFdy(tpLum)) * tpBump * smoothstep(0.03, 0.008, tpFoot);
tpC = mix(tpC, vec3(tpLum), tpDesat) * tpTint;
float tpN1 = texture2D(tpNoise, vTpPos.xz * 0.011 + vec2(vTpPos.y * 0.006, 0.0)).a;
float tpN2 = texture2D(tpNoise, vTpPos.zx * 0.043 + vec2(0.0, vTpPos.y * 0.031)).r;
float tpStreak = texture2D(tpNoise, vec2((vTpPos.x + vTpPos.z) * 0.19, vTpPos.y * 0.012)).g;
tpC *= mix(1.0 - tpMacro, 1.0 + tpMacro * 0.6, smoothstep(0.25, 0.75, tpN1 * 0.6 + tpN2 * 0.4));
tpC *= mix(1.0, 0.5 + 0.6 * smoothstep(0.25, 0.75, tpStreak), tpGrime);
tpC *= mix(1.0, tpDarkTop.z, smoothstep(tpDarkTop.x, tpDarkTop.y, vTpPos.y));
float tpWetF = 0.0;
if (tpWet > 0.0) tpWetF = 1.0 - smoothstep(tpWet * 0.35, tpWet * (0.75 + 0.7 * tpN2), vTpPos.y);
tpC *= mix(1.0, 0.42, tpWetF);
diffuseColor.rgb *= tpC;
`;

const FRAG_ROUGH = /* glsl */`
float roughnessFactor = clamp(roughness * (1.0 + tpRoughVar * (0.5 - tpLum)) , 0.05, 1.0);
roughnessFactor = mix(roughnessFactor, 0.22, tpWetF);
`;

const FRAG_NORMAL = /* glsl */`
#include <normal_fragment_maps>
normal = tpPerturb(-vViewPosition, normal, tpDH, faceDirection);
`;

/**
 * @param {object} o
 * @param {THREE.Texture} o.map        tiling albedo
 * @param {THREE.Texture} o.noise      tileable noise (makeNoiseTexture)
 * @param {number} o.scale             uv per metre (1 / tile size)
 */
export function createStoneMaterial({
  map, noise, scale = 0.2, tint = [1, 1, 1], desat = 0.3, roughness = 0.88, roughVar = 0.6,
  grime = 0.5, darkTop = [16, 42, 0.3], wet = 0, bump = 1.2, macro = 0.22, color = 0xffffff,
  side = THREE.FrontSide, name = 'arena-stone', envMapIntensity = 0.45,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side, envMapIntensity });
  mat.name = name;
  const uniforms = {
    tpMap: { value: map },
    tpNoise: { value: noise },
    tpScale: { value: scale },
    tpTint: { value: new THREE.Vector3(...tint) },
    tpDesat: { value: desat },
    tpGrime: { value: grime },
    tpDarkTop: { value: new THREE.Vector3(...darkTop) },
    tpWet: { value: wet },
    tpBump: { value: bump },
    tpRoughVar: { value: roughVar },
    tpMacro: { value: macro },
  };
  mat.userData.tpUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.uniforms.arenaBounce = ARENA_SHARED.arenaBounce;
    shader.uniforms.arenaFogGlow = ARENA_SHARED.arenaFogGlow;
    shader.uniforms.arenaCandleMap = ARENA_SHARED.arenaCandleMap;
    shader.uniforms.arenaCandleRect = ARENA_SHARED.arenaCandleRect;
    shader.uniforms.arenaCandleColor = ARENA_SHARED.arenaCandleColor;
    shader.uniforms.arenaMoonGain = ARENA_SHARED.arenaMoonGain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_fragment_begin>', keyMaskedLights('vTpPos'))
      .replace('#include <aomap_fragment>', AO_APPLY.replaceAll('AO_POS', 'vTpPos'))
      .replace('#include <fog_fragment>', FOG_GLOW.replaceAll('FOG_POS', 'vTpPos'));
  };
  mat.customProgramCacheKey = () => 'arena-triplanar-v7';
  return mat;
}
