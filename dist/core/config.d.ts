import { z } from 'zod';
export declare const CONFIG_FILE = "fthisup.config.json";
export declare const ADAPTER_IDS: readonly ["web", "api", "cli", "python", "javascript", "flutter", "rust", "go", "java", "cpp", "swift", "desktop", "godot"];
export type AdapterId = (typeof ADAPTER_IDS)[number];
export declare const configSchema: z.ZodEffects<z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    startCommand: z.ZodOptional<z.ZodString>;
    mode: z.ZodDefault<z.ZodEnum<["safe", "thorough"]>>;
    headless: z.ZodDefault<z.ZodBoolean>;
    maxTests: z.ZodDefault<z.ZodNumber>;
    timeout: z.ZodDefault<z.ZodNumber>;
    output: z.ZodDefault<z.ZodString>;
    report: z.ZodDefault<z.ZodEnum<["html", "json", "none"]>>;
    browserChannel: z.ZodOptional<z.ZodEnum<["chrome", "msedge"]>>;
    excludeRoutes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    maxPages: z.ZodDefault<z.ZodNumber>;
    safety: z.ZodDefault<z.ZodObject<{
        /** 'local' | 'staging' | 'production' — how a NON-loopback target is classified. */
        environment: z.ZodDefault<z.ZodEnum<["local", "staging", "production"]>>;
        /** Explicit statement that you are authorized to test the non-local target. */
        authorized: z.ZodDefault<z.ZodBoolean>;
        allowedHosts: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Submit forms / send mutating requests. Default: true for loopback targets only. */
        allowFormSubmission: z.ZodOptional<z.ZodBoolean>;
        /** Sensitive actions (delete, purchase, account creation, messaging, upload...) the user explicitly approves. */
        approvedActions: z.ZodDefault<z.ZodArray<z.ZodEnum<["deletion", "purchase", "account-creation", "messaging", "upload", "irreversible"]>, "many">>;
        allowThirdPartyAssets: z.ZodDefault<z.ZodBoolean>;
        /** Hard ceiling on requests per second issued by the browser during a run. */
        maxRequestsPerSecond: z.ZodDefault<z.ZodNumber>;
        maxRequestsPerScenario: z.ZodDefault<z.ZodNumber>;
        /** OS-level isolation for processes that run project code with hostile input (Linux: bubblewrap). */
        sandbox: z.ZodDefault<z.ZodEnum<["auto", "require", "off"]>>;
        /** allow function-level fuzzing when no sandbox is available (executes project code with hostile input!) */
        allowUnsandboxedFuzzing: z.ZodDefault<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        environment: "local" | "staging" | "production";
        authorized: boolean;
        allowedHosts: string[];
        approvedActions: ("deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible")[];
        allowThirdPartyAssets: boolean;
        maxRequestsPerSecond: number;
        maxRequestsPerScenario: number;
        sandbox: "auto" | "require" | "off";
        allowUnsandboxedFuzzing: boolean;
        allowFormSubmission?: boolean | undefined;
    }, {
        environment?: "local" | "staging" | "production" | undefined;
        authorized?: boolean | undefined;
        allowedHosts?: string[] | undefined;
        allowFormSubmission?: boolean | undefined;
        approvedActions?: ("deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible")[] | undefined;
        allowThirdPartyAssets?: boolean | undefined;
        maxRequestsPerSecond?: number | undefined;
        maxRequestsPerScenario?: number | undefined;
        sandbox?: "auto" | "require" | "off" | undefined;
        allowUnsandboxedFuzzing?: boolean | undefined;
    }>>;
    auth: z.ZodOptional<z.ZodObject<{
        loginUrl: z.ZodDefault<z.ZodString>;
        usernameSelector: z.ZodDefault<z.ZodString>;
        passwordSelector: z.ZodDefault<z.ZodString>;
        submitSelector: z.ZodDefault<z.ZodString>;
        /** Names of environment variables holding the TEST account. Secrets never live in the config file. */
        usernameEnv: z.ZodDefault<z.ZodString>;
        passwordEnv: z.ZodDefault<z.ZodString>;
        protectedRoutes: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        logoutSelector: z.ZodOptional<z.ZodString>;
        /** Elements that must NOT be visible to the (non-admin) test account. */
        restrictedSelectors: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Text/selector that proves the login worked. */
        loggedInSelector: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        loginUrl: string;
        usernameSelector: string;
        passwordSelector: string;
        submitSelector: string;
        usernameEnv: string;
        passwordEnv: string;
        protectedRoutes: string[];
        restrictedSelectors: string[];
        logoutSelector?: string | undefined;
        loggedInSelector?: string | undefined;
    }, {
        loginUrl?: string | undefined;
        usernameSelector?: string | undefined;
        passwordSelector?: string | undefined;
        submitSelector?: string | undefined;
        usernameEnv?: string | undefined;
        passwordEnv?: string | undefined;
        protectedRoutes?: string[] | undefined;
        logoutSelector?: string | undefined;
        restrictedSelectors?: string[] | undefined;
        loggedInSelector?: string | undefined;
    }>>;
    autoDetect: z.ZodDefault<z.ZodBoolean>;
    /** per-adapter switch. Omitted = automatic. `true` never implies the capability is available. */
    adapters: z.ZodDefault<z.ZodRecord<z.ZodEnum<["web", "api", "cli", "python", "javascript", "flutter", "rust", "go", "java", "cpp", "swift", "desktop", "godot"]>, z.ZodBoolean>>;
    api: z.ZodOptional<z.ZodObject<{
        /** base URL of the API under test (default: the web `url`) */
        url: z.ZodOptional<z.ZodString>;
        /** path (inside the project) of an OpenAPI 3 / Swagger 2 document (JSON or YAML) */
        spec: z.ZodOptional<z.ZodString>;
        maxEndpoints: z.ZodDefault<z.ZodNumber>;
        /** max parallel requests for the controlled-concurrency check (hard cap 5) */
        concurrency: z.ZodDefault<z.ZodNumber>;
        auth: z.ZodOptional<z.ZodObject<{
            /** env var holding a TEST token (never stored in the config) */
            tokenEnv: z.ZodDefault<z.ZodString>;
            header: z.ZodDefault<z.ZodString>;
            scheme: z.ZodDefault<z.ZodString>;
            /** endpoints that must reject anonymous access, e.g. ["/admin/*", "/me"] */
            protectedPaths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strict", z.ZodTypeAny, {
            tokenEnv: string;
            header: string;
            scheme: string;
            protectedPaths: string[];
        }, {
            tokenEnv?: string | undefined;
            header?: string | undefined;
            scheme?: string | undefined;
            protectedPaths?: string[] | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        maxEndpoints: number;
        concurrency: number;
        url?: string | undefined;
        spec?: string | undefined;
        auth?: {
            tokenEnv: string;
            header: string;
            scheme: string;
            protectedPaths: string[];
        } | undefined;
    }, {
        url?: string | undefined;
        spec?: string | undefined;
        maxEndpoints?: number | undefined;
        concurrency?: number | undefined;
        auth?: {
            tokenEnv?: string | undefined;
            header?: string | undefined;
            scheme?: string | undefined;
            protectedPaths?: string[] | undefined;
        } | undefined;
    }>>;
    cli: z.ZodOptional<z.ZodObject<{
        /** Explicit commands under test. argv arrays only: never shell strings. */
        commands: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            command: z.ZodArray<z.ZodString, "many">;
            cwd: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }, {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }>, "many">>;
    }, "strict", z.ZodTypeAny, {
        commands: {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }[];
    }, {
        commands?: {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }[] | undefined;
    }>>;
    desktop: z.ZodOptional<z.ZodObject<{
        /** argv of a build step (allow-listed build tools only), e.g. ["cargo","build"] */
        build: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /** argv that starts the app, e.g. ["target/debug/myapp"] */
        run: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        startupSeconds: z.ZodDefault<z.ZodNumber>;
        /** GUI apps need a display. "auto" uses $DISPLAY or xvfb-run when present. */
        display: z.ZodDefault<z.ZodEnum<["auto", "xvfb", "none"]>>;
    }, "strict", z.ZodTypeAny, {
        startupSeconds: number;
        display: "auto" | "xvfb" | "none";
        build?: string[] | undefined;
        run?: string[] | undefined;
    }, {
        build?: string[] | undefined;
        run?: string[] | undefined;
        startupSeconds?: number | undefined;
        display?: "auto" | "xvfb" | "none" | undefined;
    }>>;
    fuzz: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** hard cap on function calls per function-under-test */
        maxCallsPerFunction: z.ZodDefault<z.ZodNumber>;
        maxFunctions: z.ZodDefault<z.ZodNumber>;
        perCallTimeoutMs: z.ZodDefault<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        enabled: boolean;
        maxCallsPerFunction: number;
        maxFunctions: number;
        perCallTimeoutMs: number;
    }, {
        enabled?: boolean | undefined;
        maxCallsPerFunction?: number | undefined;
        maxFunctions?: number | undefined;
        perCallTimeoutMs?: number | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    mode: "safe" | "thorough";
    headless: boolean;
    maxTests: number;
    timeout: number;
    output: string;
    report: "none" | "html" | "json";
    excludeRoutes: string[];
    maxPages: number;
    safety: {
        environment: "local" | "staging" | "production";
        authorized: boolean;
        allowedHosts: string[];
        approvedActions: ("deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible")[];
        allowThirdPartyAssets: boolean;
        maxRequestsPerSecond: number;
        maxRequestsPerScenario: number;
        sandbox: "auto" | "require" | "off";
        allowUnsandboxedFuzzing: boolean;
        allowFormSubmission?: boolean | undefined;
    };
    autoDetect: boolean;
    adapters: Partial<Record<"web" | "api" | "cli" | "python" | "javascript" | "flutter" | "rust" | "go" | "java" | "cpp" | "swift" | "desktop" | "godot", boolean>>;
    fuzz: {
        enabled: boolean;
        maxCallsPerFunction: number;
        maxFunctions: number;
        perCallTimeoutMs: number;
    };
    api?: {
        maxEndpoints: number;
        concurrency: number;
        url?: string | undefined;
        spec?: string | undefined;
        auth?: {
            tokenEnv: string;
            header: string;
            scheme: string;
            protectedPaths: string[];
        } | undefined;
    } | undefined;
    cli?: {
        commands: {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }[];
    } | undefined;
    desktop?: {
        startupSeconds: number;
        display: "auto" | "xvfb" | "none";
        build?: string[] | undefined;
        run?: string[] | undefined;
    } | undefined;
    url?: string | undefined;
    auth?: {
        loginUrl: string;
        usernameSelector: string;
        passwordSelector: string;
        submitSelector: string;
        usernameEnv: string;
        passwordEnv: string;
        protectedRoutes: string[];
        restrictedSelectors: string[];
        logoutSelector?: string | undefined;
        loggedInSelector?: string | undefined;
    } | undefined;
    startCommand?: string | undefined;
    browserChannel?: "chrome" | "msedge" | undefined;
}, {
    api?: {
        url?: string | undefined;
        spec?: string | undefined;
        maxEndpoints?: number | undefined;
        concurrency?: number | undefined;
        auth?: {
            tokenEnv?: string | undefined;
            header?: string | undefined;
            scheme?: string | undefined;
            protectedPaths?: string[] | undefined;
        } | undefined;
    } | undefined;
    cli?: {
        commands?: {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }[] | undefined;
    } | undefined;
    desktop?: {
        build?: string[] | undefined;
        run?: string[] | undefined;
        startupSeconds?: number | undefined;
        display?: "auto" | "xvfb" | "none" | undefined;
    } | undefined;
    url?: string | undefined;
    auth?: {
        loginUrl?: string | undefined;
        usernameSelector?: string | undefined;
        passwordSelector?: string | undefined;
        submitSelector?: string | undefined;
        usernameEnv?: string | undefined;
        passwordEnv?: string | undefined;
        protectedRoutes?: string[] | undefined;
        logoutSelector?: string | undefined;
        restrictedSelectors?: string[] | undefined;
        loggedInSelector?: string | undefined;
    } | undefined;
    startCommand?: string | undefined;
    mode?: "safe" | "thorough" | undefined;
    headless?: boolean | undefined;
    maxTests?: number | undefined;
    timeout?: number | undefined;
    output?: string | undefined;
    report?: "none" | "html" | "json" | undefined;
    browserChannel?: "chrome" | "msedge" | undefined;
    excludeRoutes?: string[] | undefined;
    maxPages?: number | undefined;
    safety?: {
        environment?: "local" | "staging" | "production" | undefined;
        authorized?: boolean | undefined;
        allowedHosts?: string[] | undefined;
        allowFormSubmission?: boolean | undefined;
        approvedActions?: ("deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible")[] | undefined;
        allowThirdPartyAssets?: boolean | undefined;
        maxRequestsPerSecond?: number | undefined;
        maxRequestsPerScenario?: number | undefined;
        sandbox?: "auto" | "require" | "off" | undefined;
        allowUnsandboxedFuzzing?: boolean | undefined;
    } | undefined;
    autoDetect?: boolean | undefined;
    adapters?: Partial<Record<"web" | "api" | "cli" | "python" | "javascript" | "flutter" | "rust" | "go" | "java" | "cpp" | "swift" | "desktop" | "godot", boolean>> | undefined;
    fuzz?: {
        enabled?: boolean | undefined;
        maxCallsPerFunction?: number | undefined;
        maxFunctions?: number | undefined;
        perCallTimeoutMs?: number | undefined;
    } | undefined;
}>, {
    mode: "safe" | "thorough";
    headless: boolean;
    maxTests: number;
    timeout: number;
    output: string;
    report: "none" | "html" | "json";
    excludeRoutes: string[];
    maxPages: number;
    safety: {
        environment: "local" | "staging" | "production";
        authorized: boolean;
        allowedHosts: string[];
        approvedActions: ("deletion" | "purchase" | "account-creation" | "messaging" | "upload" | "irreversible")[];
        allowThirdPartyAssets: boolean;
        maxRequestsPerSecond: number;
        maxRequestsPerScenario: number;
        sandbox: "auto" | "require" | "off";
        allowUnsandboxedFuzzing: boolean;
        allowFormSubmission?: boolean | undefined;
    };
    autoDetect: boolean;
    adapters: Partial<Record<"web" | "api" | "cli" | "python" | "javascript" | "flutter" | "rust" | "go" | "java" | "cpp" | "swift" | "desktop" | "godot", boolean>>;
    fuzz: {
        enabled: boolean;
        maxCallsPerFunction: number;
        maxFunctions: number;
        perCallTimeoutMs: number;
    };
    api?: {
        maxEndpoints: number;
        concurrency: number;
        url?: string | undefined;
        spec?: string | undefined;
        auth?: {
            tokenEnv: string;
            header: string;
            scheme: string;
            protectedPaths: string[];
        } | undefined;
    } | undefined;
    cli?: {
        commands: {
            name: string;
            command: string[];
            cwd?: string | undefined;
        }[];
    } | undefined;
    desktop?: {
        startupSeconds: number;
        display: "auto" | "xvfb" | "none";
        build?: string[] | undefined;
        run?: string[] | undefined;
    } | undefined;
    url?: string | undefined;
    auth?: {
        loginUrl: string;
        usernameSelector: string;
        passwordSelector: string;
        submitSelector: string;
        usernameEnv: string;
        passwordEnv: string;
        protectedRoutes: string[];
        restrictedSelectors: string[];
        logoutSelector?: string | undefined;
        loggedInSelector?: string | undefined;
    } | undefined;
    startCommand?: string | undefined;
    browserChannel?: "chrome" | "msedge" | undefined;
}, unknown>;
export type FThisUpConfig = z.infer<typeof configSchema>;
export declare class ConfigError extends Error {
}
export declare function loadConfig(cwd: string, explicitPath?: string): {
    config: FThisUpConfig;
    path?: string;
};
