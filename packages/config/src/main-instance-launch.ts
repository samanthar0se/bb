import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readBbAppRuntimeFile } from "./app-runtime-file.js";
import { FileLockTimeoutError, withFileLock } from "./file-lock.js";
import {
  mainInstanceProcessEnv,
  mainInstanceServerUrl,
  resolveMainInstanceConfig,
  type MainInstanceConfig,
} from "./main-instance.js";
import { isProcessRunning } from "./verified-process-stop.js";
import { z } from "zod";

const serverConfigSchema = z.object({
  dataDir: z.string(),
  hostDaemonPort: z.number().int(),
});

async function isMainInstanceRunning(
  config: MainInstanceConfig,
): Promise<boolean> {
  const url = mainInstanceServerUrl(config);
  let response: Response;
  try {
    response = await fetch(`${url}/api/v1/system/config`, {
      signal: AbortSignal.timeout(1_000),
    });
  } catch (error) {
    const runtime = await readBbAppRuntimeFile(config.dataDir);
    if (runtime !== null && isProcessRunning(runtime.pid))
      throw new Error(
        `The main BB instance is starting or unresponsive at ${url}; no other instance was started`,
        { cause: error },
      );
    if (
      error instanceof Error &&
      "cause" in error &&
      error.cause instanceof Error &&
      "code" in error.cause &&
      error.cause.code === "ECONNREFUSED"
    )
      return false;
    throw new Error(
      `Could not verify the main BB instance at ${url}; no other instance was started`,
      { cause: error },
    );
  }
  if (!response.ok)
    throw new Error(
      `The main BB address ${url} returned HTTP ${response.status}; no other instance was started`,
    );
  const parsed = serverConfigSchema.safeParse(await response.json());
  if (
    !parsed.success ||
    resolve(parsed.data.dataDir) !== resolve(config.dataDir) ||
    parsed.data.hostDaemonPort !== config.hostDaemonPort
  )
    throw new Error(
      `The server at ${url} does not match the registered main BB instance`,
    );
  return true;
}

export async function runMainInstanceLauncher(args: {
  sourceCheckoutPath: string | null;
  dryRun: boolean;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): Promise<boolean> {
  const env = args.env ?? process.env;
  const homeDir = args.homeDir ?? homedir();
  const config = resolveMainInstanceConfig({ env, homeDir });
  if (config === null) return false;
  if (args.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, mainInstance: config, serverUrl: mainInstanceServerUrl(config) }, null, 2)}\n`,
    );
    return true;
  }
  if (await isMainInstanceRunning(config)) {
    process.stdout.write(
      `Using the main BB instance at ${mainInstanceServerUrl(config)} (${config.dataDir})\n`,
    );
    return true;
  }
  if (
    env.BB_MAIN_INSTANCE_STARTING === "1" &&
    args.sourceCheckoutPath !== null &&
    resolve(args.sourceCheckoutPath) === resolve(config.checkoutPath)
  )
    return false;
  try {
    await withFileLock({
      path: join(config.dataDir, "main-instance-start.lock"),
      timeoutMs: 0,
      work: async () => {
        if (await isMainInstanceRunning(config)) return;
        const child = spawn(
          config.nodePath,
          [
            "--conditions=source",
            "--import",
            "tsx",
            join(config.checkoutPath, "scripts/start-bb.mjs"),
            "--data-dir",
            config.dataDir,
            "--server-port",
            String(config.serverPort),
            "--host-daemon-port",
            String(config.hostDaemonPort),
            "--server-bind-host",
            config.serverBindHost,
            "--bundled",
          ],
          {
            cwd: config.checkoutPath,
            env: {
              ...mainInstanceProcessEnv(config, env),
              BB_MAIN_INSTANCE_STARTING: "1",
            },
            stdio: "inherit",
          },
        );
        const stop = (signal: NodeJS.Signals) => child.kill(signal);
        const interrupt = () => stop("SIGINT");
        const terminate = () => stop("SIGTERM");
        process.on("SIGINT", interrupt);
        process.on("SIGTERM", terminate);
        try {
          const exitCode = await new Promise<number>(
            (resolveExit, rejectExit) => {
              child.once("error", rejectExit);
              child.once("exit", (code) => resolveExit(code ?? 1));
            },
          );
          if (exitCode !== 0)
            throw new Error(
              `The main BB launcher exited with code ${exitCode}`,
            );
        } finally {
          process.off("SIGINT", interrupt);
          process.off("SIGTERM", terminate);
        }
      },
    });
  } catch (error) {
    if (error instanceof FileLockTimeoutError)
      throw new Error(
        `The main BB instance is already starting at ${mainInstanceServerUrl(config)}; retry when it is ready`,
        { cause: error },
      );
    throw error;
  }
  return true;
}
