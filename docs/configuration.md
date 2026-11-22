# Configuration

`npx fthisup init` writes `fthisup.config.json` (strict JSON, validated with Zod; unknown keys are errors). CLI flags override the file.

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

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Ran; no confirmed issues (or `--exit-zero`) |
| 1 | Confirmed issues found |
| 2 | Blocked by safety policy or invalid configuration/options |
| 3 | Target application unreachable |
| 4 | Environment problem (browser missing, unexpected error) |
