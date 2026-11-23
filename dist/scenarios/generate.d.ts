import type { FThisUpConfig } from '../core/config.js';
import type { LiveDiscovery } from '../discovery/types.js';
import type { Scenario } from './schema.js';
export interface GenInput {
    live: LiveDiscovery;
    staticRoutes: string[];
    config: FThisUpConfig;
}
export declare function generateScenarios(input: GenInput): Scenario[];
