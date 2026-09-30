import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    environment: "node",
    env: { BB_ISOLATED_INSTANCE: "1" },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "bb-app",
      include: ["test/**/*.test.{mjs,ts}"],
    }),
  },
});
