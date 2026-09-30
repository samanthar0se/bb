import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMainInstanceLauncher } from "../packages/config/src/main-instance-launch.ts";
import {
  mainInstanceProcessEnv,
  resolveMainInstanceConfig,
} from "../packages/config/src/main-instance.ts";
import {
  stopProcessGroupLeaderFirst,
  supportsProcessGroups,
} from "../packages/process-utils/src/index.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const requireFromRoot = createRequire(resolve(repoRoot, "package.json"));
const WORKTREE_RUNTIME_POLICY_ARG = "--worktree-runtime-policy";
const BUILD_TERMINATION_TIMEOUT_MS = 5_000;
const BUILD_KILL_GRACE_MS = 1_000;

function waitForProcess(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

export async function runBuildProcess(request) {
  let child;
  let stopPromise;
  const stopChild = () => {
    stopPromise ??= stopProcessGroupLeaderFirst({
      child,
      timeoutMs: BUILD_TERMINATION_TIMEOUT_MS,
      killGraceMs: BUILD_KILL_GRACE_MS,
    });
  };
  const handleSigint = () => stopChild();
  const handleSigterm = () => stopChild();
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  try {
    child = spawn(request.command, request.args, {
      cwd: request.cwd,
      detached: supportsProcessGroups(),
      env: request.env,
      stdio: "inherit",
    });
    const result = await waitForProcess(child);
    await stopPromise;
    return result;
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }
}

async function buildRuntimeArtifacts() {
  const turboEntrypoint = requireFromRoot.resolve("turbo/bin/turbo");
  const result = await runBuildProcess({
    args: [
      turboEntrypoint,
      "run",
      "build",
      "--filter=@bb/bundled-plugins",
      "--filter=@get-bb/plugin-sdk",
      "--filter=@bb/app",
      "--filter=@bb/server",
      "--filter=@bb/host-daemon",
      "--concurrency=4",
      "--output-logs=none",
      "--log-prefix=none",
      "--summarize=false",
      "--no-update-notifier",
    ],
    command: process.execPath,
    cwd: repoRoot,
    env: {
      ...process.env,
      BB_BUILD_TOOLCHAIN: `${process.version}-${process.platform}-${process.arch}`,
    },
  });
  if (result.code === 0) {
    return;
  }
  if (result.signal !== null) {
    throw new Error(`Runtime build stopped by ${result.signal}`);
  }
  throw new Error(`Runtime build failed with exit code ${result.code ?? 1}`);
}

export async function runNativeModulePreflight({
  checkOnly = false,
  cwd = repoRoot,
  env = process.env,
  nodePath = process.execPath,
  scriptPath = resolve(repoRoot, "scripts/ensure-native-modules.mjs"),
} = {}) {
  const result = await runBuildProcess({
    args: [scriptPath, ...(checkOnly ? ["--check"] : [])],
    command: nodePath,
    cwd,
    env,
  });
  if (result.code === 0) {
    return;
  }
  if (result.signal !== null) {
    throw new Error(`Native module preflight stopped by ${result.signal}`);
  }
  throw new Error(
    `Native module preflight failed with exit code ${result.code ?? 1}`,
  );
}

export function parseStartBbArgs(args) {
  if (args[0] !== WORKTREE_RUNTIME_POLICY_ARG) {
    return { cliArgs: args, useWorktreeRuntimePolicy: false };
  }
  return {
    cliArgs: args.slice(1),
    useWorktreeRuntimePolicy: true,
  };
}

export async function prepareRuntime() {
  await runNativeModulePreflight();
  await buildRuntimeArtifacts();
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.includes("--dryrun");
  const parsedArgs = parseStartBbArgs(args.filter((arg) => arg !== "--dryrun"));
  const firstArg = parsedArgs.cliArgs[0];
  const startup =
    firstArg === undefined || firstArg === "start" || firstArg.startsWith("-");
  if (startup && !args.includes("--help") && !args.includes("-h")) {
    if (await runMainInstanceLauncher({ sourceCheckoutPath: repoRoot, dryRun }))
      return;
    const mainInstance = resolveMainInstanceConfig({
      env: process.env,
      homeDir: homedir(),
    });
    if (mainInstance !== null) {
      const mainEnv = mainInstanceProcessEnv(mainInstance, process.env);
      mainEnv.BB_MAIN_INSTANCE_STARTING = "1";
      for (const key of Object.keys(process.env)) {
        if (!(key in mainEnv)) delete process.env[key];
      }
      Object.assign(process.env, mainEnv);
    }
  }
  await prepareRuntime();
  if (
    parsedArgs.cliArgs.includes("--help") ||
    parsedArgs.cliArgs.includes("-h")
  ) {
    process.stdout.write(
      "Source startup: --dryrun prepares artifacts and prints resolved paths/ports without starting services. It writes build outputs and may repair native modules.\n\n",
    );
  }
  const {
    resolveWorktreeRuntimePolicy,
    runBbApp,
    runSourceAppUpdateShim,
    shouldRunSourceAppUpdateShim,
  } = await import("../packages/bb-app/src/launcher.ts");
  const worktreePolicy = parsedArgs.useWorktreeRuntimePolicy
    ? resolveWorktreeRuntimePolicy({
        env: process.env,
        homeDir: homedir(),
      })
    : null;
  if (
    dryRun ||
    worktreePolicy !== null ||
    !shouldRunSourceAppUpdateShim(parsedArgs.cliArgs)
  ) {
    await runBbApp(parsedArgs.cliArgs, {
      dryRun,
      beforeServerStart: () => runNativeModulePreflight({ checkOnly: true }),
      worktreePolicy,
    });
    return;
  }
  process.exitCode = await runSourceAppUpdateShim({
    cliArgs: parsedArgs.cliArgs,
    launcherArgs: [
      "--conditions=source",
      "--import",
      "tsx",
      resolve(scriptDir, "start-bb-launcher.mjs"),
      ...parsedArgs.cliArgs,
    ],
    prepareRuntime,
    repoRoot,
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  await main();
}
