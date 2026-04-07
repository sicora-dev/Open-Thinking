/**
 * `openthk ui start|stop|status|restart|logs` — Manage the local web UI server.
 */
import { spawn } from "node:child_process";
import type { Command } from "commander";
import {
  getLogPath,
  restartUi,
  startUi,
  statusUi,
  stopUi,
} from "../../ui/server/lifecycle";

export function registerUiCommand(program: Command): void {
  const ui = program.command("ui").description("Manage the OpenThinking web UI server");

  ui.command("start")
    .description("Start the UI server in the background")
    .option("-p, --port <number>", "Port to bind (default: 17880, falls back if busy)")
    .option("--foreground", "Run in foreground instead of detaching")
    .option("--no-open", "Do not open the browser automatically")
    .action(async (options: { port?: string; foreground?: boolean; open?: boolean }) => {
      const port = options.port ? Number(options.port) : null;
      if (port != null && Number.isNaN(port)) {
        console.error("Invalid --port value");
        process.exit(1);
      }

      const result = await startUi({ port, foreground: options.foreground });
      if (!result.ok) {
        console.error(`Failed to start UI: ${result.error.message}`);
        process.exit(1);
      }

      const { pid, port: actualPort, alreadyRunning } = result.value;
      const url = `http://127.0.0.1:${actualPort}`;
      if (alreadyRunning) {
        console.log(`UI already running at ${url} (pid ${pid})`);
      } else {
        console.log(`UI started at ${url} (pid ${pid})`);
      }

      if (options.open !== false && !options.foreground) {
        openBrowser(url);
      }
    });

  ui.command("stop")
    .description("Stop the UI server")
    .action(async () => {
      const result = await stopUi();
      if (!result.ok) {
        console.error(`Failed to stop UI: ${result.error.message}`);
        process.exit(1);
      }
      if (result.value.stopped) {
        console.log(`UI stopped (pid ${result.value.pid})`);
      } else {
        console.log("UI was not running.");
      }
    });

  ui.command("status")
    .description("Show UI server status")
    .action(() => {
      const status = statusUi();
      if (!status.running) {
        console.log("UI is not running.");
        return;
      }
      console.log(`UI running at ${status.url}`);
      console.log(`  pid:       ${status.pid}`);
      console.log(`  started:   ${status.startedAt}`);
    });

  ui.command("restart")
    .description("Restart the UI server")
    .option("-p, --port <number>", "Port to bind")
    .action(async (options: { port?: string }) => {
      const port = options.port ? Number(options.port) : null;
      const result = await restartUi({ port });
      if (!result.ok) {
        console.error(`Failed to restart UI: ${result.error.message}`);
        process.exit(1);
      }
      console.log(`UI restarted at http://127.0.0.1:${result.value.port} (pid ${result.value.pid})`);
    });

  ui.command("logs")
    .description("Show UI server logs")
    .option("-f, --follow", "Follow log output")
    .action((options: { follow?: boolean }) => {
      const path = getLogPath();
      console.log(`Log file: ${path}\n`);
      const args = options.follow ? ["-f", path] : [path];
      const child = spawn("tail", args, { stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
    });
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // ignore — best-effort
  }
}
