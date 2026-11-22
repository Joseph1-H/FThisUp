# `/fthisup fix` workflow

Goal: fix **confirmed** bugs from the latest run and prove they are fixed. Remediation is separate from testing: the `scan`/`test` commands never edit code; only this workflow does, and only with the user's permission.

1. **Read the evidence.** Open `fthisup-results/results.json`. If it does not exist or is stale, tell the user and run the normal `/fthisup` workflow first. Work only from findings with `status: "confirmed"` unless the user explicitly asks about suspected ones. Show the list (id, severity, title, route) and ask which to fix (default: all confirmed, highest severity first).
2. **Inspect.** For each chosen finding, use `route`, `reproductionSteps`, `evidence.pageErrors`/`networkFailures`/`mutatingRequests` and `suggestedFix` to locate the responsible code. Read it before proposing anything.
3. **Propose.** Show a concise diff-style plan per bug (files, what changes, why it addresses the evidence). **Ask permission before editing.** If the user has already said "go ahead and fix", you may proceed; otherwise wait.
4. **Edit minimally.** Change only what the bug requires. Do not touch `fthisup.config.json` safety settings, and do not weaken tests or checks to make FThisUp pass.
5. **Run the project's existing tests** (the test command from `package.json`). Report failures honestly; do not claim success if they fail.
6. **Re-run FThisUp.** Make sure the app is running the new code (restart/hot-reload as needed), then:
   ```bash
   npx fthisup test --url <url> --output fthisup-results/after-fix
   ```
   Compare `scenarioId`s of the fixed findings in the new `results.json`.
7. **Report truthfully** per bug: `resolved` (its scenario now passes), `still failing` (show new evidence), or `could not verify` (scenario skipped/blocked). Mention any new findings the re-run produced. Never say a bug is fixed unless its scenario passed in the re-run.
