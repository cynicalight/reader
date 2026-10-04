import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: {
      deps: {
        // Lobe Avatar imports UI modules that load Emoji Mart JSON through Vite.
        inline: [/@lobehub\/ui/, /@emoji-mart\/data/],
      },
    },
  },
});
