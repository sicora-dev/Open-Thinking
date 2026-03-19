---
name: debug-pipeline
description: Debug pipeline execution issues. Use when a pipeline fails, produces unexpected results, context isn't flowing between stages, or provider calls fail.
allowed-tools: Read, Bash(bun:*), Bash(cat:*), Bash(sqlite3:*), Grep, Glob
---

When debugging a pipeline issue:

## Step 1: Identify the failure point

Check in this order:
1. **YAML validation**: Run `bun run dev -- validate` to check pipeline syntax
2. **Provider connectivity**: Run `bun run dev -- provider test <name>` for each provider
3. **Context state**: Check SQLite DB at `.openmind/context.db`
   ```bash
   sqlite3 .openmind/context.db "SELECT key, length(value), created_by, created_at FROM context ORDER BY created_at DESC LIMIT 20;"
   ```
4. **Audit log**: Check `.openmind/audit.log` for policy violations
5. **Stage output**: Check `.openmind/runs/<run-id>/` for per-stage logs

## Step 2: Common issues

### "Context key not found" during stage execution
- The producing stage hasn't run yet → check `depends_on`
- The key name doesn't match → check dot notation (`plan.architecture` vs `plan.arch`)
- Policy blocks the read → check `context.read` in the stage definition

### Provider returns error
- 401 → API key issue. Check `/providers list` or re-run `/providers setup`
- 429 → Rate limited. Check `policies.global.rate_limit`
- 500 → Provider issue. Try `provider test <name>`
- Timeout → Increase timeout in provider config

### Stage stuck in "running"
- LLM streaming hung → check network
- Infinite tool loop → skill is calling tools in a loop. Check skill prompt

### Pipeline cost exceeds limit
- Check `policies.global.cost_limit`
- Run `bun run dev -- context inspect` to see token usage per stage

## Step 3: Fix and verify

After fixing, always:
1. Run the specific failing test: `bun test --filter "stage-name"`
2. Run the full test suite: `bun test`
3. Do a dry run: `bun run dev -- run --pipeline <name> --dry-run`
