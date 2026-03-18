---
description: Run tests. No args = all tests. Pass a filter to run specific tests.
allowed-tools: Bash(bun:*)
argument-hint: [optional filter]
---

Run the project tests:

If no arguments provided:
```
bun test
```

If a filter is provided:
```
bun test --filter "$ARGUMENTS"
```

After running, summarize: total tests, passed, failed, and duration. If any tests fail, analyze the failure and suggest a fix.
