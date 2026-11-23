import type { FThisUpConfig } from './config.js';
import type { Target } from '../adapters/types.js';
/** CLI flag > config "url" > a local server found on a common loopback port that belongs to THIS project. */
export declare function resolveTarget(root: string, config: FThisUpConfig, explicit?: string): Promise<Target>;
