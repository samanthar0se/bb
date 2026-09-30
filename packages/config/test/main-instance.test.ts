import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadCliConfig } from "../src/cli.js";
import { runMainInstanceLauncher } from "../src/main-instance-launch.js";
import {
  clearMainInstanceConfig,
  mainInstanceConfigPath,
  readMainInstanceConfig,
  resolveMainInstanceConfig,
  writeMainInstanceConfig,
  type MainInstanceConfig,
} from "../src/main-instance.js";
import { writeBbAppRuntimeFile } from "../src/app-runtime-file.js";
import { withFileLock } from "../src/file-lock.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: Server[] = [];
const repoRoot = resolve(import.meta.dirname, "../../..");

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP listener");
  return address.port;
}

async function fixture(): Promise<{
  homeDir: string;
  config: MainInstanceConfig;
}> {
  const homeDir = await mkdtemp(join(tmpdir(), "bb-main-instance-"));
  roots.push(homeDir);
  const checkoutPath = join(homeDir, "canonical-checkout");
  const dataDir = join(homeDir, "main-data");
  await mkdir(join(checkoutPath, "scripts"), { recursive: true });
  await mkdir(dataDir);
  await symlink(
    join(repoRoot, "node_modules"),
    join(checkoutPath, "node_modules"),
    "dir",
  );
  await writeFile(
    join(checkoutPath, "scripts/start-bb.mjs"),
    'import { writeFileSync } from "node:fs"; writeFileSync("started.json", JSON.stringify({ argv: process.argv.slice(2), dataDir: process.env.BB_DATA_DIR, serverPort: process.env.BB_SERVER_PORT, hostDaemonPort: process.env.BB_HOST_DAEMON_PORT, parentThread: process.env.BB_THREAD_ID, claudeSession: process.env.CLAUDECODE }));\n',
  );
  const vacantServer = createServer();
  const serverPort = await listen(vacantServer);
  await new Promise<void>((done) => vacantServer.close(() => done()));
  servers.splice(servers.indexOf(vacantServer), 1);
  return {
    homeDir,
    config: {
      checkoutPath,
      dataDir,
      nodePath: process.execPath,
      serverPort,
      hostDaemonPort: serverPort === 65_535 ? 65_534 : serverPort + 1,
      serverBindHost: "127.0.0.1",
    },
  };
}

