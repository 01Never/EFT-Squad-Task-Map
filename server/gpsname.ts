// Parse the position the game writes into in-raid screenshot file names, e.g.
//   2026-10-01[14-05]_-120.53, 3.10, 210.77_0.00000, 0.70711, 0.00000, 0.70711 (0).png
// (date[HH-MM]_x, y, z_qx, qy, qz, qw (n).ext). Pure; no I/O.

export type GpsFix = { x: number; y: number; z: number; yaw: number };

const NAME = /^\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(.+?)\s*\(\d+\)\.(png|jpe?g|bmp)$/i;
const POS = /^(-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+)_?(-?\d*\.\d+), (-?\d*\.\d+), (-?\d*\.\d+), (-?\d*\.\d+)/;

export function isGpsName(name: string) { return parseGpsName(name) !== null; }

export function parseGpsName(name: string): GpsFix | null {
  const m = name.match(NAME);
  if (!m) return null;
  const p = m[1].match(POS);
  if (!p) return null;
  const [x, y, z, qx, qy, qz, qw] = p.slice(1, 8).map(Number);
  if (![x, y, z, qx, qy, qz, qw].every(isFinite)) return null;
  return { x, y, z, yaw: yawFromQuaternion(qx, qy, qz, qw) };
}

/**
 * Heading in degrees from the file's quaternion. The game's file order is treated the same way
 * TarkovMonitor does (its yaw function receives the components as x, z, y, w), which is what
 * tarkov.dev's map expects for its player arrow.
 */
export function yawFromQuaternion(qx: number, qy: number, qz: number, qw: number): number {
  const x = qx, z = qy, y = qz, w = qw;
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  return (Math.atan2(siny, cosy) * 180) / Math.PI;
}

export const IMAGE_EXT = /\.(png|jpe?g|bmp)$/i;
