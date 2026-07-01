import { store } from "../store.js";

export type VoiceToggleState = "idle" | "connecting" | "active" | "unavailable";
export type MicButtonState = "idle" | "recording" | "unavailable";

export interface TextInputView {
  setDisabled(disabled: boolean): void;
  onSend(handler: (message: string) => void): void;
  focus(): void;
  setVoiceState(state: VoiceToggleState): void;
  onVoiceToggle(handler: () => void): void;
  setMicState(state: MicButtonState): void;
  setMicCountdown(seconds: number): void;
  onMicPressStart(handler: () => void): void;
  onMicPressEnd(handler: () => void): void;
}

export function createTextInput(container: HTMLElement): TextInputView {
  const row = document.createElement("div");
  row.className = "crm-widget-input-row";

  const textarea = document.createElement("textarea");
  textarea.className = "crm-widget-input";
  textarea.placeholder = "Ask me anything about your account…";
  textarea.setAttribute("aria-label", "Message");
  textarea.rows = 1;

  const actions = document.createElement("div");
  actions.className = "crm-widget-input-actions";

  const micWrap = document.createElement("div");
  micWrap.className = "crm-widget-mic-wrap";

  const micBtn = document.createElement("button");
  micBtn.type = "button";
  micBtn.className = "crm-widget-mic";
  micBtn.textContent = "🎤";
  micBtn.setAttribute("aria-label", "Hold to record voice clip");
  micBtn.title = "Hold to record";

  const micRing = document.createElement("span");
  micRing.className = "crm-widget-mic-ring";
  micRing.setAttribute("aria-hidden", "true");

  const micTimer = document.createElement("span");
  micTimer.className = "crm-widget-mic-timer";
  micTimer.setAttribute("aria-live", "polite");

  micWrap.append(micRing, micBtn, micTimer);

  const voiceBtn = document.createElement("button");
  voiceBtn.type = "button";
  voiceBtn.className = "crm-widget-voice-toggle";
  voiceBtn.textContent = "🎙";
  voiceBtn.setAttribute("aria-label", "Toggle live voice");
  voiceBtn.title = "Live voice";

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "crm-widget-send";
  sendBtn.textContent = "Send";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.tabIndex = 2;

  micBtn.tabIndex = 3;
  voiceBtn.tabIndex = 4;
  textarea.tabIndex = 1;

  actions.append(sendBtn, micWrap, voiceBtn);
  row.append(textarea, actions);
  container.append(row);

  let sendHandler: ((message: string) => void) | null = null;
  let voiceHandler: (() => void) | null = null;
  let micStartHandler: (() => void) | null = null;
  let micEndHandler: (() => void) | null = null;

  const submit = (): void => {
    const message = textarea.value.trim();
    if (!message || textarea.disabled || !sendHandler) return;
    sendHandler(message);
    textarea.value = "";
  };

  sendBtn.addEventListener("click", submit);
  voiceBtn.addEventListener("click", () => voiceHandler?.());

  micBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    micStartHandler?.();
  });
  micBtn.addEventListener("pointerup", () => micEndHandler?.());
  micBtn.addEventListener("pointerleave", () => {
    if (micBtn.classList.contains("recording")) micEndHandler?.();
  });
  micBtn.addEventListener("pointercancel", () => micEndHandler?.());

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  const view: TextInputView = {
    setDisabled(disabled) {
      textarea.disabled = disabled;
      sendBtn.disabled = disabled;
    },
    onSend(handler) {
      sendHandler = handler;
    },
    focus() {
      textarea.focus();
    },
    setVoiceState(state) {
      voiceBtn.classList.remove("connecting", "active", "unavailable");
      voiceBtn.disabled = state === "unavailable" || state === "connecting";
      if (state === "connecting") {
        voiceBtn.classList.add("connecting");
        voiceBtn.title = "Connecting voice…";
      } else if (state === "active") {
        voiceBtn.classList.add("active");
        voiceBtn.title = "End live voice";
        voiceBtn.setAttribute("aria-pressed", "true");
      } else if (state === "unavailable") {
        voiceBtn.classList.add("unavailable");
        voiceBtn.title = "Voice temporarily unavailable";
        voiceBtn.setAttribute("aria-pressed", "false");
      } else {
        voiceBtn.title = "Start live voice";
        voiceBtn.setAttribute("aria-pressed", "false");
      }
    },
    onVoiceToggle(handler) {
      voiceHandler = handler;
    },
    setMicState(state) {
      micBtn.classList.remove("recording", "unavailable");
      micRing.classList.remove("active");
      if (state === "recording") {
        micBtn.classList.add("recording");
        micRing.classList.add("active");
        micBtn.title = "Release to send";
      } else if (state === "unavailable") {
        micBtn.classList.add("unavailable");
        micBtn.disabled = true;
        micBtn.title = "Voice transcription unavailable";
      } else {
        micBtn.disabled = false;
        micBtn.title = "Hold to record";
      }
    },
    setMicCountdown(seconds) {
      micTimer.textContent = seconds > 0 ? `${seconds}s` : "";
    },
    onMicPressStart(handler) {
      micStartHandler = handler;
    },
    onMicPressEnd(handler) {
      micEndHandler = handler;
    },
  };

  store.subscribe("voiceUnavailable", () => {
    view.setVoiceState("unavailable");
  });
  store.subscribe("sttUnavailable", () => {
    view.setMicState("unavailable");
  });

  return view;
}
