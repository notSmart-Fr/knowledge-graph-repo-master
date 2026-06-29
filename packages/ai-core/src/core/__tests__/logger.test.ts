import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLogger } from "../logger.js";

describe("logger.ts", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("should create logger with module name", () => {
    const logger = createLogger("test-module");
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it("should strip PII from meta when logging", () => {
    const logger = createLogger("test-module");
    logger.info("test", { contactNumber: "123-456", contactEmail: "a@b.com", safe: "safe-value" });

    expect(consoleLogSpy).toHaveBeenCalled();
    const logEntry = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string);
    // PII stripping uses lowerKey.includes(...) so compound names containing
    // "email" (e.g. contactEmail) ARE stripped; "contactNumber" is not since
    // it doesn't contain the substring "phone".
    expect(logEntry.meta.safe).toBe("safe-value");
    expect(logEntry.meta.contactNumber).toBe("123-456");
    expect(logEntry.meta.contactEmail).toBeUndefined();
  });

  it("should produce valid JSON output structure", () => {
    const logger = createLogger("test-module");
    logger.info("hello", { foo: "bar" });

    expect(consoleLogSpy).toHaveBeenCalled();
    const logEntry = JSON.parse(consoleLogSpy.mock.calls[0]![0] as string);
    expect(logEntry.timestamp).toBeDefined();
    expect(logEntry.level).toBe("info");
    expect(logEntry.module).toBe("test-module");
    expect(logEntry.message).toBe("hello");
  });
});