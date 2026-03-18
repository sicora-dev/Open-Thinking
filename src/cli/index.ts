#!/usr/bin/env bun
/**
 * OpenMind CLI — Entry point.
 */

import { Command } from "commander";
import { registerContextCommand } from "./commands/context";
import { registerInitCommand } from "./commands/init";
import { registerProviderCommand } from "./commands/provider";
import { registerRunCommand } from "./commands/run";
import { registerValidateCommand } from "./commands/validate";

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

program.parse();
