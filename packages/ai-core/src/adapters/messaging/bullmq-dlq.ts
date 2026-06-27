import type { IDeadLetterQueue } from "../../core/ports.js";
import { IntegrationError } from "../../core/errors.js";

export class BullMQDeadLetterQueue implements IDeadLetterQueue {
  async enqueue(queue: string, job: Record<string, unknown>, errorMeta: Record<string, unknown>): Promise<void> {
    try {
      // In a real implementation, this would use BullMQ to enqueue to a DLQ
      // For now, just log it
      console.log(`[DLQ] Enqueued job to queue ${queue}`, { job, errorMeta });

      // TODO: Implement actual BullMQ DLQ logic
    } catch (err: unknown) {
      throw new IntegrationError(
        "DLQ_ENQUEUE_FAILED",
        "Failed to enqueue to dead letter queue",
        { originalError: String(err) }
      );
    }
  }
}