describe("main instance startup policy", () => {
  it("does not launch another server during an in-progress preparation and allows explicit isolation", async () => {
    const { homeDir, config } = await fixture();
    await writeMainInstanceConfig(config, homeDir);
    await withFileLock({
      path: join(config.dataDir, "main-instance-start.lock"),
      timeoutMs: 0,
      work: async () => {
        await expect(
          runMainInstanceLauncher({
            homeDir,
            env: {},
            sourceCheckoutPath: repoRoot,
            dryRun: false,
          }),
        ).rejects.toThrow("already starting");
        await expect(
          runMainInstanceLauncher({
            homeDir,
            env: { BB_ISOLATED_INSTANCE: "1" },
            sourceCheckoutPath: repoRoot,
            dryRun: false,
          }),
        ).resolves.toBe(false);
      },
    });
    await expect(
      readFile(join(config.checkoutPath, "started.json")),
    ).rejects.toThrow();
  });
  it("refuses malformed preferences instead of falling back, while clear and explicit isolation still work", async () => {
    const { homeDir } = await fixture();
    await writeFile(mainInstanceConfigPath(homeDir), '{"dataDir":"relative"}');
    expect(() => resolveMainInstanceConfig({ homeDir, env: {} })).toThrow(
      "Invalid main BB instance",
    );
    expect(
      resolveMainInstanceConfig({
        homeDir,
        env: { BB_ISOLATED_INSTANCE: "1" },
      }),
    ).toBeNull();
    expect(() =>
      resolveMainInstanceConfig({
        homeDir,
        env: { BB_ISOLATED_INSTANCE: "yes" },
      }),
    ).toThrow("must be 0 or 1");
    await clearMainInstanceConfig(homeDir);
    expect(readMainInstanceConfig(homeDir)).toBeNull();
  });

  it("keeps the previous preference when a replacement checkout is missing and routes standalone CLI defaults to main", async () => {
    const { homeDir, config } = await fixture();
    await writeMainInstanceConfig(config, homeDir);
    await expect(
      writeMainInstanceConfig(
        { ...config, checkoutPath: join(homeDir, "missing") },
        homeDir,
      ),
    ).rejects.toThrow();
    expect(readMainInstanceConfig(homeDir)).toEqual(config);
    expect(loadCliConfig({ homeDir, env: {}, mode: "prod" })).toEqual({
      BB_SERVER_URL: `http://127.0.0.1:${config.serverPort}`,
      BB_HOST_DAEMON_PORT: config.hostDaemonPort,
    });
    expect(
      loadCliConfig({
        homeDir,
        env: {
          BB_SERVER_URL: "https://remote.example",
          BB_HOST_DAEMON_PORT: "49999",
        },
        mode: "prod",
      }),
    ).toEqual({
      BB_SERVER_URL: "https://remote.example",
      BB_HOST_DAEMON_PORT: 49999,
    });
    expect(
      loadCliConfig({
        homeDir,
        env: { BB_ISOLATED_INSTANCE: "1" },
        mode: "prod",
      }).BB_SERVER_URL,
    ).toBe("http://127.0.0.1:38886");
  });

  it("starts only the registered checkout with canonical selectors and without parent agent context", async () => {
    const { homeDir, config } = await fixture();
    await writeMainInstanceConfig(config, homeDir);
    await expect(
      runMainInstanceLauncher({
        homeDir,
        env: {
          BB_DATA_DIR: join(homeDir, "wrong-data"),
          BB_SERVER_PORT: "44444",
          BB_THREAD_ID: "thr_parent",
          CLAUDECODE: "1",
        },
        sourceCheckoutPath: join(homeDir, "other-checkout"),
        dryRun: false,
      }),
    ).resolves.toBe(true);
    const observed = JSON.parse(
      await readFile(join(config.checkoutPath, "started.json"), "utf8"),
    );
    expect(observed).toMatchObject({
      dataDir: config.dataDir,
      serverPort: String(config.serverPort),
      hostDaemonPort: String(config.hostDaemonPort),
    });
    expect(observed.parentThread).toBeUndefined();
    expect(observed.claudeSession).toBeUndefined();
    await expect(readFile(join(homeDir, "wrong-data/bb.db"))).rejects.toThrow();
  });

  it("makes the real source launcher attach before building and refuses a server with a different data store", async () => {
    const { homeDir, config } = await fixture();
    let servedDataDir = config.dataDir;
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          dataDir: servedDataDir,
          hostDaemonPort: config.hostDaemonPort,
        }),
      );
    });
    config.serverPort = await listen(server);
    config.hostDaemonPort =
      config.serverPort === 65_535 ? 65_534 : config.serverPort + 1;
    await writeMainInstanceConfig(config, homeDir);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir };
    delete env.BB_ISOLATED_INSTANCE;
    delete env.BB_MAIN_INSTANCE_STARTING;
    for (const argv of [
      [
        join(repoRoot, "scripts/start-bb.mjs"),
        "--data-dir",
        join(homeDir, "wrong-data"),
      ],
      [
        join(repoRoot, "packages/scripts/src/commands/run-dev.ts"),
        "--worktree",
      ],
      [
        join(repoRoot, "packages/scripts/src/commands/run-desktop.ts"),
        "--worktree",
      ],
    ]) {
      const result = await execFileAsync(
        process.execPath,
        ["--conditions=source", "--import", "tsx", ...argv],
        { cwd: repoRoot, env },
      );
      expect(result.stdout).toContain(
        `Using the main BB instance at http://127.0.0.1:${config.serverPort}`,
      );
      expect(result.stdout).not.toContain("turbo");
    }
    await expect(
      readFile(join(config.checkoutPath, "started.json")),
    ).rejects.toThrow();
    servedDataDir = join(homeDir, "wrong-data");
    await expect(
      runMainInstanceLauncher({
        homeDir,
        env: {},
        sourceCheckoutPath: repoRoot,
        dryRun: false,
      }),
    ).rejects.toThrow("does not match");
  });

  it("refuses to rebuild a live but unresponsive main server and leaves dry runs side-effect free", async () => {
    const { homeDir, config } = await fixture();
    await writeMainInstanceConfig(config, homeDir);
    await writeBbAppRuntimeFile({
      dataDir: config.dataDir,
      entryPath: join(config.checkoutPath, "scripts/start-bb.mjs"),
      pid: process.pid,
      surface: "web",
      serverUrl: `http://127.0.0.1:${config.serverPort}`,
      startedAt: new Date().toISOString(),
      version: "0.44.0",
    });
    await expect(
      runMainInstanceLauncher({
        homeDir,
        env: {},
        sourceCheckoutPath: config.checkoutPath,
        dryRun: false,
      }),
    ).rejects.toThrow("starting or unresponsive");
    await expect(
      runMainInstanceLauncher({
        homeDir,
        env: {},
        sourceCheckoutPath: config.checkoutPath,
        dryRun: true,
      }),
    ).resolves.toBe(true);
    await expect(
      readFile(join(config.checkoutPath, "started.json")),
    ).rejects.toThrow();
    await expect(
      readFile(join(config.dataDir, "main-instance-start.lock")),
    ).rejects.toThrow();
  });
});
