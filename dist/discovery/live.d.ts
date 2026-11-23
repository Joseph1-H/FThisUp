import type { Browser } from 'playwright';
import type { SafetyGuard } from '../safety/policy.js';
import type { LiveDiscovery } from './types.js';
export declare function globToRegExp(glob: string): RegExp;
export declare function isExcluded(p: string, patterns: string[]): boolean;
export declare function discoverLive(browser: Browser, guard: SafetyGuard, opts: {
    seeds?: string[];
    maxPages: number;
    excludeRoutes: string[];
    protectedRoutes?: string[];
    timeout: number;
}): Promise<LiveDiscovery>;
