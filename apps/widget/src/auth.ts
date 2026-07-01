import { store } from "./store.js";

const AuthErrorSchema = { reason: "" as string | undefined };

export async function handleUnauthorized(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;

  let reason: string | undefined;
  try {
    const body = (await response.json()) as typeof AuthErrorSchema;
    reason = body.reason;
  } catch {
    // ponytail: non-JSON 401 still blocks the session
  }

  if (reason === "expired" || reason === "missing" || reason === "malformed") {
    store.sessionExpired();
    return true;
  }

  store.sessionExpired();
  return true;
}
