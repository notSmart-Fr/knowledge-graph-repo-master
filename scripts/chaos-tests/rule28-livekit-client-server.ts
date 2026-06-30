// @ts-nocheck
// Chaos: Rule 28 — livekit-client import outside apps/widget/

import { Room } from "livekit-client"; // VIOLATION: browser SDK in scripts/

export function useRoom() {
  return new Room();
}
