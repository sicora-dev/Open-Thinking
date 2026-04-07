/**
 * OpenThinking CLI — Entry point.
 *
 * Running `openthk` with no arguments opens the interactive REPL.
 * Subcommands like `openthk init` run as one-shot commands.
 */

import { Command } from "commander";
import { registerContextCommand } from "./commands/context";
import { registerInitCommand } from "./commands/init";
import { registerProviderCommand } from "./commands/provider";
import { registerRunCommand } from "./commands/run";
import { registerUiCommand } from "./commands/ui";
import { registerValidateCommand } from "./commands/validate";
import { startRepl } from "./repl";
import { startUiHttpServer } from "../ui/server/server";
import { VERSION } from "../version";

async function main(): Promise<void> {
  if (process.env.OPENTHK_UI_SERVER === "1") {
    await startUiHttpServer();
    return;
  }

  const program = new Command();

  program
    .name("openthk")
    .description("Multi-LLM agent orchestration framework")
    .version(VERSION);

  registerInitCommand(program);
  registerRunCommand(program);
  registerValidateCommand(program);
  registerProviderCommand(program);
  registerContextCommand(program);
  registerUiCommand(program);

  // If no subcommand is provided, launch the interactive REPL
  const args = process.argv.slice(2);
  const subcommands = program.commands.map((c) => c.name());
  const hasSubcommand = args.length > 0 && subcommands.includes(args[0] ?? "");
  const hasFlag =
    args.length > 0 &&
    (args[0] === "--version" || args[0] === "-V" || args[0] === "--help" || args[0] === "-h");

  if (hasSubcommand || hasFlag) {
    program.parse();
  } else {
    await startRepl();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
