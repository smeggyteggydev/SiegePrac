import * as THREE from 'three';
import { Block, VoxelWorld, blockShape, isOpaque } from '../game/World';
import { faceLayer, layerInfo, blockTextureArray } from './BlockTextures';
import { hash3 } from '../utils/noise';

const CHUNK = 16;
/** Shared time uniform for foliage sway. */
export const WORLD_TIME = { value: 0 };
const AO_CURVE = [0.42, 0.62, 0.82, 1.0];

interface FaceDef {
  n: [number, number, number];
  /** 4 corners, counter-clockwise when viewed from outside */
  c: [number, number, number][];
  kind: 'top' | 'side' | 'bottom';
}

const FACES: FaceDef[] = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], kind: 'side' },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], kind: 'side' },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], kind: 'top' },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], kind: 'bottom' },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], kind: 'side' },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], kind: 'side' },
];

/** Material shared by all world chunks: MeshStandardMaterial + texture array sampling. */
export function createWorldMaterial(): THREE.MeshStandardMaterial {
  const tex = blockTextureArray();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, alphaTest: 0.5, side: THREE.FrontSide });
  mat.userData.time = WORLD_TIME;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBlockTex = { value: tex };
    shader.uniforms.uTime = WORLD_TIME;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 atlasUv;\nattribute vec3 matProps;\nvarying vec3 vAtlasUv;\nvarying vec2 vMatProps;\nuniform float uTime;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAtlasUv = atlasUv;\nvMatProps = matProps.xy;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        if (matProps.z > 0.0) {
          float ph = position.x * 0.7 + position.z * 0.5 + position.y * 0.3;
          transformed.x += sin(uTime * 1.7 + ph) * 0.045 * matProps.z;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * 0.035 * matProps.z;
          transformed.y += sin(uTime * 2.1 + ph) * 0.02 * matProps.z;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform highp sampler2DArray uBlockTex;\nvarying vec3 vAtlasUv;\nvarying vec2 vMatProps;',
      )
      .replace('#include <map_fragment>', 'vec4 blockTexel = texture(uBlockTex, vAtlasUv);\ndiffuseColor *= blockTexel;')
      .replace('#include <alphatest_fragment>', 'if (diffuseColor.a < 0.5) discard;')
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness - vMatProps.y * 0.5;',
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness + vMatProps.y;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += blockTexel.rgb * vMatProps.x;',
      );
  };
  mat.customProgramCacheKey = () => 'siege-world-v2';
  return mat;
}

function tint(b: number, x: number, y: number, z: number): [number, number, number] {
  const h = hash3(x, y, z, b);
  const v = 0.93 + h * 0.12;
  if (b === Block.Grass || b === Block.Leaves) {
    const g = hash3(x >> 2, 0, z >> 2, 5);
    return [v * (0.92 + g * 0.12), v, v * (0.9 + g * 0.08)];
  }
  return [v, v, v];
}

export class WorldRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;

  constructor(private world: VoxelWorld) {
    this.material = createWorldMaterial();
    this.build();
  }

  private build(): void {
    const w = this.world;
    for (let cy = w.oy; cy < w.oy + w.sy; cy += CHUNK)
      for (let cz = w.oz; cz < w.oz + w.sz; cz += CHUNK)
        for (let cx = w.ox; cx < w.ox + w.sx; cx += CHUNK) {
          const geo = this.meshChunk(cx, cy, cz);
          if (!geo) continue;
          const mesh = new THREE.Mesh(geo, this.material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
        }
  }

  private meshChunk(cx: number, cy: number, cz: number): THREE.BufferGeometry | null {
    const w = this.world;
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const uvw: number[] = [];
    const mat: number[] = [];
    const idx: number[] = [];

    const solidAt = (x: number, y: number, z: number) => (isOpaque(w.get(x, y, z)) ? 1 : 0);

    for (let y = cy; y < cy + CHUNK; y++)
      for (let z = cz; z < cz + CHUNK; z++)
        for (let x = cx; x < cx + CHUNK; x++) {
          const b = w.get(x, y, z);
          if (b === Block.Air || b === Block.Barrier) continue;
          const shape = blockShape(b);
          const hgt = shape === 'slab' ? 0.5 : 1;
          const t = tint(b, x, y, z);
          for (const f of FACES) {
            const nb = w.get(x + f.n[0], y + f.n[1], z + f.n[2]);
            // Cull faces hidden by an opaque neighbour (slab tops are always visible).
            if (isOpaque(nb) && !(shape === 'slab' && f.kind === 'top')) continue;
            if (b === Block.Leaves && nb === Block.Leaves) continue;
            // A slab sits on the bottom of its cell, so it fully covers the top of the block below.
            if (f.kind === 'top' && shape === 'full' && blockShape(nb) === 'slab') continue;
            const layer = faceLayer(b as Block, f.kind);
            const info = layerInfo(layer);
            const base = pos.length / 3;
            const ao: number[] = [];
            for (const c of f.c) {
              const vx = x + c[0];
              const vy = y + c[1] * hgt;
              const vz = z + c[2];
              pos.push(vx, vy, vz);
              nor.push(f.n[0], f.n[1], f.n[2]);
              // AO: sample the three neighbours in the layer in front of this face.
              const a = aoFor(solidAt, x, y, z, f.n, c);
              ao.push(a);
              const shade = AO_CURVE[a];
              col.push(t[0] * shade, t[1] * shade, t[2] * shade);
              let u: number;
              let v: number;
              // One texture per block face (u,v in 0..1), like classic voxel games.
              if (f.kind !== 'side') {
                u = c[0];
                v = 1 - c[2];
              } else if (f.n[0] !== 0) {
                u = f.n[0] > 0 ? 1 - c[2] : c[2];
                v = c[1] * hgt;
              } else {
                u = f.n[2] > 0 ? c[0] : 1 - c[0];
                v = c[1] * hgt;
              }
              uvw.push(u, v, layer);
              mat.push(info.emit, info.metal, info.wave);
            }
            if (ao[0] + ao[2] < ao[1] + ao[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
    if (idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('atlasUv', new THREE.Float32BufferAttribute(uvw, 3));
    g.setAttribute('matProps', new THREE.Float32BufferAttribute(mat, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function aoFor(
  solidAt: (x: number, y: number, z: number) => number,
  x: number,
  y: number,
  z: number,
  n: [number, number, number],
  c: [number, number, number],
): number {
  // Position of the cell in front of the face
  const fx = x + n[0];
  const fy = y + n[1];
  const fz = z + n[2];
  // The two tangent axes: offsets toward the corner (-1 or +1) along axes perpendicular to n
  const d: number[] = [0, 0, 0];
  const axes: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (n[i] !== 0) continue;
    d[i] = c[i] === 1 ? 1 : -1;
    axes.push(i);
  }
  const s1 = [0, 0, 0];
  s1[axes[0]] = d[axes[0]];
  const s2 = [0, 0, 0];
  s2[axes[1]] = d[axes[1]];
  const side1 = solidAt(fx + s1[0], fy + s1[1], fz + s1[2]);
  const side2 = solidAt(fx + s2[0], fy + s2[1], fz + s2[2]);
  const corner = solidAt(fx + d[0], fy + d[1], fz + d[2]);
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}
