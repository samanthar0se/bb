import type { JsonObject } from "@bb/domain";
import { validatePluginMetadata } from "@bb/domain";

const STORAGE_PREFIX = "bb.promptbox.plugin-metadata.";
const MAX_BYTES = 256 * 1024;
type Listener = () => void;
type MetadataMap = Record<string, JsonObject>;
const cache = new Map<string, MetadataMap>();
const listeners = new Map<string, Set<Listener>>();

function storageKeyForDraft(draftStorageKey: string): string {
  return `${STORAGE_PREFIX}${draftStorageKey}`;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function read(draftStorageKey: string): MetadataMap {
  const cached = cache.get(draftStorageKey);
  if (cached) return cached;
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(
      storageKeyForDraft(draftStorageKey),
    );
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    const result: MetadataMap = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [pluginId, metadata] of Object.entries(parsed)) {
        try {
          result[pluginId] = clone(validatePluginMetadata(metadata));
        } catch {}
      }
    }
    cache.set(draftStorageKey, result);
    return result;
  } catch {
    return {};
  }
}
function emit(draftStorageKey: string): void {
  for (const listener of listeners.get(draftStorageKey) ?? []) listener();
}
function write(draftStorageKey: string, next: MetadataMap): void {
  const serialized = JSON.stringify(next);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BYTES) {
    throw new Error("Plugin draft metadata exceeds 256 KiB.");
  }
  if (typeof window !== "undefined") {
    if (Object.keys(next).length === 0)
      window.localStorage.removeItem(storageKeyForDraft(draftStorageKey));
    else
      window.localStorage.setItem(
        storageKeyForDraft(draftStorageKey),
        serialized,
      );
  }
  cache.set(draftStorageKey, clone(next));
  emit(draftStorageKey);
}
export function getPluginDraftMetadata(
  draftStorageKey: string,
  pluginId: string,
): JsonObject {
  return clone(read(draftStorageKey)[pluginId] ?? {});
}
export function setPluginDraftMetadata(
  draftStorageKey: string,
  pluginId: string,
  value: JsonObject,
): void {
  const next = { ...read(draftStorageKey) };
  const validated = validatePluginMetadata(value);
  if (Object.keys(validated).length === 0) delete next[pluginId];
  else next[pluginId] = clone(validated);
  write(draftStorageKey, next);
}
export function getAllPluginDraftMetadata(
  draftStorageKey: string,
): MetadataMap {
  return clone(read(draftStorageKey));
}
export function clearPluginDraftMetadataIfCurrentMatches(
  draftStorageKey: string,
  snapshot: MetadataMap,
): boolean {
  const current = read(draftStorageKey);
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) return false;
  write(draftStorageKey, {});
  return true;
}
export function restorePluginDraftMetadataIfEmpty(
  draftStorageKey: string,
  snapshot: MetadataMap,
): boolean {
  if (
    Object.keys(read(draftStorageKey)).length > 0 ||
    Object.keys(snapshot).length === 0
  )
    return false;
  write(draftStorageKey, clone(snapshot));
  return true;
}
export function subscribePluginDraftMetadata(
  draftStorageKey: string,
  listener: Listener,
): () => void {
  const set = listeners.get(draftStorageKey) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(draftStorageKey, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(draftStorageKey);
  };
}
