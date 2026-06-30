import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";
import type {
  AgentDispatchOptions,
  ILiveKitRoomManager,
  LiveKitRoomDetails,
  LiveKitWebhookEvent,
} from "../../core/ports.js";
import { IntegrationError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import crypto from "node:crypto";

const logger = createLogger("livekit-room-adapter");
const tracer = trace.getTracer("ai-crm-livekit", "1.0.0");

export interface LiveKitRoomAdapterConfig {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret?: string;
  agentName?: string;
}

function roomNameForSession(sessionId: string): string {
  return `widget-${sessionId}-${crypto.randomBytes(4).toString("hex")}`;
}

export class LiveKitRoomAdapter implements ILiveKitRoomManager {
  private readonly roomClient: RoomServiceClient;
  private readonly dispatchClient: AgentDispatchClient;
  private readonly webhookReceiver: WebhookReceiver;
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly agentName: string;

  constructor(config: LiveKitRoomAdapterConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.agentName = config.agentName ?? "crm-voice-agent";
    this.roomClient = new RoomServiceClient(this.serverUrl, this.apiKey, this.apiSecret);
    this.dispatchClient = new AgentDispatchClient(this.serverUrl, this.apiKey, this.apiSecret);
    this.webhookReceiver = new WebhookReceiver(this.apiKey, config.webhookSecret ?? this.apiSecret);
  }

  async createWidgetRoom(options: AgentDispatchOptions): Promise<LiveKitRoomDetails> {
    return tracer.startActiveSpan("livekit.createWidgetRoom", async (span) => {
      span.setAttribute("channel", "widget");
      try {
        const roomName = roomNameForSession(options.sessionId);
        await this.roomClient.createRoom({
          name: roomName,
          emptyTimeout: 300,
          maxParticipants: 2,
        });

        const metadata = JSON.stringify({
          contactId: options.contactId,
          sessionId: options.sessionId,
        });
        await this.dispatchClient.createDispatch(roomName, this.agentName, { metadata });

        const token = new AccessToken(this.apiKey, this.apiSecret, {
          identity: options.contactId,
          ttl: "15m",
        });
        token.addGrant({
          roomJoin: true,
          room: roomName,
          canPublish: true,
          canSubscribe: true,
        });
        const participantToken = await token.toJwt();

        span.setAttribute("room_name", roomName);
        return {
          roomName,
          participantToken,
          serverUrl: this.serverUrl,
        };
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        logger.error("createWidgetRoom failed", { error: String(error) });
        throw new IntegrationError("LIVEKIT_ROOM_CREATE_FAILED", "Failed to create widget room", {
          sessionId: options.sessionId,
        });
      } finally {
        span.end();
      }
    });
  }

  async closeRoom(roomName: string): Promise<void> {
    return tracer.startActiveSpan("livekit.closeRoom", async (span) => {
      span.setAttribute("room_name", roomName);
      try {
        await this.roomClient.deleteRoom(roomName);
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        logger.error("closeRoom failed", { error: String(error) });
        throw new IntegrationError("LIVEKIT_ROOM_CLOSE_FAILED", "Failed to close room", { roomName });
      } finally {
        span.end();
      }
    });
  }

  async verifyWebhook(body: string, authHeader: string): Promise<LiveKitWebhookEvent> {
    return tracer.startActiveSpan("livekit.verifyWebhook", async (span) => {
      try {
        const event = await this.webhookReceiver.receive(body, authHeader);
        span.setAttribute("event_type", event.event);
        return {
          event: event.event,
          room: event.room ? { name: event.room.name } : undefined,
          participant: event.participant
            ? { identity: event.participant.identity, kind: event.participant.kind }
            : undefined,
        };
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw new IntegrationError("LIVEKIT_WEBHOOK_INVALID", "Webhook verification failed");
      } finally {
        span.end();
      }
    });
  }

  async healthCheck(): Promise<boolean> {
    return tracer.startActiveSpan("livekit.healthCheck", async (span) => {
      try {
        await this.roomClient.listRooms();
        return true;
      } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        logger.warn("LiveKit health check failed", { error: String(error) });
        return false;
      } finally {
        span.end();
      }
    });
  }
}
