// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComposerView } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { PluginComposerViewContext } from "@/components/plugin/plugin-composer-host";
import { useComposerView } from "./plugin-sdk-hooks";

const mocks = vi.hoisted(() => ({ usePromptDraftStorage: vi.fn() }));

vi.mock("@/hooks/usePromptDraftStorage", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/hooks/usePromptDraftStorage")
  >();
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
    <div data-testid="selected-provider">
      {view.experimental_selectedProviderId ?? "null"}
    </div>
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
});
