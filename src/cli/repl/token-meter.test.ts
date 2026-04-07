import { describe, expect, test } from "bun:test";
import { createEventBus } from "../../core/events/event-bus";
import { emptyBreakdown } from "../../shared/types";
import { createTokenMeter } from "./token-meter";

/**
 * Token meter is normally a TTY-only renderer. Its internal accounting
 * still runs on non-TTYs (so the final summary is correct), which is
 * exactly what we exercise here. We pass a fake non-TTY stream to keep
 * stdout clean during tests.
 */
function fakeStream(): NodeJS.WriteStream {
  const written: string[] = [];
  const s = {
    isTTY: false,
    write(chunk: string): boolean {
      written.push(chunk);
      return true;
    },
  };
  return s as unknown as NodeJS.WriteStream;
}

describe("token-meter", () => {
  test("accumulates token deltas across stage updates", () => {
    const bus = createEventBus();
    const meter = createTokenMeter({ eventBus: bus, out: fakeStream() });
    meter.start();

    bus.emit({ type: "pipeline:start", pipelineName: "p", runId: "r1" });

    // First sample for "coder": 100/50/150
    bus.emit({
      type: "tokens:update",
      stageName: "coder",
      model: "gpt-4o",
      providerType: "openai-compatible",
      iteration: 1,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      breakdown: { ...emptyBreakdown(), promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    // Second absolute sample for "coder": 300/120/420 → delta 200/70/270
    bus.emit({
      type: "tokens:update",
      stageName: "coder",
      model: "gpt-4o",
      providerType: "openai-compatible",
      iteration: 2,
      usage: { promptTokens: 300, completionTokens: 120, totalTokens: 420 },
      breakdown: { ...emptyBreakdown(), promptTokens: 300, completionTokens: 120, totalTokens: 420 },
    });

    // Different stage "tester": 50/25/75
    bus.emit({
      type: "tokens:update",
      stageName: "tester",
      model: "gpt-4o-mini",
      providerType: "openai-compatible",
      iteration: 1,
      usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      breakdown: { ...emptyBreakdown(), promptTokens: 50, completionTokens: 25, totalTokens: 75 },
    });

    const totals = meter.totals();
    expect(totals.usage.promptTokens).toBe(350);
    expect(totals.usage.completionTokens).toBe(145);
    expect(totals.usage.totalTokens).toBe(495);
    // Both models are priced → cost should be a finite positive number.
    expect(totals.cost).not.toBeNull();
    expect((totals.cost ?? 0)).toBeGreaterThan(0);

    meter.stop();
  });

  test("unknown model marks cost as unknown (null)", () => {
    const bus = createEventBus();
    const meter = createTokenMeter({ eventBus: bus, out: fakeStream() });
    meter.start();

    bus.emit({ type: "pipeline:start", pipelineName: "p", runId: "r1" });
    bus.emit({
      type: "tokens:update",
      stageName: "x",
      model: "made-up-model",
      providerType: "openai-compatible",
      iteration: 1,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      breakdown: { ...emptyBreakdown(), promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    expect(meter.totals().cost).toBeNull();
    meter.stop();
  });

  test("local provider yields zero cost even with unknown model", () => {
    const bus = createEventBus();
    const meter = createTokenMeter({ eventBus: bus, out: fakeStream() });
    meter.start();

    bus.emit({ type: "pipeline:start", pipelineName: "p", runId: "r1" });
    bus.emit({
      type: "tokens:update",
      stageName: "local",
      model: "llama-whatever",
      providerType: "ollama",
      iteration: 1,
      usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      breakdown: { ...emptyBreakdown(), promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    });

    expect(meter.totals().cost).toBe(0);
    meter.stop();
  });

  test("withQuietZone runs the callback and returns its value", () => {
    const bus = createEventBus();
    const meter = createTokenMeter({ eventBus: bus, out: fakeStream() });
    meter.start();
    const result = meter.withQuietZone(() => 42);
    expect(result).toBe(42);
    meter.stop();
  });

  test("stop is idempotent", () => {
    const bus = createEventBus();
    const meter = createTokenMeter({ eventBus: bus, out: fakeStream() });
    meter.start();
    meter.stop();
    expect(() => meter.stop()).not.toThrow();
  });
});
