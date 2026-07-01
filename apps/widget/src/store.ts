export type WidgetMode = "text" | "clip" | "voice";

export interface Turn {
  role: "customer" | "assistant";
  content: string;
  inputMode?: WidgetMode;
}

export interface WidgetState {
  mode: WidgetMode;
  messages: Turn[];
  voiceAvailable: boolean;
  sttAvailable: boolean;
  sessionId: string | null;
  token: string | null;
  serverUrl: string;
  loading: boolean;
  blocked: boolean;
  banner: string | null;
  activeRoomName: string | null;
  voiceConnecting: boolean;
}

const INITIAL_STATE: WidgetState = {
  mode: "text",
  messages: [],
  voiceAvailable: true,
  sttAvailable: true,
  sessionId: null,
  token: null,
  serverUrl: "http://localhost:8290",
  loading: false,
  blocked: false,
  banner: null,
  activeRoomName: null,
  voiceConnecting: false,
};

class WidgetStore extends EventTarget {
  private state: WidgetState = { ...INITIAL_STATE };

  getState(): Readonly<WidgetState> {
    return this.state;
  }

  dispatch<K extends keyof WidgetState>(key: K, value: WidgetState[K]): void {
    this.state = { ...this.state, [key]: value };
    this.dispatchEvent(new CustomEvent("stateChange", { detail: { key, value } }));
  }

  patch(patch: Partial<WidgetState>): void {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent("stateChange", { detail: { patch } }));
  }

  appendToken(content: string): void {
    this.dispatchEvent(new CustomEvent("token", { detail: { content } }));
  }

  done(): void {
    this.patch({ loading: false });
    this.dispatchEvent(new CustomEvent("done"));
  }

  sessionExpired(): void {
    this.patch({ blocked: true, loading: false, banner: "Session expired — please refresh to continue" });
    this.dispatchEvent(new CustomEvent("sessionExpired"));
  }

  rateLimited(retryAfterMs: number): void {
    this.patch({
      loading: false,
      banner: "You're sending messages too quickly — please wait a moment.",
    });
    this.dispatchEvent(new CustomEvent("rateLimited", { detail: { retryAfterMs } }));
    setTimeout(() => this.patch({ banner: null }), retryAfterMs);
  }

  degraded(_mode: string): void {
    this.patch({ loading: false });
    this.dispatchEvent(new CustomEvent("degraded", { detail: { mode: _mode } }));
  }

  voiceUnavailable(reason: string): void {
    this.patch({
      voiceAvailable: false,
      voiceConnecting: false,
      mode: "text",
      activeRoomName: null,
      banner:
        reason === "csp"
          ? "Voice blocked by browser security settings — use text chat"
          : reason === "degraded"
            ? "Live voice is temporarily unavailable. Use the voice clip button instead."
            : "Voice temporarily unavailable",
    });
    this.dispatchEvent(new CustomEvent("voiceUnavailable", { detail: { reason } }));
  }

  roomFinished(): void {
    this.patch({
      mode: "text",
      activeRoomName: null,
      voiceConnecting: false,
      banner: "Voice connection lost — switching to text chat",
    });
    this.dispatchEvent(new CustomEvent("roomFinished"));
  }

  sttUnavailable(): void {
    this.patch({
      sttAvailable: false,
      loading: false,
      banner: "Voice transcription temporarily unavailable — please type instead",
    });
    this.dispatchEvent(new CustomEvent("sttUnavailable"));
  }

  emitTranscript(content: string): void {
    this.dispatchEvent(new CustomEvent("transcript", { detail: { content } }));
  }

  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.dispatchEvent(new CustomEvent("reset"));
  }

  subscribe(event: string, handler: (e: Event) => void): () => void {
    this.addEventListener(event, handler);
    return () => this.removeEventListener(event, handler);
  }
}

export const store = new WidgetStore();

export function subscribeToKey<K extends keyof WidgetState>(
  key: K,
  handler: (value: WidgetState[K]) => void
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ key?: K; value?: WidgetState[K]; patch?: Partial<WidgetState> }>).detail;
    if (detail.key === key && detail.value !== undefined) {
      handler(detail.value);
    } else if (detail.patch && key in detail.patch) {
      handler(detail.patch[key] as WidgetState[K]);
    }
  };
  store.addEventListener("stateChange", listener);
  return () => store.removeEventListener("stateChange", listener);
}
