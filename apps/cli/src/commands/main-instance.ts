import { homedir } from "node:os";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  clearMainInstanceConfig,
  mainInstanceConfigPath,
  readMainInstanceConfig,
  writeMainInstanceConfig,
  type MainInstanceConfig,
} from "@bb/config/main-instance";
import { parsePortValue } from "@bb/config/runtime";
import { action } from "../action.js";
import { outputJson } from "./helpers.js";

interface MainInstanceOptions {
  json?: boolean;
}

interface SetMainInstanceOptions extends MainInstanceOptions {
  checkout: string;
  dataDir: string;
  nodePath: string;
  serverPort: string;
  hostDaemonPort: string;
  serverBindHost: string;
}

export function registerMainInstanceCommands(program: Command): void {
  const command = program
    .command("main-instance")
    .description(
      "Manage this machine's preferred BB server and startup policy",
    );
  command
    .command("show")
    .description("Show the main BB instance on this machine")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MainInstanceOptions) => {
        const result = {
          path: mainInstanceConfigPath(),
          config: readMainInstanceConfig(),
        };
        if (!outputJson(opts, result))
          console.log(
            result.config === null
              ? "No main BB instance is configured"
              : JSON.stringify(result.config, null, 2),
          );
      }),
    );
  command
    .command("set")
    .description(
      "Register the source checkout and data directory to reuse for ordinary launches",
    )
    .requiredOption(
      "--checkout <path>",
      "Source checkout containing scripts/start-bb.mjs",
    )
    .option(
      "--data-dir <path>",
      "Main server data directory",
      resolve(homedir(), ".bb"),
    )
    .option(
      "--node-path <path>",
      "Node executable used to start the main server",
      process.execPath,
    )
    .option("--server-port <port>", "Main server port", "38886")
    .option("--host-daemon-port <port>", "Main daemon port", "38887")
    .option("--server-bind-host <host>", "127.0.0.1 or 0.0.0.0", "127.0.0.1")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: SetMainInstanceOptions) => {
        if (
          opts.serverBindHost !== "127.0.0.1" &&
          opts.serverBindHost !== "0.0.0.0"
        )
          throw new Error("--server-bind-host must be 127.0.0.1 or 0.0.0.0");
        const config: MainInstanceConfig = {
          checkoutPath: resolve(opts.checkout),
          dataDir: resolve(opts.dataDir),
          nodePath: resolve(opts.nodePath),
          serverPort: parsePortValue({
            name: "--server-port",
            rawPort: opts.serverPort,
          }),
          hostDaemonPort: parsePortValue({
            name: "--host-daemon-port",
            rawPort: opts.hostDaemonPort,
          }),
          serverBindHost: opts.serverBindHost,
        };
        await writeMainInstanceConfig(config);
        if (!outputJson(opts, { path: mainInstanceConfigPath(), config }))
          console.log(
            `Main BB instance registered at ${mainInstanceConfigPath()}`,
          );
      }),
    );
  command
    .command("clear")
    .description(
      "Remove the preference and restore normal launch defaults; does not delete data or stop BB",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: MainInstanceOptions) => {
        await clearMainInstanceConfig();
        if (!outputJson(opts, { cleared: true }))
          console.log("Main BB instance preference cleared");
      }),
    );
}
