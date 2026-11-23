# Configuration

`fthisup init` writes `fthisup.config.json` (strict JSON, validated with Zod; unknown keys are errors). CLI flags override the file.

```json
{
  "url": "http://localhost:3000",
  "startCommand": "npm run dev",
  "mode": "safe",
  "headless": true,
  "maxTests": 100,
  "timeout": 30000,
  "output": "./fthisup-results",
  "report": "html",
  "excludeRoutes": ["/admin/*", "/logout"],
  "maxPages": 25,
  "safety": {
    "environment": "local",
    "authorized": false,
    "allowedHosts": [],
    "allowFormSubmission": true,
    "approvedActions": [],
    "allowThirdPartyAssets": false,
    "maxRequestsPerSecond": 20,
    "maxRequestsPerScenario": 300
  },
  "auth": {
    "loginUrl": "/login",
    "usernameSelector": "input[name=\"email\"]",
    "passwordSelector": "input[type=\"password\"]",
    "submitSelector": "button[type=\"submit\"]",
    "usernameEnv": "FTHISUP_TEST_USER",
    "passwordEnv": "FTHISUP_TEST_PASSWORD",
    "protectedRoutes": ["/dashboard"],
    "logoutSelector": "#logout",
    "restrictedSelectors": ["#admin-panel"],
    "loggedInSelector": "#account-menu"
  }
}
```

| Key | Meaning |
|---|---|
| `url` | Target. If omitted, FThisUp probes common **loopback** ports (3000, 5173, 4173, 8080, ...). |
| `startCommand` | Used only with `--start`: FThisUp runs *your* command, waits for the URL, and stops it afterwards. |
| `mode` | `safe` (default): a focused set of checks per page/form. `thorough`: more pages, forms, buttons and viewports per run. Neither mode weakens the safety policy. |
| `maxTests` | Cap on scenarios; scenarios are interleaved across categories so a cap never drops a whole category. Anything dropped is reported in the coverage notes. |
| `timeout` | Per-navigation / per-scenario budget in ms. |
| `excludeRoutes` | Glob patterns (`*` within a segment, `**` across segments) never visited. Routes like `/logout` and `/delete` are always skipped. |
| `safety.*` | See [safety.md](safety.md). |
| `auth.*` | Enables authentication scenarios. Credentials come **only** from the environment variables named by `usernameEnv`/`passwordEnv`; they are never read from the config file and are scrubbed from all output. |

## Universal options (v0.2)

```json
{
  "autoDetect": true,
  "adapters": { "web": true, "api": true, "cli": true, "python": true, "javascript": true, "flutter": true, "desktop": false, "godot": true },
  "report": { "html": true, "json": true },
  "timeoutMs": 30000,
  "api": { "url": "http://localhost:8000", "spec": "openapi.json", "maxEndpoints": 40, "concurrency": 3,
           "auth": { "tokenEnv": "FTHISUP_API_TOKEN", "header": "Authorization", "scheme": "Bearer", "protectedPaths": ["/admin/*"] } },
  "cli": { "commands": [ { "name": "mytool", "command": ["node", "bin/mytool.js"] } ] },
  "desktop": { "build": ["cargo", "build"], "run": ["target/debug/myapp"], "startupSeconds": 8, "display": "auto" },
  "fuzz": { "enabled": true, "maxCallsPerFunction": 60, "maxFunctions": 25, "perCallTimeoutMs": 4000 },
  "safety": { "sandbox": "auto", "allowUnsandboxedFuzzing": false }
}
```

| Key | Meaning |
|---|---|
| `autoDetect` | Pick adapters automatically (default). With `false`, only adapters set to `true` run. |
| `adapters.<id>` | `false` = never run, `true` = don't skip (opt-in adapters such as `desktop` need this or `--adapter`/`--all`). **Never implies the adapter's prerequisites exist**: unavailable adapters are reported as such. Ids: `web api cli python javascript flutter rust go java cpp swift desktop godot`. |
| `report` | `"html"`/`"json"`/`"none"`, or `{ "html": bool, "json": bool }`. `results.json` is always written. |
| `timeoutMs` | Alias of `timeout`. |
| `api.url` | API base URL (default: `--url`). `api.spec` points to an OpenAPI 3/Swagger 2 file inside the project (JSON or YAML); otherwise `openapi.json|yaml` is searched for, then `/openapi.json` on the running API, then route definitions in source. `api.auth.protectedPaths` must reject anonymous access; the test token comes only from `$tokenEnv`. |
| `cli.commands` | Explicit CLI targets (argv arrays, never shell strings). Auto-detected: `package.json` `bin`, Python `__main__.py`/argparse `main.py`, existing cargo debug builds. |
| `desktop` | Build and run argv for the opt-in desktop adapter; `display`: `auto` (xvfb if installed, else `$DISPLAY`), `xvfb`, `none`. |
| `fuzz` | Bounds for function-level fuzzing (calls per function, functions per module, per-call timeout). |
| `safety.sandbox` | `auto` / `require` / `off` (see safety.md). |

CLI flags added in v0.2: `--adapter <ids...>`, `--all`, `--api-url <url>`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Ran; no confirmed issues (or `--exit-zero`) |
| 1 | Confirmed issues found |
| 2 | Blocked by safety policy or invalid configuration/options |
| 3 | Target unreachable, or nothing could be executed |
| 4 | An explicitly requested adapter cannot run, or an environment problem (browser missing, unexpected error) |


## `discovery` (v0.3)
```json
{ "discovery": { "scenariosDir": "./fthisup-scenarios", "seed": true, "maxScenarios": 24, "maxExecuted": 20, "reproAttempts": 2, "testTimeoutSeconds": 60, "totalTimeoutSeconds": 420 } }
```
Only used with `fthisup test --discovery`. `seed: false` runs only agent-written scenarios. See [autonomous-discovery.md](autonomous-discovery.md).
