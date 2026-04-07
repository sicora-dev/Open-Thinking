export type RunStreamEvent = {
  seq: number;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
};

export type RunStreamState = "connecting" | "live" | "reconnecting" | "closed";

type SubscribeRunStreamOptions = {
  runId: string;
  eventTypes: string[];
  onEvent: (event: RunStreamEvent) => void;
  onStateChange?: (state: RunStreamState) => void;
  isTerminalEvent?: (event: RunStreamEvent) => boolean;
};

export function subscribeRunStream({
  runId,
  eventTypes,
  onEvent,
  onStateChange,
  isTerminalEvent,
}: SubscribeRunStreamOptions): () => void {
  let closed = false;
  let retryCount = 0;
  let retryTimer: number | null = null;
  let currentSource: EventSource | null = null;

  const eventNames = [...new Set([...eventTypes, "done"])];

  const clearRetry = () => {
    if (retryTimer != null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const closeCurrent = () => {
    currentSource?.close();
    currentSource = null;
  };

  const connect = () => {
    if (closed) return;

    onStateChange?.(retryCount === 0 ? "connecting" : "reconnecting");
    const source = new EventSource(`/api/runs/${runId}/stream`);
    currentSource = source;

    source.onopen = () => {
      retryCount = 0;
      onStateChange?.("live");
    };

    const handleMessage = (type: string) => (message: MessageEvent) => {
      try {
        const data = JSON.parse(message.data) as {
          seq?: number;
          ts?: string;
          payload?: Record<string, unknown>;
        };

        const event: RunStreamEvent = {
          seq: data.seq ?? 0,
          ts: data.ts ?? new Date().toISOString(),
          type,
          payload: data.payload ?? {},
        };

        onEvent(event);

        const terminal =
          type === "done" || (isTerminalEvent ? isTerminalEvent(event) : false);
        if (terminal) {
          closed = true;
          clearRetry();
          closeCurrent();
          onStateChange?.("closed");
        }
      } catch {
        // ignore malformed stream chunk
      }
    };

    for (const eventType of eventNames) {
      source.addEventListener(eventType, handleMessage(eventType));
    }

    source.onerror = () => {
      if (closed) return;
      closeCurrent();
      onStateChange?.("reconnecting");
      clearRetry();
      const delayMs = Math.min(1000 * 2 ** retryCount, 5000);
      retryCount += 1;
      retryTimer = window.setTimeout(connect, delayMs);
    };
  };

  connect();

  return () => {
    closed = true;
    clearRetry();
    closeCurrent();
    onStateChange?.("closed");
  };
}
