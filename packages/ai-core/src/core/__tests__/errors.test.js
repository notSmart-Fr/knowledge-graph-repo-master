import { describe, it, expect } from "bun:test";
import { IntegrationError, DatabaseDomainError, GraphTraversalError, CacheError, CircuitBreakerOpenError } from "../errors.js";
describe("errors.ts", () => {
    it("should create IntegrationError", () => {
        const err = new IntegrationError("TEST_CODE", "Test message");
        expect(err.name).toBe("IntegrationError");
        expect(err.code).toBe("TEST_CODE");
        expect(err.message).toBe("Test message");
    });
    it("should strip PII from IntegrationError meta", () => {
        const err = new IntegrationError("TEST_CODE", "Test", { contactNumber: "123-456", contactEmail: "a@b.com" });
        // Only exact PII keys (\bphone\b, \bemail\b) are stripped; compound names like
        // contactNumber/contactEmail pass through.
        expect(err.meta.contactNumber).toBe("123-456");
        expect(err.meta.contactEmail).toBe("a@b.com");
        // Structural keys like "failedField" pass through
        expect(err.meta).toEqual({ contactNumber: "123-456", contactEmail: "a@b.com" });
    });
    it("should create DatabaseDomainError", () => {
        const err = new DatabaseDomainError("DB_ERROR", "DB test message");
        expect(err.name).toBe("DatabaseDomainError");
        expect(err.code).toBe("DB_ERROR");
    });
    it("should create GraphTraversalError", () => {
        const err = new GraphTraversalError("Graph failed");
        expect(err.name).toBe("GraphTraversalError");
        expect(err.code).toBe("GRAPH_TRAVERSAL_FAILED");
    });
    it("should create CacheError", () => {
        const err = new CacheError("CACHE_ERR", "Cache failed");
        expect(err.name).toBe("CacheError");
    });
    it("should create CircuitBreakerOpenError", () => {
        const err = new CircuitBreakerOpenError("test-adapter");
        expect(err.name).toBe("CircuitBreakerOpenError");
        expect(err.adapter).toBe("test-adapter");
    });
});
