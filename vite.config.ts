import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/v1-*.test.ts"]
  }
});
