import { probeUrl } from '../core/runner.js';

const COMMON = [3000, 5173, 4173, 8080, 4200, 8000, 5000, 3001, 4321, 8081, 5174, 9000];

/** Probe loopback only. Never scans any other host. */
export async function detectLocalUrl(preferred?: number, accept: (port: number) => boolean = () => true): Promise<string | null> {
  const ports = [...new Set([...(preferred ? [preferred] : []), ...COMMON])].filter(accept);
  const checks = await Promise.all(ports.map(async (p) => {
    const url = `http://localhost:${p}`;
    const r = await probeUrl(url, 800);
    return r.ok ? url : null;
  }));
  return checks.find(Boolean) ?? null;
}
