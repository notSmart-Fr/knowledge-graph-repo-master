import type { WidgetMode } from "../store.js";

export interface ChatView {
  appendTurn(role: "customer" | "assistant", content: string, inputMode?: WidgetMode): void;
  appendToken(content: string): void;
  setLoading(loading: boolean): void;
  scrollToBottom(): void;
}

export function createChatView(container: HTMLElement): ChatView {
  const list = document.createElement("ul");
  list.className = "crm-widget-messages";
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");
  container.appendChild(list);

  const spinner = document.createElement("div");
  spinner.className = "crm-widget-spinner";
  spinner.setAttribute("aria-hidden", "true");
  container.appendChild(spinner);

  function scrollToBottom(): void {
    container.scrollTop = container.scrollHeight;
  }

  return {
    appendTurn(role, content, inputMode) {
      const li = document.createElement("li");
      const bubble = document.createElement("div");
      bubble.className = `crm-widget-bubble ${role}`;
      bubble.textContent = content;
      if (inputMode) {
        bubble.dataset.inputMode = inputMode;
      }
      li.appendChild(bubble);
      list.appendChild(li);
      scrollToBottom();
    },
    appendToken(content) {
      const last = list.lastElementChild?.querySelector(".crm-widget-bubble.assistant");
      if (last) {
        last.textContent = (last.textContent ?? "") + content;
      } else {
        const li = document.createElement("li");
        const bubble = document.createElement("div");
        bubble.className = "crm-widget-bubble assistant";
        bubble.textContent = content;
        li.appendChild(bubble);
        list.appendChild(li);
      }
      scrollToBottom();
    },
    setLoading(loading) {
      spinner.classList.toggle("visible", loading);
    },
    scrollToBottom,
  };
}
