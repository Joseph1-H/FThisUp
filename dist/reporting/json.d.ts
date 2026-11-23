import type { RunResults } from '../core/types.js';
import type { Manifest } from '../discovery/types.js';
export declare function writeResultsJson(dir: string, results: RunResults): string;
export declare function writeManifest(dir: string, manifest: Manifest): string;
export declare function readResults(dir: string): RunResults;
export declare function writeJsonFile(dir: string, name: string, data: unknown): string;
