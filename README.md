# opencode-ralph

Ralph Wiggum iterative loop plugin for [OpenCode](https://opencode.ai). Repeatedly feeds the same prompt back to the AI, letting it see its previous work in files and git history to iteratively improve until done.

Based on the [Ralph technique](https://ghuntley.com/ralph/) by Geoffrey Huntley.

## Installation

```bash
opencode plugin https://github.com/loss-and-quick/opencode-ralph
```

Or add to `.opencode/opencode.json`:

```json
{
  "plugin": ["https://github.com/loss-and-quick/opencode-ralph"]
}
```

## Commands

### `/ralph-loop <prompt> [options]`

Start a loop in the current session.

**Options:**
- `--max-iterations <n>` — stop after N iterations (default: unlimited)
- `--completion-promise <text>` — phrase the AI must output in `<promise>` tags to stop
- `--git-commit` — auto-commit after each iteration

```bash
/ralph-loop "Fix all failing tests" --completion-promise "TESTS PASS" --max-iterations 20
/ralph-loop "Refactor the cache layer" --git-commit
```

### `/cancel-ralph`

Cancel the active loop.

### `/ralph-help`

Show detailed help.

## How It Works

1. Creates `ralph-loop.local.md` state file in project root
2. On each session idle event, the plugin feeds the same prompt back
3. The AI sees its previous work in files and git history
4. Loop stops when: completion promise detected, max iterations reached, or `/cancel-ralph` run

## Pause / Resume

Set `paused: true` in `ralph-loop.local.md` to pause without cancelling. Set back to `false` to resume.

## State File

```markdown
---
active: true
paused: false
iteration: 3
max_iterations: 20
completion_promise: "TESTS PASS"
started_at: "2024-01-15T10:30:00Z"
git_commit: false
---

Your prompt here...
```

`ralph-loop.local.md` is already in `.gitignore`.
