import { PLUGIN_METADATA_MAX_BYTES } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  createThreadRequestSchema,
  forkThreadRequestSchema,
  threadPluginMetadataQuerySchema,
  updateThreadPluginMetadataRequestSchema,
} from "../src/api/threads.js";

const createBase = {
  projectId: "project",
  origin: "plugin" as const,
  originPluginId: "linear",
  input: [{ type: "text" as const, text: "start" }],
  environment: {
    type: "host" as const,
    hostId: "host",
    workspace: { type: "unmanaged" as const, path: null },
  },
};

const forkBase = {
  sourceThreadId: "thread",
  origin: "plugin" as const,
  originPluginId: "linear",
};

const ORIGIN_MESSAGE = 'pluginMetadata requires origin "plugin"';
const ORIGIN_PLUGIN_ID_MESSAGE =
  "pluginMetadata requires originPluginId to be a valid plugin id";
const PLUGIN_ID_MESSAGE =
  "Invalid string: must match pattern /^[a-z0-9][a-z0-9-]*$/u";

function issuesOf(result: z.ZodSafeParseResult<unknown>) {
  return (
    result.error?.issues.map(({ message, path }) => ({ message, path })) ?? []
  );
}

describe("plugin metadata contracts", () => {
  it("accepts one namespace on create and fork", () => {
    const metadata = { nested: [true], count: 1 };

    expect(
      createThreadRequestSchema.parse({
        ...createBase,
        pluginMetadata: metadata,
      }).pluginMetadata,
    ).toEqual(metadata);
    expect(
      forkThreadRequestSchema.parse({ ...forkBase, pluginMetadata: metadata })
        .pluginMetadata,
    ).toEqual(metadata);
  });

  it("rejects pluginMetadata unless origin is plugin", () => {
    expect(
      issuesOf(
        createThreadRequestSchema.safeParse({
          ...createBase,
          origin: "sdk",
          originPluginId: undefined,
          pluginMetadata: {},
        }),
      ),
    ).toEqual([{ message: ORIGIN_MESSAGE, path: ["pluginMetadata"] }]);
    expect(
      issuesOf(
        forkThreadRequestSchema.safeParse({
          sourceThreadId: "thread",
          origin: "sdk",
          pluginMetadata: { marker: "raw-fork" },
        }),
      ),
    ).toEqual([{ message: ORIGIN_MESSAGE, path: ["pluginMetadata"] }]);
  });

  it("rejects per-plugin draft metadata on forks as an unknown request field", () => {
    const result = forkThreadRequestSchema.safeParse({
      ...forkBase,
      experimental_pluginMetadataByPlugin: { linear: { issue: "BB-42" } },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(({ message }) => message).join(" ")).toContain(
        "experimental_pluginMetadataByPlugin",
      );
    }
  });

  it("accepts per-plugin draft metadata for app, CLI, and SDK creation", () => {
    const metadata = { linear: { issue: "BB-42" } };

    for (const origin of ["app", "cli", "sdk"] as const) {
      expect(
        createThreadRequestSchema.parse({
          ...createBase,
          origin,
          originPluginId: undefined,
          experimental_pluginMetadataByPlugin: metadata,
        }).experimental_pluginMetadataByPlugin,
      ).toEqual(metadata);
    }
  });

  it("rejects per-plugin draft metadata for plugin-origin creation", () => {
    expect(
      issuesOf(
        createThreadRequestSchema.safeParse({
          ...createBase,
          experimental_pluginMetadataByPlugin: { linear: { issue: "BB-42" } },
        }),
      ),
    ).toEqual([
      {
        message:
          'experimental_pluginMetadataByPlugin cannot be used with origin "plugin"',
        path: ["experimental_pluginMetadataByPlugin"],
      },
    ]);
  });

  it.each([
    ["originKind", { originKind: "fork" }],
    ["sourceThreadId", { sourceThreadId: "source" }],
  ])("rejects per-plugin draft metadata with %s", (_field, forkFields) => {
    expect(
      createThreadRequestSchema.safeParse({
        ...createBase,
        origin: "sdk",
        originPluginId: undefined,
        experimental_pluginMetadataByPlugin: { linear: { issue: "BB-42" } },
        ...forkFields,
      }).success,
    ).toBe(false);
  });

  it("keeps aggregate size and JSON validation for per-plugin draft metadata", () => {
    const largeMetadata = {
      linear: { content: "a".repeat(140 * 1024) },
      slack: { content: "b".repeat(140 * 1024) },
    };

    expect(
      createThreadRequestSchema.safeParse({
        ...createBase,
        origin: "sdk",
        originPluginId: undefined,
        experimental_pluginMetadataByPlugin: largeMetadata,
      }).success,
    ).toBe(false);
    expect(
      createThreadRequestSchema.safeParse({
        ...createBase,
        origin: "sdk",
        originPluginId: undefined,
        experimental_pluginMetadataByPlugin: {
          linear: { issue: Number.NaN },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects pluginMetadata with a malformed originPluginId", () => {
    for (const originPluginId of ["Linear ", "../x"]) {
      expect(
        issuesOf(
          createThreadRequestSchema.safeParse({
            ...createBase,
            originPluginId,
            pluginMetadata: { a: 1 },
          }),
        ),
      ).toEqual([
        { message: ORIGIN_PLUGIN_ID_MESSAGE, path: ["originPluginId"] },
      ]);
      expect(
        issuesOf(
          forkThreadRequestSchema.safeParse({
            ...forkBase,
            originPluginId,
            pluginMetadata: { a: 1 },
          }),
        ),
      ).toEqual([
        { message: ORIGIN_PLUGIN_ID_MESSAGE, path: ["originPluginId"] },
      ]);
    }
  });

  it("keeps originPluginId validation unchanged without pluginMetadata", () => {
    expect(
      createThreadRequestSchema.safeParse({
        ...createBase,
        originPluginId: "Linear ",
      }).success,
    ).toBe(true);
    expect(
      forkThreadRequestSchema.safeParse({
        ...forkBase,
        originPluginId: "Linear ",
      }).success,
    ).toBe(true);
  });

  it("accepts a patch with set and remove", () => {
    expect(
      updateThreadPluginMetadataRequestSchema.parse({
        pluginId: "linear",
        set: { key: 1 },
        remove: ["old"],
      }),
    ).toEqual({ pluginId: "linear", set: { key: 1 }, remove: ["old"] });
  });

  it("rejects a malformed patch pluginId", () => {
    for (const pluginId of ["Linear ", "../x"]) {
      expect(
        issuesOf(
          updateThreadPluginMetadataRequestSchema.safeParse({
            pluginId,
            set: { a: 1 },
          }),
        ),
      ).toEqual([{ message: PLUGIN_ID_MESSAGE, path: ["pluginId"] }]);
    }
  });

  it("rejects a patch set over 256 KiB", () => {
    expect(
      issuesOf(
        updateThreadPluginMetadataRequestSchema.safeParse({
          pluginId: "linear",
          set: { big: "a".repeat(PLUGIN_METADATA_MAX_BYTES) },
        }),
      ),
    ).toEqual([{ message: "pluginMetadata exceeds 256 KiB", path: ["set"] }]);
  });

  it("rejects duplicate removes and set/remove overlap", () => {
    expect(
      issuesOf(
        updateThreadPluginMetadataRequestSchema.safeParse({
          pluginId: "linear",
          remove: ["x", "x"],
        }),
      ),
    ).toEqual([
      { message: "remove contains duplicate keys", path: ["remove"] },
    ]);
    expect(
      issuesOf(
        updateThreadPluginMetadataRequestSchema.safeParse({
          pluginId: "linear",
          set: { x: 1 },
          remove: ["x"],
        }),
      ),
    ).toEqual([{ message: "set and remove overlap", path: ["remove"] }]);
  });

  it("accepts toJSON as an ordinary data key", () => {
    expect(
      updateThreadPluginMetadataRequestSchema.parse({
        pluginId: "linear",
        set: { toJSON: 1, nested: { toJSON: "value" } },
      }),
    ).toEqual({
      pluginId: "linear",
      set: { toJSON: 1, nested: { toJSON: "value" } },
    });
  });

  it("rejects a malformed query pluginId", () => {
    expect(
      threadPluginMetadataQuerySchema.parse({ pluginId: "linear" }),
    ).toEqual({ pluginId: "linear" });
    expect(
      issuesOf(threadPluginMetadataQuerySchema.safeParse({ pluginId: "../x" })),
    ).toEqual([{ message: PLUGIN_ID_MESSAGE, path: ["pluginId"] }]);
  });
});
