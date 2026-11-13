// Night (or dawn) sky seen through broken windows and the holes in the vault.
// Camera-centred dome pinned to the far plane, so it works with any camera.far.
import * as THREE from 'three';

export function createSky({ noise }) {
  const mat = new THREE.ShaderMaterial({
    name: 'arena-sky',
    uniforms: {
      uNoise: { value: noise },
      uTime: { value: 0 },
      uDawn: { value: 0 },
      uBright: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec3 v = mat3(viewMatrix) * position;
        gl_Position = projectionMatrix * vec4(v, 1.0);
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uNoise; uniform float uTime; uniform float uDawn; uniform float uBright;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float el = dir.y;
        vec3 zenithN = vec3(0.008, 0.016, 0.036), horizonN = vec3(0.03, 0.055, 0.095);
        vec3 zenithD = vec3(0.10, 0.12, 0.2), horizonD = vec3(0.95, 0.5, 0.24);
        vec3 zen = mix(zenithN, zenithD, uDawn), hor = mix(horizonN, horizonD, uDawn);
        vec3 col = mix(hor, zen, smoothstep(-0.05, 0.6, el));
        // clouds projected on a plane
        vec2 uv = dir.xz / max(el + 0.18, 0.05) * 0.18 + vec2(uTime * 0.0025, uTime * 0.001);
        float c = texture2D(uNoise, uv).r * 0.6 + texture2D(uNoise, uv * 2.7 + 0.31).g * 0.3 + texture2D(uNoise, uv * 7.1).b * 0.1;
        float cover = smoothstep(0.38, 0.72, c);
        vec3 cloudN = vec3(0.035, 0.06, 0.1) + vec3(0.06, 0.085, 0.12) * smoothstep(0.55, 0.8, c);
        vec3 cloudD = mix(vec3(0.7, 0.42, 0.3), vec3(1.2, 0.8, 0.55), smoothstep(0.5, 0.85, c));
        col = mix(col, mix(cloudN, cloudD, uDawn), cover * smoothstep(-0.1, 0.15, el));
        gl_FragColor = vec4(col * uBright, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000; // after the other opaques: early-z skips covered pixels
  return {
    mesh,
    update(time, dawn, bright = 1) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uDawn.value = dawn;
      mat.uniforms.uBright.value = bright;
    },
  };
}
