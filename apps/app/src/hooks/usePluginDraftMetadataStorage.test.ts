import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPluginDraftMetadata,
  setPluginDraftMetadata,
  subscribePluginDraftMetadata,
} from "./usePluginDraftMetadataStorage";
const storage = {
  values: new Map<string, string>(),
  getItem(name: string) {
    return this.values.get(name) ?? null;
  },
  setItem(name: string, value: string) {
    this.values.set(name, value);
  },
  removeItem(name: string) {
    this.values.delete(name);
  },
};
beforeEach(() => {
  vi.stubGlobal("window", { localStorage: storage });
  storage.values.clear();
});
afterEach(() => vi.unstubAllGlobals());
describe("plugin draft metadata storage", () => {
  it("isolates plugin namespaces and persists by exact draft key", () => {
    const key = `bb.promptbox.contents-draft-${Math.random()}`;
    setPluginDraftMetadata(key, "alpha", { value: 1 });
    setPluginDraftMetadata(key, "beta", { value: 2 });
    expect(getPluginDraftMetadata(key, "alpha")).toEqual({ value: 1 });
    expect(getPluginDraftMetadata(key, "beta")).toEqual({ value: 2 });
    expect(storage.values.keys().next().value).toContain(key);
  });
  it("isolates exact keys and reloads retained metadata", () => {
    const rootKey = "bb.promptbox.contents-draft-3";
    const otherKey = "bb.promptbox.contents-draft-other";
    const reloadKey = "bb.promptbox.contents-draft-reload";
    storage.values.set(
      "bb.promptbox.plugin-metadata." + rootKey,
      JSON.stringify({ alpha: { retained: true } }),
    );
    storage.values.set(
      "bb.promptbox.plugin-metadata." + otherKey,
      JSON.stringify({ alpha: { other: true } }),
    );
    expect(getPluginDraftMetadata(rootKey, "alpha")).toEqual({ retained: true });
    expect(getPluginDraftMetadata(otherKey, "alpha")).toEqual({ other: true });
    storage.values.set(
      "bb.promptbox.plugin-metadata." + reloadKey,
      JSON.stringify({ alpha: { reloaded: true } }),
    );
    expect(getPluginDraftMetadata(reloadKey, "alpha")).toEqual({ reloaded: true });
  });

  it("does not publish or change the snapshot when durable writes fail", () => {
    const key = `bb.promptbox.contents-draft-${Math.random()}`;
    setPluginDraftMetadata(key, "alpha", { value: 1 });
    const listener = vi.fn();
    const unsubscribe = subscribePluginDraftMetadata(key, listener);
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setPluginDraftMetadata(key, "alpha", { value: 2 })).toThrow(
      "quota",
    );
    expect(getPluginDraftMetadata(key, "alpha")).toEqual({ value: 1 });
    expect(listener).not.toHaveBeenCalled();
    setItem.mockRestore();
    unsubscribe();
  });
  it("does not publish or change the snapshot when durable removal fails", () => {
    const key = `bb.promptbox.contents-draft-${Math.random()}`;
    setPluginDraftMetadata(key, "alpha", { value: 1 });
    const listener = vi.fn();
    const unsubscribe = subscribePluginDraftMetadata(key, listener);
    const removeItem = vi
      .spyOn(storage, "removeItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(() => setPluginDraftMetadata(key, "alpha", {})).toThrow("blocked");
    expect(getPluginDraftMetadata(key, "alpha")).toEqual({ value: 1 });
    expect(listener).not.toHaveBeenCalled();
    removeItem.mockRestore();
    unsubscribe();
  });
});
