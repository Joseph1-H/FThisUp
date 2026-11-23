import type { TestAdapter } from './types.js';
export interface GodotIssue {
    kind: 'missing-main-scene' | 'missing-autoload' | 'missing-resource' | 'missing-script' | 'no-main-scene';
    message: string;
    file: string;
}
/** Real, static checks of a Godot project: everything the project references must exist. Verifiable without the engine. */
export declare function validateGodotProject(dir: string): {
    issues: GodotIssue[];
    scenes: number;
    scripts: number;
};
export declare const godotAdapter: TestAdapter;
