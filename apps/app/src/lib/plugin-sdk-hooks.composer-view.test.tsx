// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
  PluginComposerViewContext,
} from "@/components/plugin/plugin-composer-host";
import { useComposerView } from "./plugin-sdk-hooks";
import { PluginContext } from "@/components/plugin/plugin-context";
import {
  getPluginDraftMetadata,
  setPluginDraftMetadata,
  subscribePluginDraftMetadata,
} from "@/hooks/usePluginDraftMetadataStorage";

const mocks = vi.hoisted(() => ({ usePromptDraftStorage: vi.fn() }));

vi.mock("@/hooks/usePromptDraftStorage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/usePromptDraftStorage")>();
  return {
    ...actual,
    usePromptDraftStorage: (
      ...args: Parameters<typeof actual.usePromptDraftStorage>
    ) => {
      mocks.usePromptDraftStorage(...args);
      return actual.usePromptDraftStorage(...args);
    },
  };
});

function ComposerViewProbe() {
  const view = useComposerView();
  return (
    <>
      <div data-testid="selected-provider">
        {view.experimental_selectedProviderId ?? "null"}
      </div>
      <div data-testid="metadata">
        {JSON.stringify(view.experimental_pluginMetadata)}
      </div>
    </>
  );
}

function Harness({ view }: { view: ComposerView | undefined }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <PluginComposerViewContext.Provider value={view}>
        <ComposerViewProbe />
      </PluginComposerViewContext.Provider>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe("useComposerView", () => {
  it("keeps hook order when the host view appears and disappears", () => {
    mocks.usePromptDraftStorage.mockClear();
    const view: ComposerView = {
      scope: { kind: "new-thread", projectId: null },
      layout: "expanded",
      experimental_selectedProviderId: "codex",
      draft: { text: "", isEmpty: true, attachmentCount: 0 },
      run: { isRunning: false, isSubmitting: false },
    };
    const rendered = render(<Harness view={view} />);
    expect(mocks.usePromptDraftStorage).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("selected-provider").textContent).toBe("codex");

    rendered.rerender(<Harness view={undefined} />);
    expect(mocks.usePromptDraftStorage).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("selected-provider").textContent).toBe("null");

    rendered.rerender(<Harness view={view} />);
    expect(mocks.usePromptDraftStorage).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("selected-provider").textContent).toBe("codex");
  });
  it("keeps legacy view metadata reactive and scoped to the calling plugin", () => {
    const key = "legacy-view-metadata";
    const draft = { text: "", mentions: [], attachments: [] };
    const host: PluginComposerHost = {
      scope: { kind: "new-thread", projectId: null },
      textEffectKey: key,
      getCurrent: () => draft,
      subscribeDraft: () => () => {},
      setDraft: () => {},
      focus: () => {},
      getPluginMetadata: (id) => getPluginDraftMetadata(key, id),
      subscribePluginMetadata: (listener) =>
        subscribePluginDraftMetadata(key, listener),
    };
    setPluginDraftMetadata(key, "alpha", { issue: "BB-42" });
    setPluginDraftMetadata(key, "beta", { issue: "BB-43" });
    const element = (pluginId: string) => (
      <PluginContext.Provider value={pluginId}>
        <PluginComposerHostProvider value={host}>
          <MemoryRouter>
            <ComposerViewProbe />
          </MemoryRouter>
        </PluginComposerHostProvider>
      </PluginContext.Provider>
    );
    const rendered = render(element("alpha"));
    expect(screen.getByTestId("metadata").textContent).toBe(
      '{"issue":"BB-42"}',
    );
    act(() => setPluginDraftMetadata(key, "alpha", { issue: "BB-44" }));
    expect(screen.getByTestId("metadata").textContent).toBe(
      '{"issue":"BB-44"}',
    );
    rendered.rerender(element("beta"));
    expect(screen.getByTestId("metadata").textContent).toBe(
      '{"issue":"BB-43"}',
    );
  });
});
