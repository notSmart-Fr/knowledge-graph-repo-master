// @ts-nocheck
// Chaos: Rule 18 — JSON.parse in .on('message') is NOT valid Zod validation

declare const ws: { on(event: string, cb: (e: { data: string }) => void): void };

export function jsonParseBypassesRule18() {
  ws.on("message", (e) => {
    const result = JSON.parse(e.data); // VIOLATION: JSON.parse is not Schema.parse
    console.log(result.text);
  });
}
