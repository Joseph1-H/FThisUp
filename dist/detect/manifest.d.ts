import type { Confidence } from '../core/types.js';
export type Ecosystem = 'node' | 'python' | 'rust' | 'go' | 'flutter' | 'java' | 'cpp' | 'swift' | 'godot' | 'dotnet' | 'ruby' | 'php' | 'static-web';
export type Role = 'web-app' | 'api' | 'cli' | 'library' | 'mobile-app' | 'desktop-app' | 'game' | 'unknown';
export type RunnerId = 'npm-test' | 'node-test' | 'vitest' | 'jest' | 'mocha' | 'pytest' | 'unittest' | 'cargo' | 'go' | 'flutter' | 'dart' | 'maven' | 'gradle' | 'ctest' | 'make' | 'swift' | 'meson';
export interface TestCommand {
    runner: RunnerId;
    file: string;
    args: string[];
    /** relative to the component directory */
    source: string;
    available: boolean;
    /** why it is unavailable */
    reason?: string;
    /** user-run command that would fix it (FThisUp never runs it) */
    setup?: string;
}
export interface Component {
    id: string;
    /** posix path relative to the project root ('.' for the root) */
    path: string;
    ecosystem: Ecosystem;
    roles: Role[];
    languages: string[];
    frameworks: string[];
    buildSystems: string[];
    packageManagers: string[];
    testFrameworks: string[];
    entryPoints: string[];
    integrations: string[];
    testFiles: number;
    testCommands: TestCommand[];
    /** extra analysis commands (flutter analyze ...) */
    analyzers: TestCommand[];
    confidence: Confidence;
    evidence: string[];
    notes: string[];
    /** candidate adapter ids (candidate != available; the adapter decides) */
    adapters: string[];
}
export interface ProjectManifest {
    schemaVersion: 1;
    root: string;
    generatedAt: string;
    components: Component[];
    tools: Record<string, string | null>;
    notes: string[];
}
export declare function detectProjectManifest(root: string): ProjectManifest;
