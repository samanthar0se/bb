import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);

it("registers the main instance offline and can clear a broken preference through the source CLI wrapper", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "bb-cli-main-instance-"));
  const repoRoot = resolve(import.meta.dirname, "../../../..");
  const dataDir = join(homeDir, "data");
  const configPath = join(homeDir, ".bb-main-instance.json");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    NODE_ENV: "development",
    BB_SERVER_URL: "http://127.0.0.1:1",
  };
  delete env.BB_CLI;
  delete env.BB_CLI_REEXEC;
  const cli = (args: string[]) =>
    execFileAsync(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        "packages/scripts/src/commands/run-cli.ts",
        "main-instance",
        ...args,
      ],
      { cwd: repoRoot, env },
    );
  try {
    await mkdir(dataDir);
    const set = await cli([
      "set",
      "--checkout",
      repoRoot,
      "--data-dir",
      dataDir,
      "--server-port",
      "21942",
      "--host-daemon-port",
      "29942",
      "--json",
    ]);
    expect(JSON.parse(set.stdout)).toMatchObject({
      path: configPath,
      config: {
        checkoutPath: repoRoot,
        dataDir,
        serverPort: 21942,
        hostDaemonPort: 29942,
      },
    });
    const show = await cli(["show", "--json"]);
    expect(JSON.parse(show.stdout).config).toEqual(
      JSON.parse(await readFile(configPath, "utf8")),
    );
    await writeFile(configPath, "invalid-json");
    await expect(cli(["show", "--json"])).rejects.toThrow(
      "Invalid main BB instance",
    );
    const clear = await cli(["clear", "--json"]);
    expect(JSON.parse(clear.stdout)).toEqual({ cleared: true });
    expect(
      JSON.parse((await cli(["show", "--json"])).stdout).config,
    ).toBeNull();
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}, 15_000);
