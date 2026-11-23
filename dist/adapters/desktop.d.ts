import type { ProjectContext, TestAdapter } from './types.js';
interface Step {
    build?: string[];
    run?: string[];
    source: string;
    component: string;
}
/** Where do we get a build/run command from? Config first; otherwise a few well-known, conservative conventions. */
export declare function desktopSteps(ctx: ProjectContext): Step[];
export declare const desktopAdapter: TestAdapter;
export {};
