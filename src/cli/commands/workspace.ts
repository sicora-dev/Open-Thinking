/**
 * `openthk workspace switch <path>` — Open the console in another workspace.
 *
 * This cannot change the parent shell's cwd; it starts the interactive
 * OpenThinking console bound to the target workspace.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { startRepl } from "../repl";

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program.command("workspace").description("Manage the active OpenThinking workspace");

  workspace
    .command("switch")
    .description("Start the interactive console in another workspace")
    .argument("<path>", "Target directory")
    .action(async (path: string) => {
      const targetDir = resolve(path);
      if (!existsSync(targetDir)) {
        console.error(`Workspace directory not found: ${targetDir}`);
        process.exit(1);
      }
      if (!statSync(targetDir).isDirectory()) {
        console.error(`Not a directory: ${targetDir}`);
        process.exit(1);
      }

      await startRepl(targetDir);
    });
}
