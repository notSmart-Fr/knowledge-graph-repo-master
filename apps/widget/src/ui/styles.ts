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
  padding: 12px;
  border-top: 1px solid var(--crm-border);
}
.crm-widget-input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.crm-widget-input-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.crm-widget-voice-toggle {
  background: var(--crm-assistant-bg);
  border: 1px solid var(--crm-border);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.crm-widget-voice-toggle.active {
  background: var(--crm-primary);
  border-color: var(--crm-primary);
}
.crm-widget-voice-toggle.unavailable {
  opacity: 0.4;
  cursor: not-allowed;
}
.crm-widget-voice-toggle.connecting {
  opacity: 0.7;
  animation: crm-spin 1s linear infinite;
}
.crm-widget-mic-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.crm-widget-mic {
  background: var(--crm-assistant-bg);
  border: 1px solid var(--crm-border);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  position: relative;
  z-index: 1;
}
.crm-widget-mic.recording {
  background: #fee2e2;
  border-color: #ef4444;
}
.crm-widget-mic.unavailable {
  opacity: 0.4;
  cursor: not-allowed;
}
.crm-widget-mic-ring {
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid transparent;
  pointer-events: none;
}
.crm-widget-mic-ring.active {
  border-color: #ef4444;
  animation: crm-pulse 1.2s ease-out infinite;
}
.crm-widget-mic-timer {
  position: absolute;
  top: -18px;
  font-size: 11px;
  color: #ef4444;
  white-space: nowrap;
}
@keyframes crm-pulse {
  0% { transform: scale(0.9); opacity: 1; }
  100% { transform: scale(1.3); opacity: 0; }
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
