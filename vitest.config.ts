import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The default 5s is too tight for the full suite on CI runners.
    testTimeout: 10_000,
    server: {
      deps: {
        // Lobe Avatar imports UI modules that load Emoji Mart JSON through Vite.
        inline: [/@lobehub\/ui/, /@emoji-mart\/data/],
      },
    },
  },
});
