import type { FThisUpConfig } from '../core/config.js';
import type { Scenario } from '../scenarios/schema.js';
export type TargetClass = 'loopback' | 'private-network' | 'remote' | 'invalid';
export type TargetEnvironment = 'local' | 'staging' | 'production';
export interface TargetDecision {
    allowed: boolean;
    reason: string;
    /** actionable guidance when blocked */
    hint?: string;
    targetClass: TargetClass;
    environment: TargetEnvironment;
    origin?: string;
    hostname?: string;
    /** production targets are strictly read-only */
    readOnly: boolean;
    notes: string[];
}
export declare function isLoopbackHost(hostname: string): boolean;
export declare function isLinkLocalOrMetadata(hostname: string): boolean;
export declare function isPrivateNetworkHost(hostname: string): boolean;
/** Decide whether FThisUp may test this target at all. Pure function: easy to unit test. */
export declare function evaluateTarget(rawUrl: string, config: Pick<FThisUpConfig, 'safety'>): TargetDecision;
export declare function resolveSameOrigin(origin: string, p: string): string | null;
export type RequestVerdict = {
    allow: true;
} | {
    allow: false;
    reason: string;
    kind: 'external' | 'mutation' | 'budget';
};
/**
 * Enforcement object used by the executor for EVERY scenario and EVERY browser request.
 * Nothing in the scenario file can switch these checks off.
 */
export declare class SafetyGuard {
    readonly decision: TargetDecision;
    private readonly config;
    private readonly scope;
    private readonly allowedOrigins;
    private readonly allowedHostnames;
    private tokens;
    private lastRefill;
    private scenarioRequests;
    constructor(decision: TargetDecision, config: Pick<FThisUpConfig, 'safety'>, scope?: {
        isForeignPort?: (port: number) => boolean;
    });
    get origin(): string;
    get mutationsAllowed(): boolean;
    beginScenario(): void;
    private isAllowedOrigin;
    /** Static, pre-flight decision for a whole scenario. */
    checkScenario(s: Scenario): {
        allowed: boolean;
        reason?: string;
    };
    /** Runtime decision for every request the browser makes. */
    checkRequest(urlStr: string, method: string, resourceType: string): Promise<RequestVerdict>;
    get budgetExceeded(): boolean;
    /** Token bucket: caps request rate regardless of how fast scenarios run. */
    private throttle;
}
export type Sensitivity = NonNullable<Scenario['sensitivity']>;
/** Runtime approval gate for non-web adapters (CLI, API, desktop...). Same rules as the web executor. */
export declare function checkApproval(config: Pick<FThisUpConfig, 'safety'>, s: {
    requiresApproval?: boolean;
    sensitivity?: Sensitivity;
    risk?: 'low' | 'medium' | 'high';
}): {
    allowed: boolean;
    reason?: string;
};
