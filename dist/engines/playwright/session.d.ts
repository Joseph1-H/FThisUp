import type { Browser, BrowserContext, Page, Request } from 'playwright';
import type { SafetyGuard } from '../../safety/policy.js';
import type { ConsoleEntry, Evidence, NetworkEntry } from '../../core/types.js';
export type NetMode = 'offline' | 'http500' | 'http429' | 'slow' | 'timeout';
export declare class Recorder {
    consoleErrors: ConsoleEntry[];
    pageErrors: string[];
    failures: NetworkEntry[];
    responses: NetworkEntry[];
    mutating: NetworkEntry[];
    blocked: NetworkEntry[];
    apiCalls: NetworkEntry[];
    injectedHits: number;
    navigations: string[];
    redirectLoop: boolean;
    xssTriggered: boolean;
    budgetExceeded: boolean;
    mainStatus: number | null;
    notes: string[];
    toEvidence(): Evidence;
}
export declare class Session {
    readonly context: BrowserContext;
    readonly page: Page;
    readonly recorder: Recorder;
    readonly guard: SafetyGuard;
    net: {
        mode: NetMode | null;
        delayMs?: number;
    };
    readonly injected: WeakSet<Request>;
    constructor(context: BrowserContext, page: Page, recorder: Recorder, guard: SafetyGuard);
    setNetwork(mode: NetMode, delayMs?: number): Promise<void>;
    clearNetwork(): Promise<void>;
    close(): Promise<void>;
}
export declare function createSession(browser: Browser, guard: SafetyGuard, opts?: {
    viewport?: {
        width: number;
        height: number;
    };
    secrets?: string[];
}): Promise<Session>;
/** Wait for the page to be reasonably quiet without hanging on long-polling apps. */
export declare function settle(page: Page, ms?: number): Promise<void>;
