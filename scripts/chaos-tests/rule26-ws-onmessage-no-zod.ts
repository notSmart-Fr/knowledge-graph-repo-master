// @ts-nocheck
// Chaos: Rule 26 — ws.onmessage without Zod.parse()

declare const ws: { onmessage: ((e: MessageEvent) => void) | null };

export function onmessageNoZod() {
  ws.onmessage = (e: MessageEvent) => {
    const result = JSON.parse(e.data); // VIOLATION: native onmessage without Zod
    console.log(result);
  };
}
