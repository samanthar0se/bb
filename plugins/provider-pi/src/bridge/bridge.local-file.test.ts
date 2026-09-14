import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

let harness: FakePiBridgeHarness;

function providerThreadIdFor(threadId: string): string {
  const identity = [...harness.messages]
    .reverse()
    .find(
      (message) =>
        message.method === "thread/identity" &&
        (message.params as { threadId?: unknown }).threadId === threadId,
    );
  const providerThreadId = (identity?.params as { providerThreadId?: unknown })
    .providerThreadId;
  expect(typeof providerThreadId).toBe("string");
  if (typeof providerThreadId !== "string") throw new Error("missing provider thread identity");
  return providerThreadId;
}

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-local-file-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

function localFile(path: string) {
  return {
    type: "localFile" as const,
    path,
    name: "notes.md",
    sizeBytes: 6,
    mimeType: "text/markdown",
  };
}

it("includes local file paths in turn prompts", async () => {
  const threadId = "thr_local_file_turn";
  const path = join(harness.workspaceDir, "notes.md");
  const marker = `[Attached file: ${path}]`;
  await harness.startThread(threadId);

  const providerThreadId = providerThreadIdFor(threadId);
  const response = await harness.request(1, "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_ab23456789",
    input: [
      { type: "text", text: "Read this file.", mentions: [] },
      localFile(path),
    ],
    options: FULL_PERMISSION_OPTIONS,
  });

  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({ threadId });
  await harness.waitForTurnBoundary(threadId);
  expect(
    harness.deltasOf(threadId).some(
      (delta) =>
        delta.kind === "item.textDelta" &&
        String(delta.text).includes(`Read this file.\n${marker}`),
    ),
  ).toBe(true);
});

it("accepts a turn prompt that contains only a local file", async () => {
  const threadId = "thr_local_file_only";
  const path = join(harness.workspaceDir, "notes.md");
  await harness.startThread(threadId);

  const response = await harness.request(2, "turn/start", {
    threadId,
    providerThreadId: providerThreadIdFor(threadId),
    clientRequestId: "creq_cd23456789",
    input: [localFile(path)],
    options: FULL_PERMISSION_OPTIONS,
  });

  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({ threadId });
});

it("includes local file paths in steer prompts", async () => {
  const threadId = "thr_local_file_steer";
  const path = join(harness.workspaceDir, "notes.md");
  const marker = `[Attached file: ${path}]`;
  await harness.startThread(threadId);
  const providerThreadId = providerThreadIdFor(threadId);
  await harness.request(3, "turn/start", {
    threadId,
    providerThreadId,
    clientRequestId: "creq_ef23456789",
    input: [{ type: "text", text: "/hold", mentions: [] }],
    options: FULL_PERMISSION_OPTIONS,
  });
  await harness.waitForDelta(threadId, (delta) => delta.kind === "turn.open");

  const response = await harness.request(4, "turn/steer", {
    threadId,
    providerThreadId,
    expectedTurnId: "turn-1",
    clientRequestId: "creq_gh23456789",
    input: [localFile(path)],
    options: FULL_PERMISSION_OPTIONS,
  });

  expect(response.error).toBeUndefined();
  expect(response.result).toEqual({ threadId });
  await harness.waitForTurnBoundary(threadId);
  expect(
    harness.deltasOf(threadId).some(
      (delta) =>
        delta.kind === "item.textDelta" &&
        String(delta.text).includes(marker),
    ),
  ).toBe(true);
});
