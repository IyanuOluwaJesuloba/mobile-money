#!/usr/bin/env node
import { Command } from "commander";
import { registerAuthCommand } from "./commands/auth";
import { registerStatusCommand } from "./commands/status";
import { registerRetryCommand } from "./commands/retry";
import { registerSetupCommand } from "./commands/setup";

const program = new Command("momo-cli")
  .version("1.0.0")
  .description("Admin maintenance CLI for mobile-money");

registerAuthCommand(program);
registerStatusCommand(program);
registerRetryCommand(program);
registerSetupCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ ${msg}`);
  process.exit(1);
});
