import { projectFiles } from "archunit";
import { describe, it, expect } from "vitest";

const excludeTests = { except: ["**/__tests__/**"] };

describe("Architecture Guardrails", () => {
  // ═══ Invariant 2: Strict Dependency Direction ═══

  it("core/ must NOT import from features/", async () => {
    const rule = projectFiles()
      .inFolder("packages/ai-core/src/core/**", excludeTests)
      .shouldNot()
      .dependOnFiles()
      .inFolder("packages/ai-core/src/features/**");
    await expect(rule).toPassAsync();
  });

  it("core/ must NOT import from adapters/", async () => {
    const rule = projectFiles()
      .inFolder("packages/ai-core/src/core/**", excludeTests)
      .shouldNot()
      .dependOnFiles()
      .inFolder("packages/ai-core/src/adapters/**");
    await expect(rule).toPassAsync();
  });

  it("adapters/ must NOT import from features/", async () => {
    const rule = projectFiles()
      .inFolder("packages/ai-core/src/adapters/**", excludeTests)
      .shouldNot()
      .dependOnFiles()
      .inFolder("packages/ai-core/src/features/**");
    await expect(rule).toPassAsync();
  });

  // ═══ Invariant 2: No circular dependencies in core ═══

  it("core/ must have no circular dependencies", async () => {
    const rule = projectFiles()
      .inFolder("packages/ai-core/src/core/**", excludeTests)
      .should()
      .haveNoCycles();
    await expect(rule).toPassAsync();
  });

  // ═══ Tech: LiveKit Client Boundary ═══
  // livekit-client is a browser-only SDK — must not be imported outside widget

  it('"livekit-client" must NOT be imported outside apps/widget/', async () => {
    const rule = projectFiles()
      .inPath("**/*.ts")
      .shouldNot()
      .adhereTo(
        (f) => {
          const p = f.path.replace(/\\/g, "/");
          // Whitelist — these paths are allowed to reference livekit-client
          if (p.includes("apps/widget/")) return false;
          if (p.includes("__tests__/")) return false;
          if (p.endsWith(".test.ts") || p.endsWith(".spec.ts")) return false;
          if (p.startsWith("scripts/")) return false;
          if (p.includes("vitest.config")) return false;
          if (p.includes(".archive/")) return false;
          // ponytail: shouldNot + true = violation — flag only if banned string found
          return f.content.includes("livekit-client");
        },
        "livekit-client is a browser SDK — only import from apps/widget/",
      );
    await expect(rule).toPassAsync();
  });
});
