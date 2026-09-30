// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerView } from "@/lib/plugin-sdk-hooks";
import { NewThreadPromptBoxUI } from "./NewThreadPromptBox";

vi.mock("@/components/promptbox/usePromptVoice", () => ({
  usePromptVoice: () => ({
    state: "idle",
    isSupported: false,
    stream: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

function SelectedProviderProbe() {
  const view = useComposerView();
  return (
    <div data-testid="selected-provider">
      {String(view.experimental_selectedProviderId)}
    </div>
  );
}

const props: ComponentProps<typeof NewThreadPromptBoxUI> = {
  value: "",
  mentionMenuPlacement: "bottom",
  mentionRanges: [],
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  isSubmitting: false,
  disabled: false,
  history: {
    currentDraft: { text: "", mentions: [], attachments: [] },
    entries: [],
    onSelectEntry: vi.fn(),
  },
  typeahead: {
    mention: {
      results: { groups: [], suggestions: [] },
      isLoading: false,
      isError: false,
      onQueryChange: vi.fn(),
    },
    command: {
      triggers: [],
      suggestions: [],
      isLoading: false,
      isError: false,
      hasMore: false,
      isLoadingMore: false,
      loadMore: vi.fn(),
      onQueryChange: vi.fn(),
    },
  },
  attachments: { items: [] },
  modeConfig: {
    environment: {
      value: "provider:personal-workspace",
      sources: [],
      host: null,
      isLocal: false,
    },
    worktree: { options: [], value: null, onChange: vi.fn() },
    permission: { options: [], onChange: vi.fn(), supported: false },
    header: <SelectedProviderProbe />,
  },
  execution: {
    provider: { selectedId: "codex" },
    model: {
      selected: "",
      options: [],
      moreOptions: [],
      isLoading: false,
      loadFailed: false,
      onChange: vi.fn(),
    },
    reasoning: { value: "medium", options: [], onChange: vi.fn() },
  },
};

afterEach(cleanup);

describe("NewThreadPromptBoxUI", () => {
  it("passes the selected provider through the production composer view as it changes", () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    const rendered = render(<NewThreadPromptBoxUI {...props} />, { wrapper });
    expect(screen.getByTestId("selected-provider").textContent).toBe("codex");

    rendered.rerender(
      <NewThreadPromptBoxUI
        {...props}
        execution={{
          ...props.execution,
          provider: { selectedId: "claude-code" },
        }}
      />,
    );
    expect(screen.getByTestId("selected-provider").textContent).toBe(
      "claude-code",
    );

    rendered.rerender(
      <NewThreadPromptBoxUI
        {...props}
        execution={{ ...props.execution, provider: { selectedId: undefined } }}
      />,
    );
    expect(screen.getByTestId("selected-provider").textContent).toBe("null");
  });
});
