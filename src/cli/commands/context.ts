/**
 * `openthk context inspect|clear` — Manage the shared context store.
 */
import type { Command } from "commander";
import { createContextStore } from "../../context/store";

const DEFAULT_DB_PATH = ".openthk/context.db";

export function registerContextCommand(program: Command): void {
  const context = program.command("context").description("Manage shared context store");

  context
    .command("inspect")
    .description("Show current context state")
    .option("-p, --prefix <prefix>", "Filter by key prefix")
    .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
    .action(async (options: { prefix?: string; db: string }) => {
      const store = createContextStore({ dbPath: options.db });

      const result = options.prefix ? await store.list(options.prefix) : await store.list();

      if (!result.ok) {
        console.error(`Error: ${result.error.message}`);
        store.close();
        process.exit(1);
      }

      const entries = result.value;
      if (entries.length === 0) {
        console.log("Context store is empty.");
        store.close();
        return;
      }

      console.log(`Context entries (${entries.length}):\n`);
      for (const entry of entries) {
        const preview = entry.value.length > 80 ? `${entry.value.slice(0, 80)}...` : entry.value;
        const expires = entry.expiresAt ? ` | expires: ${entry.expiresAt.toISOString()}` : "";
        console.log(`  ${entry.key}`);
        console.log(`    by ${entry.createdBy} at ${entry.createdAt.toISOString()}${expires}`);
        console.log(`    ${preview}`);
        console.log();
      }

      store.close();
    });

  context
    .command("clear")
    .description("Clear all context data")
    .option("-y, --yes", "Skip confirmation")
    .option("-d, --db <path>", "Database path", DEFAULT_DB_PATH)
    .action(async (options: { yes?: boolean; db: string }) => {
      if (!options.yes) {
        console.log("This will delete all context data. Use --yes to confirm.");
        return;
      }

      const store = createContextStore({ dbPath: options.db });
      const result = await store.clear();

      if (!result.ok) {
        console.error(`Error: ${result.error.message}`);
        store.close();
        process.exit(1);
      }

      console.log("Context store cleared.");
      store.close();
    });
}
