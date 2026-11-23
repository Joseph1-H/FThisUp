import type { ActionInfo, FlutterAppMap, ScreenInfo } from './map.js';
import type { Finder, FlutterScenario } from './schema.js';
export declare function primaryAction(s: ScreenInfo): {
    action: ActionInfo;
    finder: Finder;
} | undefined;
export interface SeedResult {
    scenarios: FlutterScenario[];
    skipped: Array<{
        screen: string;
        reason: string;
    }>;
}
export declare function seedScenarios(map: FlutterAppMap, max?: number): SeedResult;
