---
name: scaffold
description: Scaffold new modules, components, or subsystems for the OpenMind project. Use when creating a new provider adapter, CLI command, pipeline component, or any new module.
allowed-tools: Read, Write, Bash(mkdir:*), Bash(touch:*)
---

When scaffolding a new module for OpenMind, follow these steps:

## 1. Determine the module location

Based on the architecture in CLAUDE.md, place the module in the correct directory:
- CLI commands → `src/cli/commands/`
- Provider adapters → `src/providers/adapters/`
- Pipeline components → `src/pipeline/`
- Context components → `src/context/`
- Skill runtime → `src/skills/runtime/`
- Policy rules → `src/policies/rules/`
- Shared utilities → `src/shared/`

## 2. Create the files

Every module MUST include:
- `{module-name}.ts` — Main implementation
- `{module-name}.test.ts` — Tests (at least 3 test cases)
- `types.ts` — Type definitions (if the module defines types used elsewhere)
- `index.ts` — Barrel export

## 3. Follow the patterns

- Use the `Result<T, E>` pattern from `src/shared/result.ts`
- Never throw errors in core logic
- Add JSDoc comments on all exported functions and types
- Use dependency injection: pass dependencies as constructor/function args, never import singletons

## 4. Register the module

- Add barrel export in the parent `index.ts`
- If it's a CLI command, register it in `src/cli/commands/index.ts`
- If it's a provider adapter, register it in `src/providers/adapters/index.ts`

## 5. Verify

- Run `bun run typecheck` to verify types
- Run `bun run test` to verify tests pass
- Run `bun run lint` to verify code style

Always create the test file alongside the implementation. Never skip tests.
