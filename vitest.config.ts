import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.spec.ts"],
    // Pre-bundle @opencode-ai/plugin so Vite resolves its extensionless ESM imports
    server: {
      deps: {
        inline: ["@opencode-ai/plugin"],
      },
    },
  },
});
