import * as THREE from 'three';
import { buildItem } from '../weapons/WeaponMeshes';
import type { ItemId } from '../weapons/Items';

const cache = new Map<ItemId, string>();

/**
 * Renders the actual 3D item meshes to small images once at startup, so
 * inventory/hotbar icons match what you hold in your hand exactly.
 */
export function renderItemIcons(renderer: THREE.WebGLRenderer, env: THREE.Texture | null): void {
  const size = 128;
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const scene = new THREE.Scene();
  scene.environment = env;
  scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a45', 1.4));
  const key = new THREE.DirectionalLight('#fff1dd', 2.6);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fd0ff', 1.4);
  rim.position.set(-3, -1, -2);
  scene.add(rim);
  const cam = new THREE.OrthographicCamera(-0.6, 0.6, 0.6, -0.6, 0.1, 10);
  cam.position.set(0, 0, 5);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.setClearColor(0x000000, 0);
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  for (const id of ['sword', 'axe', 'gapple'] as ItemId[]) {
    const g = buildItem(id);
    const pivot = new THREE.Group();
    pivot.add(g);
    if (id === 'gapple') {
      g.position.set(0, -0.12, 0);
      pivot.scale.setScalar(3.2);
      pivot.rotation.set(0.35, 0.6, 0);
    } else {
      g.position.set(0, id === 'axe' ? -0.33 : -0.4, 0);
      pivot.rotation.set(0.25, 0.35, -Math.PI / 4);
      pivot.scale.setScalar(id === 'axe' ? 1.25 : 1.05);
    }
    scene.add(pivot);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size * 4;
      img.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
    }
    // linear → sRGB-ish for display
    for (let i = 0; i < img.data.length; i += 4) {
      for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(Math.pow(img.data[i + c] / 255, 1 / 2.2) * 255);
    }
    ctx.clearRect(0, 0, size, size);
    ctx.putImageData(img, 0, 0);
    cache.set(id, canvas.toDataURL('image/png'));
    scene.remove(pivot);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  renderer.toneMapping = prevTone;
  rt.dispose();
}

export function itemIcon(id: ItemId): string {
  return cache.get(id) ?? '';
}
