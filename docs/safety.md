# Safety model

> v0.2 generalizes this beyond the browser: the same rules now apply to the API adapter (same `SafetyGuard`), and a new execution layer (`src/exec`) governs every subprocess. See "Process execution" below.

FThisUp is for applications you own or are explicitly authorized to test. The rules below are **enforced by code in the executor** (`src/safety/policy.ts`, `src/engines/playwright/executor.ts`, `session.ts`), not by prompts.

## Target policy

| Target | Result |
|---|---|
| `localhost`, `127.0.0.0/8`, `::1`, `*.localhost` | Allowed (full safe-mode capability) |
| Private ranges (10.x, 192.168.x, ...), public hosts | **Blocked** unless in `safety.allowedHosts` **and** `safety.authorized: true` **and** `safety.environment` is `staging` or `production` |
| `safety.environment: "staging"` | Allowed; form submission is OFF unless `safety.allowFormSubmission: true` |
| `safety.environment: "production"` | Allowed but **read-only**: every scenario that submits forms or logs in is blocked, and any POST/PUT/PATCH/DELETE is aborted in the browser |
| `169.254.x.x`, metadata hostnames | Never tested |
| `ftp:`, `file:`, URLs with embedded credentials | Refused |

## Project scope: only the project at hand
- **Project root.** FThisUp walks up from the current directory to the nearest project marker (`package.json`, `pyproject.toml`, `.git`, `fthisup.config.json`, ...). It refuses to run if none is found, and never treats your home directory or `/` as a project. All static scanning is limited to that root.
- **Paths stay inside.** `--output`, `--config`, `--scenarios`, `--input` and the config's `output` must resolve inside the project (symlinks are resolved, so a link cannot escape).
- **The target must be this project's app.** For a `--url` or an auto-detected server, FThisUp looks up which process owns the port (via `ss`/`lsof`, best effort on Linux/macOS) and refuses it if that process was started from a different project. Auto-detection silently skips such servers. Servers started from inside the project, or from a monorepo parent, are accepted. A `"url"` in the project's own `fthisup.config.json` counts as an explicit declaration (for Docker or other setups where the owner can't be determined).
- **Other local servers the app calls** (e.g. a separate API port) are allowed only if they don't belong to another project.
- Limits: the owner check is unavailable on Windows or without `ss`/`lsof` (then only the explicit-declaration rule applies), and it cannot see inside containers.

## Per-request enforcement
Every request the browser makes passes through the guard:
- Only the target origin (plus other **loopback** ports when the target is loopback, because dev UIs and APIs often run on separate ports, plus hosts you allow-listed) is contacted. **Third-party origins are aborted**, including analytics, CDNs and APIs your app calls. `allowThirdPartyAssets: true` permits third-party *GET* scripts/styles/fonts/images only.
- Mutating methods are aborted when mutations are disabled for the target.
- A token bucket caps request rate (`maxRequestsPerSecond`, default 20) and each scenario has a request budget (`maxRequestsPerScenario`, default 300). Scenarios run **sequentially**: no concurrency, no load generation, no DoS testing.
- If the guard cannot be installed or a scenario leaves the authorized origin, the scenario/run stops.

## Scenario gating
- Buttons/forms whose text, action or fields suggest **deletion, purchase, account creation, messaging, upload or other irreversible actions** become scenarios with `requiresApproval`. They are reported as **blocked** unless that exact action is listed in `safety.approvedActions`.
- Forms containing a password field only get the empty-submit check; FThisUp never sends non-empty credential-shaped input to login forms.
- Auth testing uses only the supplied test account. The "bad login" check makes **exactly one** attempt and is never re-run (no brute force, no lockout).
- Scenarios (including AI-proposed ones) use a closed, typed vocabulary. There is no action that evaluates JavaScript or runs commands.

## Data handling
- `.env` files, keys and credential files are never opened by the project scanner.
- Everything written to disk passes through redaction (JWTs, bearer tokens, `password`/`token`/`secret` pairs, emails, card numbers, your test credentials) and long strings are truncated. **Screenshots are pixels and cannot be redacted**: do not run against pages that show real personal data.
- No telemetry. The only network traffic is to your target.

## Process execution (CLI, fuzzing, test runners, desktop)

Enforced in `src/exec/run.ts`, not in prompts:

- **No shells, ever.** `sh`, `bash`, `cmd`, `powershell`... are refused. Commands are argv arrays.
- **Executable allow-list**: known tools (`node`, `python3`, `cargo`, `flutter`, `go`, `cmake`, ...) or a binary located **inside the project**. Anything else is refused before spawning.
- **AI cannot choose what runs.** Agent-proposed CLI scenarios name a target (a discovered/configured CLI) plus argv strings; API scenarios supply a path only. Schemas are strict: unknown fields are rejected.
- **Working directory and files stay inside the project.** Hostile-input runs use a scratch directory (`.fthisup-tmp/`, auto-ignored, removed afterwards).
- **Sanitized environment**: variables that look like secrets (`*KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `AWS_*`, `ANTHROPIC_*`, `GITHUB_*`, `FTHISUP_TEST_*` ...) are never passed to child processes. `HOME` is redirected to the scratch directory for hostile-input runs.
- **Limits**: per-run timeout (process group killed), output cap, `prlimit` CPU/file-size/open-file limits on Linux.
- **OS sandbox (Linux, bubblewrap)** for CLI probing and function fuzzing: the whole filesystem is read-only, only the scratch directory is writable, no network, separate PID/IPC namespaces, dies with FThisUp. `safety.sandbox`: `auto` (default: use it if available), `require` (fail closed), `off`. **Without bubblewrap (macOS, Windows, minimal containers) there is no filesystem/network isolation**: FThisUp says so in the report, disables function fuzzing unless you set `safety.allowUnsandboxedFuzzing`, and requires approval for CLI targets whose name or flags look destructive.
- Signal scenarios (SIGINT/SIGTERM) run **outside** the sandbox: a signal sent to a bubblewrapped process hits the wrapper, which would hide a program that ignores Ctrl-C. They use no hostile input.
- Existing-test runners and the desktop adapter run **unsandboxed** (they must build and write artifacts, or need a display) but through the same allow-list/limits/environment rules. They never install dependencies.

## What FThisUp cannot guarantee
- Test inputs *do* hit your app (that's the point). In local mode forms are really submitted, so test data (`fthisup-test@example.invalid`, "FThisUp test") may be created in your dev database. Use a throwaway database.
- Heuristics classify "sensitive" actions by keywords; an oddly-named destructive button may not be recognised. Run against disposable data.
- Passing results do not prove an app is correct or secure.
