---
description: Run all quality checks — typecheck, lint, format, and tests. Use before committing.
allowed-tools: Bash(bun:*), Bash(npx:*)
---

Run ALL quality checks in sequence. Stop at the first failure:

1. **Type check**: `bun run typecheck`
2. **Lint**: `bun run lint`
3. **Tests**: `bun test`

Report results as a summary table:
| Check     | Status | Details |
|-----------|--------|---------|
| Typecheck | ✓/✗    | ...     |
| Lint      | ✓/✗    | ...     |
| Tests     | ✓/✗    | ...     |

If any check fails, analyze and fix the issues before continuing.
