import { resolveCurrentDevProcessEnv } from "@bb/config/runtime";
import { homedir } from "node:os";
import {
  mainInstanceServerUrl,
  resolveMainInstanceConfig,
} from "@bb/config/main-instance";
import { runScriptProcess } from "../lib/process-helpers.js";
import { repoRoot, runMainIfEntrypoint } from "../lib/script-entry.js";

interface CliExecution {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function resolveCliExecution(
  cliArgs: string[] = process.argv.slice(2),
): CliExecution {
  const forwardedArgs = cliArgs[0] === "--" ? cliArgs.slice(1) : cliArgs;
  const env = { ...process.env };
  let args = ["apps/cli/dist/index.js", ...forwardedArgs];
  if (process.env.NODE_ENV !== "production") {
    const devEnv = resolveCurrentDevProcessEnv(repoRoot, process.env);
    env.BB_SERVER_URL = process.env.BB_SERVER_URL ?? devEnv.BB_SERVER_URL;
    env.BB_HOST_DAEMON_PORT =
      process.env.BB_HOST_DAEMON_PORT ?? devEnv.BB_HOST_DAEMON_PORT;
    args = [
      "--conditions=source",
      "--import",
      "tsx",
      "apps/cli/src/index.ts",
      ...forwardedArgs,
    ];
  }
  const mainInstance =
    forwardedArgs[0] === "main-instance"
      ? null
      : resolveMainInstanceConfig({
          env: process.env,
          homeDir: homedir(),
        });
  if (mainInstance !== null && process.env.BB_SERVER_URL === undefined) {
    env.BB_SERVER_URL = mainInstanceServerUrl(mainInstance);
    env.BB_HOST_DAEMON_PORT = String(mainInstance.hostDaemonPort);
  }
  return {
    args,
    command: process.execPath,
    cwd: repoRoot,
    env,
  };
}

async function main(cliArgs: string[] = process.argv.slice(2)): Promise<void> {
  const execution = resolveCliExecution(cliArgs);
  process.exitCode = await runScriptProcess({
    args: execution.args,
    command: execution.command,
    cwd: execution.cwd,
    env: execution.env,
    stdio: "inherit",
  });
}

runMainIfEntrypoint(import.meta.url, main);
