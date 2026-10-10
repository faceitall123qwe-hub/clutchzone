import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Three flat bands of light instead of smooth shading: shadow, mid, lit. */
export const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

export const toon = (params: THREE.MeshToonMaterialParameters = {}) =>
  new THREE.MeshToonMaterial({ gradientMap: gradient, ...params });

export const INK = new THREE.Color(0x14161c);

/**
 * Black outlines for the whole world in one full-screen pass: the scene is rendered into a target with
 * a depth texture, and a line is drawn where depth jumps (silhouettes) or bends (box edges, creases).
 * No extra draw calls per object, whatever is on screen.
 */
export class Outline {
  readonly target: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();

  constructor() {
    // no MSAA and 8-bit sRGB colour: integrated graphics can't afford more, and the outlines hide the jaggies
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      colorSpace: THREE.SRGBColorSpace, depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    const material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
        texel: { value: new THREE.Vector2() }, invNear: { value: 1 }, invRange: { value: 1 }, ink: { value: INK },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tColor, tDepth; uniform vec2 texel; uniform float invNear, invRange; uniform vec3 ink;
        varying vec2 vUv;
        float depth(vec2 uv) { return texture2D(tDepth, uv).x; }
        void main() {
          // 1 / view distance = 1/near - depth * (1/near - 1/far): on any flat surface it changes linearly
          // across the screen, so its second difference is zero there and large at silhouettes and at the
          // edges between faces. Offsets are whole pixels: depth is sampled without filtering.
          vec2 o = texel * 2.0;
          float c = depth(vUv);
          float h = abs(depth(vUv - vec2(o.x, 0.0)) + depth(vUv + vec2(o.x, 0.0)) - 2.0 * c);
          float v = abs(depth(vUv - vec2(0.0, o.y)) + depth(vUv + vec2(0.0, o.y)) - 2.0 * c);
          float bend = (h + v) * invRange / max(invNear - min(c, 0.999999) * invRange, 1e-6);
          float edge = smoothstep(0.004, 0.012, bend);
          vec4 col = texture2D(tColor, vUv);
          gl_FragColor = vec4(mix(col.rgb, ink, edge * 0.92), 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.quad.frustumCulled = false;
  }

  setSize(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    this.target.setSize(this.size.x, this.size.y);
    (this.quad.material as THREE.ShaderMaterial).uniforms.texel.value.set(1 / this.size.x, 1 / this.size.y);
  }

  /** Draws the target onto the screen with the outlines. */
  composite(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    const u = (this.quad.material as THREE.ShaderMaterial).uniforms;
    u.invNear.value = 1 / camera.near;
    u.invRange.value = 1 / camera.near - 1 / camera.far;
    renderer.render(this.quad, this.cam);
  }
}

const hullMaterial = (thickness: number) => new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { ink: { value: INK } },
  vertexShader: `void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * ${thickness.toFixed(4)}, 1.0);
  }`,
  fragmentShader: `uniform vec3 ink; void main() { gl_FragColor = vec4(ink, 1.0); }`,
});

/**
 * Outline for an object drawn outside the world pass (the first-person gun): its back faces, pushed
 * out along smoothed normals and painted black, peek out around the edges.
 */
export function addHull(mesh: THREE.Mesh, thickness: number): void {
  const g = mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
  const merged = mergeVertices(g);
  merged.computeVertexNormals();
  g.dispose();
  const hull = new THREE.Mesh(merged, hullMaterial(thickness));
  hull.frustumCulled = false;
  mesh.add(hull);
}
