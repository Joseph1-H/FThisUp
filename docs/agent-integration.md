# Using FThisUp from AI coding agents

FThisUp ships an [Agent Skills](https://agentskills.io)-format skill (`skills/fthisup/SKILL.md`). The skill tells the agent to run the **real CLI** and report its results; it does not ask the model to imagine bugs. Paths and invocation differ per agent; the table reflects each tool's documentation at the time of writing. Check your version's docs if something does not load.

| Agent | Where skills live | Invoke |
|---|---|---|
| **Claude Code** | project: `.claude/skills/fthisup/` · personal: `~/.claude/skills/fthisup/` | `/fthisup`, `/fthisup fix` (the skill name becomes the slash command; arguments follow) |
| **OpenAI Codex** (CLI/IDE) | repo: `.agents/skills/fthisup/` · personal: `~/.agents/skills/fthisup/` | mention `$fthisup`, pick it from `/skills`, or describe the task and let Codex select it |
| **Cursor** | `.cursor/skills/fthisup/` or `~/.cursor/skills/fthisup/` (Cursor also reads `.agents/skills/`, and for compatibility `.claude/skills/`) | type `/` in Agent chat and choose `fthisup`, or describe the task |

There is no universal slash command: `/fthisup` is a Claude Code feature (and works in Cursor's `/` picker); Codex uses `$fthisup`.

## Install

From a project that has FThisUp available (`npx fthisup` works without installing it):

```bash
npx fthisup install-skill --agent claude            # ./.claude/skills/fthisup
npx fthisup install-skill --agent claude --global   # ~/.claude/skills/fthisup
npx fthisup install-skill --agent codex             # ./.agents/skills/fthisup
npx fthisup install-skill --agent cursor            # ./.cursor/skills/fthisup
```

Manual copy works too, because a skill is just a folder:

```bash
npm i -D fthisup
mkdir -p .claude/skills && cp -r node_modules/fthisup/skills/fthisup .claude/skills/
# PowerShell: Copy-Item -Recurse node_modules\fthisup\skills\fthisup .claude\skills\
```

Restart the agent session if the skill does not show up.

## What the skill does
1. Identifies the project and its components, 2. confirms a safe target, 3. runs `fthisup doctor` (which adapters can run now, what is missing), 4. runs `fthisup scan`, 5. optionally writes extra typed scenarios (`scenarios`, `cliScenarios`, `apiScenarios`, validated with `--dry-run`), 6. runs `fthisup test`, 7. reads `results.json` and summarizes **confirmed** failures separately from suspected ones (per component, distinguishing failed assertions in your own tests from defects FThisUp observed), 8. suggests fixes without editing code. It never installs SDKs or dependencies; it tells you what is missing.

`/fthisup fix` is a separate workflow: it reads confirmed bugs, proposes changes, edits **only with your permission**, runs your existing tests, re-runs FThisUp, and reports per bug whether the scenario now passes.

## Agent-proposed scenarios
Agents may add scenarios with `--scenarios file.json` (sections `scenarios` for web, `cliScenarios`, `apiScenarios`). They are validated against strict schemas (no scripts, no shell, no executables, no hosts) and executed under the identical runtime safety layers. Format: [skills/fthisup/references/scenario-format.md](../skills/fthisup/references/scenario-format.md).
