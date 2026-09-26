export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Shortest signed angle from a to b. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}
/** Yaw (our convention: 0 looks toward -Z) that faces from (ax,az) to (bx,bz). */
export function yawTo(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(-(bx - ax), -(bz - az));
}
