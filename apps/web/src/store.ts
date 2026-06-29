// AI CRM Operator Dashboard — central state store.
// Single EventTarget singleton; components subscribe to granular keys.
// Per spec Clarifications 2026-06-29: hybrid data sources (polled /ready + Supabase Realtime).

export type AdapterStatus = "healthy" | "degraded" | "down" | "circuit_open";

export interface AdapterHealth {
  name: string;
  status: AdapterStatus;
  latencyMs: number;
  lastChecked: string;
  circuitBreakerState?: string;
  error?: string;
}

export interface CircuitBreakerState {
  name: string;
  state: "closed" | "open" | "half-open";
  openedAt?: string;
  consecutiveFailures: number;
}

export interface CacheMetrics {
  hitRate: number; // 0..1
  totalRequests: number;
  totalHits: number;
  lastStoreAt?: string;
  modelDistribution: Record<string, number>; // model -> count
}

export interface TranscriptChunk {
  speaker: "customer" | "agent";
  text: string;
  timestamp_ms: number;
  sentiment: "positive" | "neutral" | "negative";
}

export interface ActiveCall {
  id: string;
  contactId: string;
  contactName: string;
  direction: "inbound" | "outbound";
  startedAt: string;
  chunkCount: number;
}

export interface DashboardState {
  // Data source liveness
  readyEndpointAvailable: boolean;
  realtimeAvailable: boolean;
  lastHealthyAt?: string;

  // Health
  overallHealth: AdapterStatus;
  adapters: AdapterHealth[];
  circuitBreakers: CircuitBreakerState[];

  // Cache
  cache: CacheMetrics | null;

  // Calls / transcript
  activeCalls: ActiveCall[];
  liveTranscript: TranscriptChunk[];

  // UI
  serviceUnavailableBannerVisible: boolean;
}

// ponytail: typed map of state keys for setState ergonomics. Avoids stringly-typed bag.
type StateKey = keyof DashboardState;

const INITIAL_STATE: DashboardState = {
  readyEndpointAvailable: true,
  realtimeAvailable: true,
  overallHealth: "healthy",
  adapters: [],
  circuitBreakers: [],
  cache: null,
  activeCalls: [],
  liveTranscript: [],
  serviceUnavailableBannerVisible: false,
};

class CRMStore extends EventTarget {
  private state: DashboardState = { ...INITIAL_STATE };

  getState(): Readonly<DashboardState> {
    return this.state;
  }

  /** Update one slice of state and notify subscribers.
   *  Dispatching is granular: each subscriber can listen for specific keys. */
  setState<K extends StateKey>(key: K, value: DashboardState[K]): void {
    this.state = { ...this.state, [key]: value };
    this.dispatchEvent(
      new CustomEvent("stateChange", { detail: { key, value } })
    );
  }

  /** Bulk update — used when /ready response replaces several slices at once. */
  patchState(patch: Partial<DashboardState>): void {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent("stateChange", { detail: { patch } }));
  }

  /** Reset for tests. Not used in production. */
  __reset(): void {
    this.state = { ...INITIAL_STATE };
  }
}

export const store = new CRMStore();

// ponytail: small helper so components don't all repeat the same `addEventListener("stateChange", ...)` boilerplate.
type StateChangeDetail<K extends StateKey> =
  | { key: K; value: DashboardState[K] }
  | { patch: Partial<DashboardState> };

export function subscribeToKey<K extends StateKey>(
  key: K,
  handler: (value: DashboardState[K]) => void
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<StateChangeDetail<K>>).detail;
    if ("key" in detail && detail.key === key) {
      handler(detail.value);
    } else if ("patch" in detail && key in detail.patch) {
      handler(detail.patch[key] as DashboardState[K]);
    }
  };
  store.addEventListener("stateChange", listener);
  return () => store.removeEventListener("stateChange", listener);
}