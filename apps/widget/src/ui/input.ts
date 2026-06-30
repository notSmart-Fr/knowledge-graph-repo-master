export interface TextInputView {
  setDisabled(disabled: boolean): void;
  onSend(handler: (message: string) => void): void;
  focus(): void;
}

export function createTextInput(container: HTMLElement): TextInputView {
  const textarea = document.createElement("textarea");
  textarea.className = "crm-widget-input";
  textarea.placeholder = "Ask me anything about your account…";
  textarea.setAttribute("aria-label", "Message");
  textarea.rows = 1;

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "crm-widget-send";
  sendBtn.textContent = "Send";
  sendBtn.setAttribute("aria-label", "Send");

  container.append(textarea, sendBtn);

  let sendHandler: ((message: string) => void) | null = null;

  const submit = (): void => {
    const message = textarea.value.trim();
    if (!message || textarea.disabled || !sendHandler) return;
    sendHandler(message);
    textarea.value = "";
  };

  sendBtn.addEventListener("click", submit);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  return {
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
  };
}
