import { store } from "../store.js";
import { handleUnauthorized } from "../auth.js";

const LIVEKIT_CDN =
  "https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/dist/livekit-client.umd.min.js";

declare global {
  interface Window {
    LivekitClient?: typeof import("livekit-client");
  }
}

async function loadLiveKitClient(): Promise<typeof import("livekit-client")> {
  if (window.LivekitClient) return window.LivekitClient;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-crm-livekit="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("livekit load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = LIVEKIT_CDN;
    script.async = true;
    script.dataset.crmLivekit = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("livekit load failed"));
    document.head.appendChild(script);
  });

  if (!window.LivekitClient) {
    throw new Error("livekit-client global missing after script load");
  }
  return window.LivekitClient;
}

export interface VoiceSession {
  roomName: string;
  disconnect: () => Promise<void>;
}

let activeRoom: import("livekit-client").Room | null = null;

export async function startVoice(
  sessionId: string,
  token: string,
  serverUrl: string
): Promise<VoiceSession | null> {
  if (store.getState().blocked || !store.getState().voiceAvailable) {
    return null;
  }

  store.patch({ voiceConnecting: true, mode: "voice" });

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/widget/room`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    store.voiceUnavailable("network");
    return null;
  }

  if (response.status === 401) {
    await handleUnauthorized(response);
    return null;
  }
  if (response.status === 429) {
    const body = (await response.json()) as { retryAfterMs?: number };
    store.rateLimited(body.retryAfterMs ?? 5000);
    store.patch({ voiceConnecting: false, mode: "text" });
    return null;
  }
  if (response.status === 503) {
    store.voiceUnavailable("degraded");
    return null;
  }
  if (response.status === 409) {
    store.patch({ voiceConnecting: false, banner: "Voice session already active" });
    return null;
  }
  if (!response.ok) {
    store.patch({ voiceConnecting: false, mode: "text" });
    return null;
  }

  const payload = (await response.json()) as {
    serverUrl: string;
    participantToken: string;
    roomName: string;
  };

  try {
    const { Room, RoomEvent, Track } = await loadLiveKitClient();
    const room = new Room();
    activeRoom = room;

    room.on(RoomEvent.Disconnected, () => {
      if (store.getState().activeRoomName === payload.roomName) {
        store.roomFinished();
      }
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.play().catch(() => undefined);
      }
    });

    await room.connect(payload.serverUrl, payload.participantToken);
    await room.localParticipant.setMicrophoneEnabled(true);

    store.patch({
      activeRoomName: payload.roomName,
      voiceConnecting: false,
      mode: "voice",
      banner: null,
    });

    return {
      roomName: payload.roomName,
      disconnect: async () => {
        await stopVoice(payload.roomName, token, serverUrl);
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Content Security Policy") || message.includes("csp")) {
      store.voiceUnavailable("csp");
    } else {
      store.voiceUnavailable("connect");
    }
    activeRoom = null;
    return null;
  }
}

export async function stopVoice(roomName: string, token: string, serverUrl: string): Promise<void> {
  if (activeRoom) {
    try {
      await activeRoom.disconnect();
    } catch {
      // ponytail: best-effort disconnect
    }
    activeRoom = null;
  }

  try {
    await fetch(`${serverUrl}/widget/room/${encodeURIComponent(roomName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // server cleanup may still happen via webhook
  }

  store.patch({ activeRoomName: null, voiceConnecting: false, mode: "text" });
}
