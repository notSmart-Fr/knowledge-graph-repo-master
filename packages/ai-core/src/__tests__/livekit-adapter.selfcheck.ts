/**
 * LiveKit room adapter self-check (T039)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const createRoom = vi.fn().mockResolvedValue(undefined);
const createDispatch = vi.fn().mockResolvedValue(undefined);
const listRooms = vi.fn();

vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: vi.fn().mockImplementation(() => ({
    createRoom,
    deleteRoom: vi.fn(),
    listRooms,
  })),
  AgentDispatchClient: vi.fn().mockImplementation(() => ({
    createDispatch,
  })),
  AccessToken: vi.fn().mockImplementation(() => ({
    addGrant: vi.fn(),
    toJwt: vi.fn().mockResolvedValue("participant-jwt"),
  })),
  WebhookReceiver: vi.fn().mockImplementation(() => ({
    receive: vi.fn(),
  })),
}));

import { LiveKitRoomAdapter } from "../adapters/livekit/livekit-room.adapter.js";
import {
  LK_SELFCHECK_API_KEY,
  LK_SELFCHECK_API_SECRET,
  LK_SELFCHECK_SERVER_URL,
} from "./livekit-adapter.selfcheck.config.js";

describe("livekit-adapter selfcheck", () => {
  beforeEach(() => {
    createRoom.mockClear();
    createDispatch.mockClear();
    listRooms.mockReset();
  });

  it("createWidgetRoom dispatches crm-voice-agent", async () => {
    const adapter = new LiveKitRoomAdapter({
      serverUrl: LK_SELFCHECK_SERVER_URL,
      apiKey: LK_SELFCHECK_API_KEY,
      apiSecret: LK_SELFCHECK_API_SECRET,
      agentName: "crm-voice-agent",
    });

    const result = await adapter.createWidgetRoom({
      contactId: "contact-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });

    expect(createRoom).toHaveBeenCalledOnce();
    expect(createDispatch).toHaveBeenCalledOnce();
    expect(createDispatch.mock.calls[0]?.[1]).toBe("crm-voice-agent");
    expect(result.participantToken).toBe("participant-jwt");
    expect(result.roomName).toMatch(/^widget-/);
  });

  it("healthCheck reflects listRooms success and failure", async () => {
    const adapter = new LiveKitRoomAdapter({
      serverUrl: LK_SELFCHECK_SERVER_URL,
      apiKey: LK_SELFCHECK_API_KEY,
      apiSecret: LK_SELFCHECK_API_SECRET,
    });

    listRooms.mockResolvedValueOnce([]);
    await expect(adapter.healthCheck()).resolves.toBe(true);

    listRooms.mockRejectedValueOnce(new Error("unreachable"));
    await expect(adapter.healthCheck()).resolves.toBe(false);
  });
});
