// @ts-nocheck
// Chaos: Rule 27 — standalone JSON.parse on external string (scripts/ scope)

export function jsonParseNoSchema(externalStr: string) {
  const data = JSON.parse(externalStr); // VIOLATION: no Schema.parse follow-up
  return data.contactId;
}

export function jsonParseLiteralOk() {
  return JSON.parse('{"static": true}'); // OK: literal string exempt
}
