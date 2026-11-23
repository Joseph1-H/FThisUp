export type Certainty = 'confirmed' | 'inferred';
export interface Item<T = string> {
    value: T;
    certainty: Certainty;
    /** where this came from, e.g. "package.json" or "src/App.tsx:12" */
    source: string;
}
export interface FieldInfo {
    index: number;
    tag: string;
    type: string;
    name: string;
    id: string;
    required: boolean;
    pattern?: string;
    min?: string;
    max?: string;
    maxLength?: number;
    label?: string;
}
export interface FormInfo {
    id: string;
    selector: string;
    action: string;
    method: string;
    noValidate: boolean;
    fields: FieldInfo[];
    submit?: {
        selector: string;
        text: string;
    };
    text: string;
    hasConstraints: boolean;
    hasPassword: boolean;
    hasFile: boolean;
}
export interface ButtonInfo {
    selector: string;
    text: string;
}
export interface PageInfo {
    path: string;
    status: number | null;
    title: string;
    linkedFrom?: string;
    finalPath?: string;
    forms: FormInfo[];
    buttons: ButtonInfo[];
    links: string[];
    apiCalls: Array<{
        method: string;
        path: string;
    }>;
    loadErrors: string[];
}
export interface LiveDiscovery {
    origin: string;
    pages: PageInfo[];
    skippedRoutes: Array<{
        path: string;
        reason: string;
    }>;
    truncated: boolean;
}
export interface ProjectDiscovery {
    root: string;
    name: string;
    framework: Item<string> | null;
    language: Item<string>[];
    testFrameworks: Item[];
    startCommands: Item[];
    likelyPort: Item<number> | null;
    routes: Item[];
    forms: Array<Item<string> & {
        line: number;
    }>;
    authSignals: Item[];
    apiIntegrations: Item[];
    unsupportedPlatforms: Item[];
    notes: string[];
    filesScanned: number;
}
export interface Manifest {
    schemaVersion: 1;
    generatedAt: string;
    project: ProjectDiscovery;
    live: LiveDiscovery | null;
    /** static-analysis warnings (heuristic; unconfirmed until executed) */
    warnings: import('../core/types.js').Finding[];
    legend: {
        confirmed: string;
        inferred: string;
    };
}
