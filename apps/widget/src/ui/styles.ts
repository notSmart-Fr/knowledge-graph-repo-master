export const widgetStyles = `
:host {
  --crm-primary: #2563eb;
  --crm-bg: #ffffff;
  --crm-text: #111827;
  --crm-border: #e5e7eb;
  --crm-customer-bg: #eff6ff;
  --crm-assistant-bg: #f3f4f6;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  color: var(--crm-text);
}
@media (prefers-color-scheme: dark) {
  :host {
    --crm-primary: #3b82f6;
    --crm-bg: #111827;
    --crm-text: #f9fafb;
    --crm-border: #374151;
    --crm-customer-bg: #1e3a5f;
    --crm-assistant-bg: #1f2937;
  }
}
.crm-widget-shell {
  display: none;
  flex-direction: column;
  width: 360px;
  max-height: 520px;
  border: 1px solid var(--crm-border);
  border-radius: 12px;
  background: var(--crm-bg);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  overflow: hidden;
}
.crm-widget-shell.open { display: flex; }
.crm-widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--crm-primary);
  color: #fff;
  font-weight: 600;
}
.crm-widget-close {
  background: transparent;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.crm-widget-body {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
  min-height: 200px;
}
.crm-widget-messages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.crm-widget-bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  line-height: 1.4;
  word-break: break-word;
}
.crm-widget-bubble.customer {
  align-self: flex-end;
  background: var(--crm-customer-bg);
}
.crm-widget-bubble.assistant {
  align-self: flex-start;
  background: var(--crm-assistant-bg);
}
.crm-widget-footer {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--crm-border);
  align-items: flex-end;
}
.crm-widget-input {
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  resize: none;
  border: 1px solid var(--crm-border);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  background: var(--crm-bg);
  color: var(--crm-text);
}
.crm-widget-send {
  background: var(--crm-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
  font-weight: 600;
}
.crm-widget-send:disabled,
.crm-widget-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.crm-widget-spinner {
  display: none;
  align-self: center;
  width: 20px;
  height: 20px;
  border: 2px solid var(--crm-border);
  border-top-color: var(--crm-primary);
  border-radius: 50%;
  animation: crm-spin 0.8s linear infinite;
}
.crm-widget-spinner.visible { display: block; }
@keyframes crm-spin { to { transform: rotate(360deg); } }
.crm-widget-banner {
  display: none;
  padding: 8px 12px;
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
}
.crm-widget-banner.visible { display: block; }
`;
