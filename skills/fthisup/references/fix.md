# `/fthisup fix` workflow

Goal: fix **confirmed** bugs from the latest run and prove they are fixed. Remediation is separate from testing: `scan`/`test` never edit code; only this workflow does, and only with the user's permission.

1. **Read the evidence.** Open `fthisup-results/results.json`. If it does not exist or is stale, tell the user and run the normal `/fthisup` workflow first. Work only from findings with `status: "confirmed"` unless the user explicitly asks about suspected ones. Show the list (id, severity, component, adapter, title) and ask which to fix (default: all confirmed, highest severity first). Group them by `component`.
2. **Inspect.** For each chosen finding use `component`, `scope`, `route`, `reproductionSteps`, `evidence.logs`/`commands`/`pageErrors`/`networkFailures` and `suggestedFix` to locate the responsible code. Read it before proposing anything.
3. **Failed assertions need a decision.** If `evidenceKind` is `failed-assertion` (the project's own test fails), read BOTH the test and the code. Decide which is wrong. If the test looks outdated rather than the code, say so and ask the user before changing a test. Never weaken or delete a test just to make it pass.
4. **Propose.** Show a concise per-bug plan (files, what changes, why it addresses the evidence). **Ask permission before editing**, unless the user already said to go ahead.
5. **Edit minimally.** Change only what the bug requires. Do not touch `fthisup.config.json` safety settings.
6. **Run the project's existing tests** (the commands listed in `fthisup-results/project.json` for the affected component). Report failures honestly.
7. **Re-run FThisUp for the affected adapters/components.** Make sure the app/API is running the new code (restart if needed), then e.g.:
   ```bash
   npx fthisup test --adapter <adapter> [--url <url>] --output fthisup-results/after-fix
   ```
8. **Report truthfully** per bug: `resolved` (its scenario now passes in the re-run), `still failing` (show the new evidence), or `could not verify` (scenario skipped/blocked/unavailable). Mention any new findings. Never say a bug is fixed unless its scenario passed in the re-run.
