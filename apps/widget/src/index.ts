import { widgetStyles } from "./ui/styles.js";
import {
  closeWidget,
  destroyWidget,
  initWidget,
  mountWidget,
  openWidget,
  type WidgetInitConfig,
} from "./widget.js";

type CrmWidgetCommand =
  | { method: "init"; args: [WidgetInitConfig] }
  | { method: "open" | "close" | "destroy"; args: [] };

declare global {
  interface Window {
    crmWidget?: CrmWidgetApi;
  }
}

export interface CrmWidgetApi {
  init(config: WidgetInitConfig): void;
  open(): void;
  close(): void;
  destroy(): void;
}

class CrmWidgetElement extends HTMLElement {
  connectedCallback(): void {
    if (this.shadowRoot) return;
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = widgetStyles;
    shadow.appendChild(style);
  }

  async init(config: WidgetInitConfig): Promise<void> {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    if (!shadow.querySelector("style")) {
      const style = document.createElement("style");
      style.textContent = widgetStyles;
      shadow.appendChild(style);
    }
    if (!shadow.querySelector(".crm-widget-shell")) {
      mountWidget(shadow, () => this.close());
    }
    await initWidget(config);
  }

  open(): void {
    if (this.shadowRoot) openWidget(this.shadowRoot);
  }

  close(): void {
    if (this.shadowRoot) closeWidget(this.shadowRoot);
  }

  destroy(): void {
    if (this.shadowRoot) destroyWidget(this.shadowRoot);
    this.remove();
  }
}

if (!customElements.get("crm-widget")) {
  customElements.define("crm-widget", CrmWidgetElement);
}

const commandQueue: CrmWidgetCommand[] = [];
let widgetElement: CrmWidgetElement | null = null;
let initialized = false;

function ensureElement(): CrmWidgetElement {
  if (!widgetElement) {
    widgetElement = document.querySelector("crm-widget") ?? new CrmWidgetElement();
    if (!widgetElement.isConnected) {
      document.body.appendChild(widgetElement);
    }
  }
  return widgetElement;
}

async function drainQueue(): Promise<void> {
  while (commandQueue.length > 0) {
    const cmd = commandQueue.shift()!;
    const el = ensureElement();
    if (cmd.method === "init") {
      await el.init(cmd.args[0]);
      initialized = true;
    } else if (initialized) {
      el[cmd.method]();
    }
  }
}

const api: CrmWidgetApi = {
  init(config) {
    commandQueue.push({ method: "init", args: [config] });
    void drainQueue();
  },
  open() {
    commandQueue.push({ method: "open", args: [] });
    void drainQueue();
  },
  close() {
    commandQueue.push({ method: "close", args: [] });
    void drainQueue();
  },
  destroy() {
    commandQueue.push({ method: "destroy", args: [] });
    void drainQueue();
    initialized = false;
    widgetElement = null;
  },
};

window.crmWidget = api;

export { api as crmWidget };
