import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'fthisup.config.json';

const authSchema = z
  .object({
    loginUrl: z.string().default('/login'),
    usernameSelector: z.string().default('input[name="email"], input[name="username"], input[type="email"]'),
    passwordSelector: z.string().default('input[type="password"]'),
    submitSelector: z.string().default('button[type="submit"]'),
    /** Names of environment variables holding the TEST account. Secrets never live in the config file. */
    usernameEnv: z.string().default('FTHISUP_TEST_USER'),
    passwordEnv: z.string().default('FTHISUP_TEST_PASSWORD'),
    protectedRoutes: z.array(z.string()).default([]),
    logoutSelector: z.string().optional(),
    /** Elements that must NOT be visible to the (non-admin) test account. */
    restrictedSelectors: z.array(z.string()).default([]),
    /** Text/selector that proves the login worked. */
    loggedInSelector: z.string().optional(),
  })
  .strict();

export const ADAPTER_IDS = ['web', 'api', 'cli', 'python', 'javascript', 'flutter', 'rust', 'go', 'java', 'cpp', 'swift', 'desktop', 'godot'] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

const apiSchema = z
  .object({
    /** base URL of the API under test (default: the web `url`) */
    url: z.string().url().optional(),
    /** path (inside the project) of an OpenAPI 3 / Swagger 2 document (JSON or YAML) */
    spec: z.string().optional(),
    maxEndpoints: z.number().int().min(1).max(200).default(40),
    /** max parallel requests for the controlled-concurrency check (hard cap 5) */
    concurrency: z.number().int().min(1).max(5).default(3),
    auth: z
      .object({
        /** env var holding a TEST token (never stored in the config) */
        tokenEnv: z.string().default('FTHISUP_API_TOKEN'),
        header: z.string().default('Authorization'),
        scheme: z.string().default('Bearer'),
        /** endpoints that must reject anonymous access, e.g. ["/admin/*", "/me"] */
        protectedPaths: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

const cliSchema = z
  .object({
    /** Explicit commands under test. argv arrays only: never shell strings. */
    commands: z
      .array(z.object({ name: z.string().min(1).max(60), command: z.array(z.string().min(1).max(500)).min(1).max(20), cwd: z.string().optional() }).strict())
      .default([]),
  })
  .strict();

const desktopSchema = z
  .object({
    /** argv of a build step (allow-listed build tools only), e.g. ["cargo","build"] */
    build: z.array(z.string().min(1)).min(1).optional(),
    /** argv that starts the app, e.g. ["target/debug/myapp"] */
    run: z.array(z.string().min(1)).min(1).optional(),
    startupSeconds: z.number().min(1).max(60).default(8),
    /** GUI apps need a display. "auto" uses $DISPLAY or xvfb-run when present. */
    display: z.enum(['auto', 'xvfb', 'none']).default('auto'),
  })
  .strict();

const discoverySchema = z
  .object({
    /** where the host agent drops typed scenario files for the engine (inside the project) */
    scenariosDir: z.string().default('./fthisup-scenarios'),
    /** also run engine-seeded invariant scenarios derived from the app map (no agent needed) */
    seed: z.boolean().default(true),
    /** budgets (thorough mode multiplies them) */
    maxScenarios: z.number().int().min(1).max(300).default(24),
    maxExecuted: z.number().int().min(1).max(300).default(20),
    reproAttempts: z.number().int().min(1).max(5).default(2),
    testTimeoutSeconds: z.number().int().min(10).max(600).default(60),
    /** wall-clock budget for the whole generated-test phase */
    totalTimeoutSeconds: z.number().int().min(30).max(3600).default(420),
  })
  .strict();

const fuzzSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** hard cap on function calls per function-under-test */
    maxCallsPerFunction: z.number().int().min(1).max(500).default(60),
    maxFunctions: z.number().int().min(1).max(200).default(25),
    perCallTimeoutMs: z.number().int().min(200).max(30000).default(4000),
  })
  .strict();

const normalizeConfig = (raw: unknown) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (r.timeoutMs !== undefined && r.timeout === undefined) r.timeout = r.timeoutMs;
  delete r.timeoutMs;
  if (r.report && typeof r.report === 'object') {
    const o = r.report as { html?: boolean; json?: boolean };
    r.report = o.html === false ? (o.json === false ? 'none' : 'json') : 'html';
  }
  return r;
};

const baseConfig = z
  .object({
    url: z.string().url().optional(),
    startCommand: z.string().optional(),
    mode: z.enum(['safe', 'thorough']).default('safe'),
    headless: z.boolean().default(true),
    maxTests: z.number().int().min(1).max(1000).default(100),
    timeout: z.number().int().min(1000).max(120000).default(30000),
    output: z.string().default('./fthisup-results'),
    report: z.enum(['html', 'json', 'none']).default('html'),
    browserChannel: z.enum(['chrome', 'msedge']).optional(),
    excludeRoutes: z.array(z.string()).default([]),
    maxPages: z.number().int().min(1).max(200).default(25),
    safety: z
      .object({
        /** 'local' | 'staging' | 'production' — how a NON-loopback target is classified. */
        environment: z.enum(['local', 'staging', 'production']).default('local'),
        /** Explicit statement that you are authorized to test the non-local target. */
        authorized: z.boolean().default(false),
        allowedHosts: z.array(z.string()).default([]),
        /** Submit forms / send mutating requests. Default: true for loopback targets only. */
        allowFormSubmission: z.boolean().optional(),
        /** Sensitive actions (delete, purchase, account creation, messaging, upload...) the user explicitly approves. */
        approvedActions: z
          .array(z.enum(['deletion', 'purchase', 'account-creation', 'messaging', 'upload', 'irreversible']))
          .default([]),
        allowThirdPartyAssets: z.boolean().default(false),
        /** Hard ceiling on requests per second issued by the browser during a run. */
        maxRequestsPerSecond: z.number().min(1).max(50).default(20),
        maxRequestsPerScenario: z.number().int().min(10).max(2000).default(300),
        /** OS-level isolation for processes that run project code with hostile input (Linux: bubblewrap). */
        sandbox: z.enum(['auto', 'require', 'off']).default('auto'),
        /** allow function-level fuzzing when no sandbox is available (executes project code with hostile input!) */
        allowUnsandboxedFuzzing: z.boolean().default(false),
      })
      .strict()
      .default({}),
    auth: authSchema.optional(),
    autoDetect: z.boolean().default(true),
    /** per-adapter switch. Omitted = automatic. `true` never implies the capability is available. */
    adapters: z.record(z.enum(ADAPTER_IDS), z.boolean()).default({}),
    api: apiSchema.optional(),
    cli: cliSchema.optional(),
    desktop: desktopSchema.optional(),
    fuzz: fuzzSchema.default({}),
    discovery: discoverySchema.default({}),
  })
  .strict();

export const configSchema = z.preprocess(normalizeConfig, baseConfig);

export type FThisUpConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {}

export function loadConfig(cwd: string, explicitPath?: string): { config: FThisUpConfig; path?: string } {
  const file = explicitPath ? path.resolve(cwd, explicitPath) : path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    if (explicitPath) throw new ConfigError(`Config file not found: ${file}`);
    return { config: configSchema.parse({}) };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`Could not parse ${file} as JSON: ${(e as Error).message}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid ${path.basename(file)}:\n${issues}`);
  }
  return { config: parsed.data, path: file };
}
