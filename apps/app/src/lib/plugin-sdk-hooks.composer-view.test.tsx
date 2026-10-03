// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState, type ReactNode } from "react";
import type { PromptDraftState } from "@bb/client-core";
import type { ComposerView, PluginComposerApi } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { useComposer, useComposerView } from "./plugin-sdk-hooks";
import { PluginContext } from "@/components/plugin/plugin-context";
import {
  getPluginDraftMetadata,
  setPluginDraftMetadata,
  subscribePluginDraftMetadata,
} from "@/hooks/usePluginDraftMetadataStorage";

const mocks = vi.hoisted(() => ({
  usePromptDraftController: vi.fn(),
  view: undefined as ComposerView | undefined,
}));

vi.mock("@/components/plugin/plugin-composer-host", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/plugin/plugin-composer-host")
    >();
  return { ...actual, useOptionalPluginComposerView: () => mocks.view };
});

vi.mock("@/hooks/usePromptDraftStorage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/usePromptDraftStorage")>();
  return {
    ...actual,
    usePromptDraftController: (
      ...args: Parameters<typeof actual.usePromptDraftController>
    ) => {
      mocks.usePromptDraftController(...args);
      return actual.usePromptDraftController(...args);
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
  mocks.view = view;
  return (
    <MemoryRouter initialEntries={["/"]}>
      <ComposerViewProbe />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  mocks.view = undefined;
});

describe("useComposerView", () => {
  it("keeps hook order when the host view appears and disappears", () => {
    mocks.usePromptDraftController.mockClear();
    const view: ComposerView = {
      scope: { kind: "new-thread", projectId: null },
      layout: "expanded",
      experimental_selectedProviderId: "codex",
      draft: { text: "", isEmpty: true, attachmentCount: 0 },
      run: { isRunning: false, isSubmitting: false },
    };
    const rendered = render(<Harness view={view} />);
    expect(mocks.usePromptDraftController).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("selected-provider").textContent).toBe("codex");

    rendered.rerender(<Harness view={undefined} />);
    expect(mocks.usePromptDraftController).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("selected-provider").textContent).toBe("null");

    rendered.rerender(<Harness view={view} />);
    expect(mocks.usePromptDraftController).toHaveBeenCalledTimes(3);
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

function trackedHost(): PluginComposerHost {
  let draft: PromptDraftState = { text: "", mentions: [], attachments: [] };
  const listeners = new Set<() => void>();
  return {
    scope: { kind: "thread", threadId: "thr_tracking" },
    textEffectKey: "thread/thr_tracking",
    getCurrent: () => draft,
    subscribeDraft: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDraft: (next) => {
      draft = next;
      for (const listener of [...listeners]) listener();
    },
    focus: () => {},
  };
}

function TrackingHarness({
  host,
  children,
}: {
  host: PluginComposerHost;
  children: ReactNode;
}) {
  return (
    <MemoryRouter>
      <PluginContext.Provider value="tracking">
        <PluginComposerHostProvider value={host}>
          {children}
        </PluginComposerHostProvider>
      </PluginContext.Provider>
    </MemoryRouter>
  );
}

it("preserves upstream quiet draft consumers alongside local composer metadata subscriptions", () => {
  const host = trackedHost();
  const quiet = vi.fn<(composer: PluginComposerApi) => void>(),
    reading = vi.fn();
  function Quiet() {
    const composer = useComposer();
    quiet(composer);
    return (
      <button onClick={() => composer.updateText((t) => t + "!")}>
        update
      </button>
    );
  }
  function Reading() {
    const composer = useComposer();
    reading();
    return <div data-testid="tracking-text">{composer.text}</div>;
  }
  render(
    <TrackingHarness host={host}>
      <Quiet />
      <Reading />
    </TrackingHarness>,
  );
  const q = quiet.mock.calls.length,
    r = reading.mock.calls.length;
  for (const text of ["a", "ab", "abc"])
    act(() => host.setDraft({ text, mentions: [], attachments: [] }));
  expect(quiet).toHaveBeenCalledTimes(q);
  expect(reading).toHaveBeenCalledTimes(r + 3);
  expect(screen.getByTestId("tracking-text").textContent).toBe("abc");
  fireEvent.click(screen.getByText("update"));
  expect(host.getCurrent().text).toBe("abc!");
});

it("preserves upstream late draft tracking after a consumer starts reading", () => {
  const host = trackedHost();
  function Late() {
    const composer = useComposer();
    const [reading, setReading] = useState(false);
    return (
      <>
        <button onClick={() => setReading(true)}>read</button>
        <div data-testid="late-tracking">
          {reading ? composer.text : "not reading"}
        </div>
      </>
    );
  }
  render(
    <TrackingHarness host={host}>
      <Late />
    </TrackingHarness>,
  );
  act(() => host.setDraft({ text: "a", mentions: [], attachments: [] }));
  expect(screen.getByTestId("late-tracking").textContent).toBe("not reading");
  fireEvent.click(screen.getByText("read"));
  expect(screen.getByTestId("late-tracking").textContent).toBe("a");
  act(() => host.setDraft({ text: "ab", mentions: [], attachments: [] }));
  expect(screen.getByTestId("late-tracking").textContent).toBe("ab");
});
