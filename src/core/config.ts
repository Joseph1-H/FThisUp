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

export const configSchema = z
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
      })
      .strict()
      .default({}),
    auth: authSchema.optional(),
  })
  .strict();

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
