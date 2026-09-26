import * as THREE from 'three';
import type { ItemId } from './Items';

/**
 * Stylised weapon meshes, shared by the first-person view model and the
 * third-person fighter models. All are built along +Y with the grip at origin.
 */

const steel = () => new THREE.MeshStandardMaterial({ color: '#d7dde6', metalness: 0.92, roughness: 0.22 });
const gold = () => new THREE.MeshStandardMaterial({ color: '#c99a4a', metalness: 0.85, roughness: 0.32 });
const leather = () => new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 0.85 });

function bladeGeometry(len: number, width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width, 0);
  s.lineTo(-width, len - width * 2.2);
  s.lineTo(0, len);
  s.lineTo(width, len - width * 2.2);
  s.lineTo(width, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.012,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -0.006);
  g.computeVertexNormals();
  return g;
}

export function buildSword(accent = '#7fd8ff'): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(bladeGeometry(0.78, 0.042), steel());
  blade.position.y = 0.12;
  blade.castShadow = true;
  g.add(blade);
  // glowing fuller — the Siege Blade's signature line
  const fuller = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.56, 0.05),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.6, roughness: 0.3 }),
  );
  fuller.position.y = 0.12 + 0.33;
  g.add(fuller);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.07), gold());
  guard.position.y = 0.11;
  guard.castShadow = true;
  g.add(guard);
  for (const sx of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.07), gold());
    tip.position.set(sx * 0.14, 0.125, 0);
    g.add(tip);
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.045), leather());
  grip.position.y = 0.0;
  g.add(grip);
  const pommel = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.04, 0),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.2 }),
  );
  pommel.position.y = -0.12;
  g.add(pommel);
  g.userData.tipLocal = new THREE.Vector3(0, 0.9, 0);
  g.userData.baseLocal = new THREE.Vector3(0, 0.2, 0);
  return g;
}

export function buildAxe(): THREE.Group {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.78, 0.05),
    new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.8 }),
  );
  handle.position.y = 0.28;
  handle.castShadow = true;
  g.add(handle);
  const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.2, 0.058), leather());
  wrap.position.y = 0.0;
  g.add(wrap);
  const s = new THREE.Shape();
  s.moveTo(0, -0.1);
  s.lineTo(0.12, -0.14);
  s.quadraticCurveTo(0.26, 0, 0.12, 0.16);
  s.lineTo(0, 0.1);
  s.closePath();
  const head = new THREE.Mesh(
    new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 1 }),
    steel(),
  );
  head.position.set(0.02, 0.58, -0.01);
  head.castShadow = true;
  g.add(head);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.06), gold());
  back.position.set(-0.03, 0.58, 0);
  g.add(back);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.26, 0.05),
    new THREE.MeshStandardMaterial({ color: '#ffb35c', emissive: '#ffb35c', emissiveIntensity: 1.3 }),
  );
  edge.position.set(0.215, 0.595, 0);
  g.add(edge);
  g.userData.tipLocal = new THREE.Vector3(0.22, 0.6, 0);
  g.userData.baseLocal = new THREE.Vector3(0.02, 0.5, 0);
  return g;
}

export function buildGapple(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffcc3a', metalness: 0.6, roughness: 0.25, emissive: '#6a4a00', emissiveIntensity: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), mat);
  body.position.y = 0.08;
  g.add(body);
  const body2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12), mat);
  body2.position.y = 0.08;
  g.add(body2);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: '#5a3a1a' }));
  stem.position.y = 0.19;
  g.add(stem);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.03), new THREE.MeshStandardMaterial({ color: '#5fa83a' }));
  leaf.position.set(0.035, 0.2, 0);
  leaf.rotation.z = 0.4;
  g.add(leaf);
  return g;
}

export function buildItem(id: ItemId | null): THREE.Group {
  if (id === 'sword') return buildSword();
  if (id === 'axe') return buildAxe();
  if (id === 'gapple') return buildGapple();
  return new THREE.Group();
}
