#!/usr/bin/env bun
/**
 * OpenMind CLI — Entry point.
 *
 * Running `openmind` with no arguments opens the interactive REPL.
 * Subcommands like `openmind init` run as one-shot commands.
 */

import { Command } from "commander";
import { registerContextCommand } from "./commands/context";
import { registerInitCommand } from "./commands/init";
import { registerProviderCommand } from "./commands/provider";
import { registerRunCommand } from "./commands/run";
import { registerValidateCommand } from "./commands/validate";
import { startRepl } from "./repl";

const program = new Command();

program
  .name("openmind")
  .description("AI pipeline orchestrator for development teams")
  .version("0.1.0");

registerInitCommand(program);
registerRunCommand(program);
registerValidateCommand(program);
registerProviderCommand(program);
registerContextCommand(program);

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
  startRepl();
}
