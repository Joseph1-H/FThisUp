export interface FieldInfo {
    kind: 'text-field' | 'control';
    widget: string;
    key?: string;
    label?: string;
    hint?: string;
    keyboard?: string;
    hasValidator: boolean;
    obscure: boolean;
    line: number;
}
export interface ActionInfo {
    kind: 'button' | 'gesture';
    widget: string;
    key?: string;
    label?: string;
    tooltip?: string;
    gesture?: string;
    handler?: string;
    guardedWhilePending: boolean;
    line: number;
}
export interface HandlerInfo {
    name: string;
    line: number;
    async: boolean;
    awaits: number;
    persistence: string[];
    setStateAfterAwait: boolean;
    checksMounted: boolean;
    navigates: boolean;
    validates: boolean;
}
export interface CtorParam {
    name: string;
    type?: string;
    required: boolean;
}
export interface ScreenInfo {
    class: string;
    file: string;
    line: number;
    isScreen: boolean;
    stateful: boolean;
    constructor: {
        namedParams: CtorParam[];
        positionalRequired: number;
        pumpable: boolean;
        reason?: string;
    };
    dependsOn: string[];
    fields: FieldInfo[];
    actions: ActionInfo[];
    handlers: HandlerInfo[];
    navigatesTo: string[];
    persistence: string[];
    scrollables: number;
    gestures: string[];
    async: boolean;
    dynamicList: boolean;
    covered: boolean;
    uncoveredInteractions: string[];
    risk: number;
    riskReasons: string[];
}
export interface ExistingTests {
    files: string[];
    testCount: number;
    widgetTestCount: number;
    referencedClasses: string[];
}
export interface FlutterAppMap {
    adapter: 'flutter';
    component: string;
    package: string;
    fthisupVersion: string;
    generatedAt: string;
    integrations: string[];
    screens: ScreenInfo[];
    models: Array<{
        class: string;
        file: string;
        serializes: boolean;
    }>;
    services: Array<{
        class: string;
        file: string;
        persistence: string[];
    }>;
    keysInSource: string[];
    existingTests: ExistingTests;
    supabase: {
        used: boolean;
        tables: string[];
        operations: string[];
        hardCodedEndpoints: string[];
    };
    runtime: {
        integrationTestDir: boolean;
        integrationTestDependency: boolean;
    };
    totals: Record<string, number>;
    limitations: string[];
}
export declare function buildFlutterMap(root: string, compPath: string, version: string): FlutterAppMap;
