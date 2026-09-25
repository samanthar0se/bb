// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/components/plugin/ComposerExtensionHost", () => ({
  useComposerExtensionController: () => ({}),
  ComposerExtensionHost: () => <div data-testid="root-composer-mounted" />,
}));

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
  it("renders the root composer without plugin context", () => {
    render(<NewThreadPromptBoxUI {...props} />);

    expect(screen.getByTestId("root-composer-mounted")).toBeTruthy();
  });
});
