import { widgetStyles } from "./ui/styles.js";
import { createChatView } from "./ui/chat.js";
import { createTextInput } from "./ui/input.js";
import { sendText } from "./modes/text.js";
import { startVoice, stopVoice } from "./modes/voice.js";
import { startRecording, stopAndUpload, setClipCallbacks } from "./modes/clip.js";
import { store } from "./store.js";

export interface WidgetInitConfig {
  token: string;
  serverUrl?: string;
  healthUrl?: string;
}

const DEFAULT_SERVER = "http://localhost:8290";
const DEFAULT_HEALTH = "http://localhost:8280/ready";

function generateSessionId(): string {
  return crypto.randomUUID();
}

export async function probeHealth(healthUrl: string): Promise<{ voiceAvailable: boolean; sttAvailable: boolean }> {
  try {
    const res = await fetch(healthUrl);
    if (!res.ok) {
      return { voiceAvailable: false, sttAvailable: false };
    }
    const body = (await res.json()) as { adapters?: Array<{ name: string; status: string }> };
    const adapters = body.adapters ?? [];
    const livekit = adapters.find((a) => a.name === "livekit");
    const cartesia = adapters.find((a) => a.name === "cartesia");
    return {
      voiceAvailable: livekit?.status === "healthy",
      sttAvailable: cartesia?.status === "healthy",
    };
  } catch {
    return { voiceAvailable: false, sttAvailable: false };
  }
}

export function mountWidget(shadow: ShadowRoot, onClose: () => void): void {
  const shell = document.createElement("div");
  shell.className = "crm-widget-shell";

  const banner = document.createElement("div");
  banner.className = "crm-widget-banner";
  shell.appendChild(banner);

  const header = document.createElement("div");
  header.className = "crm-widget-header";
  header.textContent = "Chat";
  const closeBtn = document.createElement("button");
  closeBtn.className = "crm-widget-close";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.tabIndex = 5;
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);
  shell.appendChild(header);

  const body = document.createElement("div");
  body.className = "crm-widget-body";
  shell.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "crm-widget-footer";
  shell.appendChild(footer);

  shadow.appendChild(shell);

  const chat = createChatView(body);
  const input = createTextInput(footer);

  const syncVoiceButton = (): void => {
    const { voiceAvailable, voiceConnecting, activeRoomName } = store.getState();
    if (!voiceAvailable) {
      input.setVoiceState("unavailable");
      return;
    }
    if (voiceConnecting) {
      input.setVoiceState("connecting");
      return;
    }
    if (activeRoomName) {
      input.setVoiceState("active");
      return;
    }
    input.setVoiceState("idle");
  };

  const syncMicButton = (): void => {
    const { sttAvailable } = store.getState();
    input.setMicState(sttAvailable ? "idle" : "unavailable");
  };

  syncVoiceButton();
  syncMicButton();
  store.subscribe("stateChange", () => {
    syncVoiceButton();
    syncMicButton();
  });
  store.subscribe("roomFinished", () => syncVoiceButton());
  store.subscribe("voiceUnavailable", () => syncVoiceButton());
  store.subscribe("sttUnavailable", () => syncMicButton());

  setClipCallbacks({
    onRecordingChange: (recording) => input.setMicState(recording ? "recording" : store.getState().sttAvailable ? "idle" : "unavailable"),
    onCountdown: (seconds) => input.setMicCountdown(seconds),
  });

  store.subscribe("token", (e) => {
    const content = (e as CustomEvent<{ content: string }>).detail.content;
    chat.appendToken(content);
  });

  store.subscribe("done", () => {
    chat.setLoading(false);
    input.setDisabled(false);
  });

  store.subscribe("transcript", (e) => {
    const content = (e as CustomEvent<{ content: string }>).detail.content;
    chat.appendTurn("customer", content, "clip");
    chat.appendTurn("assistant", "", "clip");
    chat.setLoading(true);
    input.setDisabled(true);
  });

  store.subscribe("stateChange", (e) => {
    const detail = (e as CustomEvent<{ patch?: { banner?: string | null } }>).detail;
    if (detail.patch && "banner" in detail.patch) {
      banner.textContent = detail.patch.banner ?? "";
      banner.classList.toggle("visible", Boolean(detail.patch.banner));
    }
  });

  input.onSend(async (message) => {
    const { sessionId, token, serverUrl, blocked } = store.getState();
    if (!sessionId || !token || blocked) return;

    chat.appendTurn("customer", message, "text");
    chat.appendTurn("assistant", "", "text");
    chat.setLoading(true);
    input.setDisabled(true);
    store.patch({ loading: true });

    await sendText(sessionId, message, token, serverUrl);
    if (store.getState().loading) {
      chat.setLoading(false);
      input.setDisabled(false);
      store.patch({ loading: false });
    }
  });

  input.onVoiceToggle(async () => {
    const { sessionId, token, serverUrl, activeRoomName, blocked, voiceAvailable } = store.getState();
    if (!sessionId || !token || blocked || !voiceAvailable) return;

    if (activeRoomName) {
      await stopVoice(activeRoomName, token, serverUrl);
      syncVoiceButton();
      return;
    }

    await startVoice(sessionId, token, serverUrl);
    syncVoiceButton();
  });

  input.onMicPressStart(() => {
    const { blocked, sttAvailable } = store.getState();
    if (blocked || !sttAvailable) return;
    void startRecording().catch(() => store.sttUnavailable());
  });

  input.onMicPressEnd(() => {
    const { sessionId, token, serverUrl, blocked } = store.getState();
    if (!sessionId || !token || blocked) return;
    void stopAndUpload(sessionId, token, serverUrl).then((result) => {
      if (!result.ok && store.getState().loading) {
        chat.setLoading(false);
        input.setDisabled(false);
        store.patch({ loading: false });
      }
    });
  });

  shadow.addEventListener("keydown", (e) => {
    if (e instanceof KeyboardEvent && e.key === "Escape") {
      onClose();
    }
  });

  (shadow as ShadowRoot & { __crmShell?: HTMLDivElement }).__crmShell = shell;
}

export async function initWidget(config: WidgetInitConfig): Promise<void> {
  if (!config.token) {
    throw new Error("crmWidget.init requires token");
  }
  const serverUrl = config.serverUrl ?? DEFAULT_SERVER;
  const healthUrl = config.healthUrl ?? DEFAULT_HEALTH;
  const health = await probeHealth(healthUrl);

  store.patch({
    token: config.token,
    serverUrl,
    sessionId: generateSessionId(),
    messages: [],
    loading: false,
    blocked: false,
    banner: null,
    voiceAvailable: health.voiceAvailable,
    sttAvailable: health.sttAvailable,
    activeRoomName: null,
    voiceConnecting: false,
  });
}

export function openWidget(shadow: ShadowRoot): void {
  const shell = (shadow as ShadowRoot & { __crmShell?: HTMLDivElement }).__crmShell;
  shell?.classList.add("open");
}

export function closeWidget(shadow: ShadowRoot): void {
  const shell = (shadow as ShadowRoot & { __crmShell?: HTMLDivElement }).__crmShell;
  shell?.classList.remove("open");
}

export function destroyWidget(shadow: ShadowRoot): void {
  const { activeRoomName, token, serverUrl } = store.getState();
  if (activeRoomName && token) {
    void stopVoice(activeRoomName, token, serverUrl);
  }
  closeWidget(shadow);
  store.reset();
  shadow.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = widgetStyles;
  shadow.appendChild(style);
}
