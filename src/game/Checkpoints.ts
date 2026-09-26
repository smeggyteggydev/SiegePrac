import * as THREE from 'three';
import type { VoxelWorld } from './World';
import type { Fighter } from '../entities/Fighter';

/** Movement drill course: glowing beacons you run through in order. */
export class Checkpoints {
  readonly group = new THREE.Group();
  private points: { x: number; y: number; z: number }[];
  private beacon: THREE.Mesh;
  private ring: THREE.Mesh;
  private next: THREE.Mesh;
  index = 0;
  elapsed = 0;
  started = false;
  splits: number[] = [];
  private active = false;
  private startPos = new THREE.Vector3();

  constructor(world: VoxelWorld) {
    this.points = world.markers.get('checkpoint') ?? [];
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffb347') } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float a = (1.0 - vUv.y) * (0.35 + 0.15 * sin(vUv.y * 30.0 - uTime * 6.0)); gl_FragColor = vec4(uColor * a, a); }`,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 14, 24, 1, true), beamMat);
    this.beacon.geometry.translate(0, 7, 0);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.06, 8, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd28a', toneMapped: false }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.next = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.next.geometry.translate(0, 3, 0);
    this.group.add(this.beacon, this.ring, this.next);
    this.group.visible = false;
  }

  get count(): number {
    return this.points.length;
  }

  setActive(v: boolean): void {
    this.active = v;
    this.group.visible = v;
    this.reset();
  }

  reset(): void {
    this.index = 0;
    this.elapsed = 0;
    this.started = false;
    this.splits = [];
    this.startPos.set(NaN, NaN, NaN);
  }

  update(f: Fighter, dt: number): 'none' | 'hit' | 'done' {
    if (!this.active || this.index >= this.points.length) return 'none';
    if (Number.isNaN(this.startPos.x)) this.startPos.copy(f.pos);
    if (!this.started && f.pos.distanceTo(this.startPos) > 0.3) this.started = true;
    if (this.started) this.elapsed += dt;
    const p = this.points[this.index];
    const dx = f.pos.x - p.x;
    const dz = f.pos.z - p.z;
    if (Math.hypot(dx, dz) < 1.3 && Math.abs(f.pos.y - p.y) < 1.6) {
      this.splits.push(this.elapsed);
      this.index++;
      return this.index >= this.points.length ? 'done' : 'hit';
    }
    return 'none';
  }

  render(t: number): void {
    if (!this.active) return;
    const p = this.points[Math.min(this.index, this.points.length - 1)];
    this.beacon.position.set(p.x, p.y, p.z);
    this.ring.position.set(p.x, p.y + 0.1 + Math.sin(t * 3) * 0.05, p.z);
    this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
    (this.beacon.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    const n = this.points[this.index + 1];
    this.next.visible = !!n;
    if (n) this.next.position.set(n.x, n.y, n.z);
  }
}
