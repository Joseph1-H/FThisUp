# Adapters

An adapter implements one interface (`src/adapters/types.ts`): `detect → capabilities → plan → execute`. The CLI never hardcodes a project type: it asks every registered adapter whether it applies, what it can actually do **right now** (capabilities), and what it would run (plan).

* **Detected ≠ available.** Detection reads files (`Cargo.toml`, `pubspec.yaml`, ...). Availability is checked separately: is `cargo` on PATH? are `node_modules` installed? is a display present? Unavailable adapters are reported as `unavailable` with the missing prerequisite and a setup command **you** run. FThisUp never installs SDKs, dependencies, browsers or emulators.
* **Enabling ≠ available.** `adapters.<id>: true` in the config only means "don't skip this one".
* Everything an adapter runs is bounded (timeouts, output caps, request budgets) and passes the runtime safety layer. See [safety.md](safety.md).

## Compatibility

| Adapter (`--adapter`) | What it does | Status | Verified against |
|---|---|---|---|
| `web` | Playwright/Chromium: navigation, forms, duplicate submits, network failures, viewports, auth | **Fully supported** | real browser; buggy+clean fixtures |
| `api` | OpenAPI / route discovery; malformed JSON, missing/wrong-typed fields, hostile params, oversized bodies, undeclared methods, response-schema checks, auth enforcement, capped concurrency | **Fully supported** (JSON APIs over HTTP) | real server; buggy+clean fixtures |
| `cli` | Hostile args/stdin/signals against your CLI in an isolated subprocess | **Fully supported** for Node and Python CLIs; other languages via `cli.commands` | real processes; buggy+clean fixtures |
| `python` | Runs unittest/pytest, structured results, reproduction; sandboxed function fuzzing | **Supported** (unittest + fuzzing verified; pytest path via JUnit XML, not run here: pytest was not installed) | python 3.12 |
| `javascript` | Runs node:test / Vitest / Jest / Mocha / `npm test`, `tsc --noEmit`; sandboxed function fuzzing | **Supported** (node:test + fuzzing verified; Vitest/Jest/Mocha parsers verified on sample JSON only) | node 22 |
| `rust` | `cargo test` (+ clippy when installed) | **Supported** | cargo 1.99 |
| `flutter` | `flutter test` / `dart test` (+ analyzer) | **Supported** for unit and widget tests. Device/emulator integration tests are **not** run | flutter 3.44 |
| `cpp` | CMake configure + build (scratch dir) + CTest; `make test` | **Supported** for CMake/CTest | cmake 3.28 + gcc |
| `desktop` | Build verification, startup, liveness, SIGTERM shutdown, log inspection (opt-in) | **Partial**: no GUI automation | node-based fixtures |
| `godot` | Static validation of project resources (always); headless import/startup when a Godot binary exists | **Partial**: static checks verified; engine run **not verified** (no Godot here); no gameplay testing | fixtures |
| `go` | `go test -json`, `go vet` | **Experimental**: parser verified on documented output only; Go was not installed here | – |
| `java` | `mvn test` / `gradle test` (wrappers preferred), JUnit XML | **Experimental**: not verified against a real JDK/Maven/Gradle here | – |
| `swift` | `swift test` | **Experimental**: not verified against a Swift toolchain here | – |
| Kotlin/Android device tests, iOS/Android UIs, React Native, .NET, Ruby, PHP | – | **Planned** (detected and reported as untested; Android/React Native host folders are folded into their app) | – |

## What each adapter will and will not do

* **web / api**: network adapters share one lock (never run concurrently with each other) so rate limits hold. Only the authorized origin is contacted.
* **cli / fuzzing**: run inside bubblewrap on Linux (read-only filesystem, writable scratch directory only, no network). Elsewhere they run with allow-listed executables, a sanitized environment, scratch cwd, timeouts and output caps, but **without** filesystem/network isolation (the report says so). Function fuzzing is disabled without a sandbox unless `safety.allowUnsandboxedFuzzing: true`.
* **existing-test adapters** execute *your* test commands (which run your code). They run with the same allow-list, timeouts, secret-free environment and CPU/file-size limits, but not inside the sandbox because tests need to build and write artifacts. They never install dependencies.
* **desktop**: opt-in, because it builds and launches your software; not sandboxed (GUI apps need display/GPU).

## Findings: statuses, failure types, evidence kinds

* Status: `confirmed` (reproduced and objectively measurable), `suspected` (heuristic, or could not be re-run), `not-reproducible`, plus per-scenario `skipped` / `blocked` results.
* Failure type: `crash`, `unhandled-exception`, `hang`, `incorrect-output`, `invalid-state-transition`, `data-corruption`, `input-validation`, `resource-usage`, `build-failure`, `dependency-failure`, `auth-error`, `network-error-handling`, `ui-interaction`, `regression`, `incomplete-functionality`, plus `broken-navigation`, `security-weakness`, `layout-defect`.
* Evidence kind: `observed-defect` (FThisUp provoked and saw it), `failed-assertion` (your own test failed: a bug **or** an outdated test; FThisUp can't tell), `static-heuristic` (unconfirmed).

## Writing a new adapter

Implement `TestAdapter`, add it to `src/adapters/registry.ts`, add buggy **and** clean fixtures and tests (the clean one must produce zero findings). Reuse `runProcess` (allow-list, sandbox, limits) for anything that executes code and `SafetyGuard` for anything that sends network traffic. Do not register adapters you cannot verify without labelling them experimental.
