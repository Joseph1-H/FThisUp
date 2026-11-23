import { type ApiExpectation, type ApiScenario } from '../scenarios/api-schema.js';
import { type ApiEndpoint, type ApiSpec, type Schema } from './openapi.js';
import type { TestAdapter } from './types.js';
interface Req {
    method: string;
    path: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
    contentType?: string | null;
    auth?: 'none' | 'invalid' | 'valid';
    parallel?: number;
}
type Exp = ApiExpectation | {
    type: 'rejects4xx';
    hard: boolean;
} | {
    type: 'declaredStatus';
} | {
    type: 'matchesSchema';
    schema?: Schema;
    hard: boolean;
} | {
    type: 'noConnectionError';
} | {
    type: 'consistentUnderConcurrency';
} | {
    type: 'authRejects';
    hard: boolean;
} | {
    type: 'authAccepts';
};
interface Probe {
    id: string;
    name: string;
    kind: string;
    ep?: ApiEndpoint;
    req: Req;
    expect: Exp[];
    risk: 'low' | 'medium' | 'high';
    mutating: boolean;
    sensitivity?: ApiScenario['sensitivity'];
    origin: 'heuristic' | 'agent';
    priority: number;
    declared?: string[];
}
export declare function generateProbes(spec: ApiSpec | null, endpoints: ApiEndpoint[], opts: {
    protectedPaths: string[];
    concurrency: number;
    allowMutations: boolean;
}): Probe[];
export declare const apiAdapter: TestAdapter;
export {};
