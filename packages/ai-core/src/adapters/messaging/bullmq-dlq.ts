import { randomUUID } from "node:crypto";
import type { IDeadLetterQueue, DLQJobEntry, DLQErrorMeta } from "../../core/ports.js";
import { createLogger } from "../../core/logger.js";
import { IntegrationError } from "../../core/errors.js";

const logger = createLogger("dlq");

/**
 * Dead-letter queue with full operator lifecycle:
 *   enqueue → listDead → replay → purge
 *
 * ponytail: in-memory backing is sufficient for the free-tier MVP since BullMQ
 * requires ioredis + a worker host; the IDeadLetterQueue port lets us swap in
 * a real BullMQ adapter (or Supabase table) without touching call sites.
 * Each enqueued job is wrapped in a snapshot envelope so listDead returns
 * structurally stable rows even if the original job object mutates.
 */
export class InMemoryDeadLetterQueue implements IDeadLetterQueue {
  private queues: Map<string, DLQJobEntry[]> = new Map();
  private replayHandler?: (job: Record<string, unknown>, queue: string) => Promise<void>;

  onReplay(handler: (job: Record<string, unknown>, queue: string) => Promise<void>): void {
    this.replayHandler = handler;
  }

  async enqueue(
    queue: string,
    job: Record<string, unknown>,
    errorMeta: Record<string, unknown>,
  ): Promise<void> {
    try {
      const entry: DLQJobEntry = {
        id: randomUUID(),
        queue,
        job: this.cloneJob(job),
        errorMeta: this.normalizeMeta(errorMeta),
        enqueuedAt: new Date().toISOString(),
      };

      const bucket = this.queues.get(queue) ?? [];
      bucket.push(entry);
      this.queues.set(queue, bucket);
      logger.warn("DLQ enqueue", { queue, id: entry.id });
    } catch (err: unknown) {
      throw new IntegrationError(
        "DLQ_ENQUEUE_FAILED",
        "Failed to enqueue to dead letter queue",
        { originalError: String(err) },
      );
    }
  }

  async listDead(queue: string, limit?: number, offset?: number): Promise<DLQJobEntry[]> {
    const bucket = this.queues.get(queue) ?? [];
    const off = offset ?? 0;
    const lim = limit ?? bucket.length;
    return bucket.slice(off, off + lim).map((entry) => this.cloneEntry(entry));
  }

  async replay(queue: string, jobId: string): Promise<DLQJobEntry | null> {
    const bucket = this.queues.get(queue);
    if (!bucket) return null;

    const idx = bucket.findIndex((entry) => entry.id === jobId);
    if (idx === -1) return null;

    const entry = bucket[idx]!;
    if (!this.replayHandler) {
      logger.warn("DLQ replay called with no registered handler", { queue, jobId });
      return this.cloneEntry(entry);
    }

    try {
      await this.replayHandler(entry.job, queue);
      bucket.splice(idx, 1);
      logger.info("DLQ replay succeeded", { queue, jobId });
      return this.cloneEntry(entry);
    } catch (err: unknown) {
      logger.error("DLQ replay failed", { queue, jobId, error: String(err) });
      return this.cloneEntry(entry);
    }
  }

  async purge(queue: string): Promise<number> {
    const bucket = this.queues.get(queue);
    const count = bucket?.length ?? 0;
    this.queues.delete(queue);
    logger.info("DLQ purge", { queue, count });
    return count;
  }

  async depth(queue: string): Promise<number> {
    return this.queues.get(queue)?.length ?? 0;
  }

  /** Total jobs across all queues — used by /ready for SLA gate. */
  async totalDepth(): Promise<number> {
    let total = 0;
    for (const bucket of this.queues.values()) total += bucket.length;
    return total;
  }

  /** Snapshot of all queue depths — used by /ready. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, bucket] of this.queues) out[name] = bucket.length;
    return out;
  }

  private cloneJob(job: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(job)) as Record<string, unknown>;
  }

  private cloneEntry(entry: DLQJobEntry): DLQJobEntry {
    return {
      id: entry.id,
      queue: entry.queue,
      job: this.cloneJob(entry.job),
      errorMeta: { ...entry.errorMeta },
      enqueuedAt: entry.enqueuedAt,
    };
  }

  /**
   * Coerce arbitrary errorMeta to a DLQErrorMeta shape. Missing required
   * fields are filled with safe defaults so the contract never produces a
   * malformed entry.
   */
  private normalizeMeta(meta: Record<string, unknown>): DLQErrorMeta {
    const now = new Date().toISOString();
    return {
      errorCode: typeof meta.errorCode === "string" ? meta.errorCode : "UNKNOWN",
      errorMessage: typeof meta.errorMessage === "string" ? meta.errorMessage : "",
      attemptCount: typeof meta.attemptCount === "number" ? meta.attemptCount : 1,
      firstAttemptAt: typeof meta.firstAttemptAt === "string" ? meta.firstAttemptAt : now,
      lastAttemptAt: typeof meta.lastAttemptAt === "string" ? meta.lastAttemptAt : now,
      ...(typeof meta.nextRetryAt === "string" ? { nextRetryAt: meta.nextRetryAt } : {}),
    };
  }
}

// Singleton instance — shared across orchestrator + worker
let globalDLQ: InMemoryDeadLetterQueue | null = null;

export function getGlobalDLQ(): InMemoryDeadLetterQueue {
  if (!globalDLQ) globalDLQ = new InMemoryDeadLetterQueue();
  return globalDLQ;
}

// Backwards-compatible alias (existing port consumers expect BullMQ name)
export class BullMQDeadLetterQueue extends InMemoryDeadLetterQueue {}
