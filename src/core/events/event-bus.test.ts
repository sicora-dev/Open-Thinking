import { describe, expect, it, mock } from "bun:test";
import type { PipelineEvent } from "../../shared/types";
import { createEventBus } from "./event-bus";

describe("EventBus", () => {
  it("emits events to type-specific handlers", () => {
    const bus = createEventBus();
    const handler = mock(() => {});

    bus.on("stage:start", handler);
    bus.emit({ type: "stage:start", stageName: "planning", model: "gpt-4o" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call handler for other event types", () => {
    const bus = createEventBus();
    const handler = mock(() => {});

    bus.on("stage:start", handler);
    bus.emit({
      type: "stage:complete",
      result: { stageName: "x", status: "success", durationMs: 100, contextKeysWritten: [] },
    });

    expect(handler).toHaveBeenCalledTimes(0);
  });

  it("onAny receives all events", () => {
    const bus = createEventBus();
    const events: PipelineEvent[] = [];

    bus.onAny((e) => events.push(e));
    bus.emit({ type: "stage:start", stageName: "a", model: "m" });
    bus.emit({ type: "stage:error", stageName: "a", error: "boom" });

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("stage:start");
    expect(events[1]?.type).toBe("stage:error");
  });

  it("unsubscribe stops receiving events", () => {
    const bus = createEventBus();
    const handler = mock(() => {});

    const unsub = bus.on("stage:start", handler);
    bus.emit({ type: "stage:start", stageName: "a", model: "m" });
    unsub();
    bus.emit({ type: "stage:start", stageName: "b", model: "m" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("clear removes all handlers", () => {
    const bus = createEventBus();
    const handler = mock(() => {});
    const anyHandler = mock(() => {});

    bus.on("stage:start", handler);
    bus.onAny(anyHandler);
    bus.clear();
    bus.emit({ type: "stage:start", stageName: "a", model: "m" });

    expect(handler).toHaveBeenCalledTimes(0);
    expect(anyHandler).toHaveBeenCalledTimes(0);
  });
});
