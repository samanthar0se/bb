import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

const absolutePathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "Expected an absolute path");
const portSchema = z.number().int().min(1).max(65_535);
const mainInstanceSchema = z
  .strictObject({
    checkoutPath: absolutePathSchema,
    dataDir: absolutePathSchema,
    nodePath: absolutePathSchema,
    serverPort: portSchema,
    hostDaemonPort: portSchema,
    serverBindHost: z.enum(["127.0.0.1", "0.0.0.0"]),
  })
  .refine(
    (config) => config.serverPort !== config.hostDaemonPort,
    "Server and daemon ports must differ",
  );

export type MainInstanceConfig = z.infer<typeof mainInstanceSchema>;

export function mainInstanceConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, ".bb-main-instance.json");
}

export function readMainInstanceConfig(
  homeDir: string = homedir(),
): MainInstanceConfig | null {
  const path = mainInstanceConfigPath(homeDir);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
  try {
    return mainInstanceSchema.parse(JSON.parse(contents));
  } catch (error) {
    throw new Error(
      `Invalid main BB instance at ${path}; fix it or run bb main-instance clear`,
      { cause: error },
    );
  }
}

export function resolveMainInstanceConfig(args: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}): MainInstanceConfig | null {
  const isolated = args.env.BB_ISOLATED_INSTANCE;
  if (isolated === "1") return null;
  if (isolated !== undefined && isolated !== "0")
    throw new Error("BB_ISOLATED_INSTANCE must be 0 or 1");
  return readMainInstanceConfig(args.homeDir);
}

export function mainInstanceServerUrl(config: MainInstanceConfig): string {
  return `http://127.0.0.1:${config.serverPort}`;
}

export function mainInstanceProcessEnv(
  config: MainInstanceConfig,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...env,
    BB_DATA_DIR: config.dataDir,
    BB_SERVER_URL: mainInstanceServerUrl(config),
    BB_SERVER_PORT: String(config.serverPort),
    BB_HOST_DAEMON_PORT: String(config.hostDaemonPort),
    BB_SERVER_BIND_HOST: config.serverBindHost,
    NODE_ENV: "production",
  };
  for (const key of [
    "BB_DEV_APP_PORT",
    "BB_DEV_CONNECT_BASE_URL",
    "BB_INHERITED_SKILLS_ROOTS",
    "BB_PROJECT_ID",
    "BB_THREAD_ID",
    "BB_ENVIRONMENT_ID",
    "BB_THREAD_STORAGE",
    "BB_CLI",
    "BB_CLI_REEXEC",
    "ELECTRON_RUN_AS_NODE",
  ])
    delete result[key];
  delete result.BB_APP_URL;
  delete result.BB_MAIN_INSTANCE_STARTING;
  for (const key of Object.keys(result)) {
    if (
      key === "CLAUDECODE" ||
      (key.startsWith("CLAUDE_") && key !== "CLAUDE_CONFIG_DIR")
    )
      delete result[key];
  }
  return result;
}

export async function writeMainInstanceConfig(
  config: MainInstanceConfig,
  homeDir: string = homedir(),
): Promise<void> {
  const parsed = mainInstanceSchema.parse(config);
  for (const path of [parsed.checkoutPath, parsed.dataDir]) {
    if (!(await stat(path)).isDirectory())
      throw new Error(`Expected a directory: ${path}`);
  }
  for (const path of [
    parsed.nodePath,
    join(parsed.checkoutPath, "scripts/start-bb.mjs"),
  ]) {
    if (!(await stat(path)).isFile())
      throw new Error(`Expected a file: ${path}`);
  }
  const path = mainInstanceConfigPath(homeDir);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function clearMainInstanceConfig(
  homeDir: string = homedir(),
): Promise<void> {
  await rm(mainInstanceConfigPath(homeDir), { force: true });
}
