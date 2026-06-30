import { defineConfig, mergeConfig } from "vitest/config";
import rootConfig from "../../scripts/vitest.config.js";

export default mergeConfig(
  rootConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "src/**/*.selfcheck.ts"],
    },
  })
);
