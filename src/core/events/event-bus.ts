/**
 * Simple typed event bus for pipeline events.
 * Stages emit events, the CLI and dashboard subscribe to them.
 */

import type { PipelineEvent } from "../../shared/types";

type EventHandler = (event: PipelineEvent) => void;

export const createEventBus = () => {
  const handlers = new Map<PipelineEvent["type"], Set<EventHandler>>();
  const globalHandlers = new Set<EventHandler>();

  return {
    /** Subscribe to a specific event type */
    on(type: PipelineEvent["type"], handler: EventHandler): () => void {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => handlers.get(type)?.delete(handler);
    },

    /** Subscribe to all events */
    onAny(handler: EventHandler): () => void {
      globalHandlers.add(handler);
      return () => globalHandlers.delete(handler);
    },

    /** Emit an event */
    emit(event: PipelineEvent): void {
      const typeHandlers = handlers.get(event.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) handler(event);
      }
      for (const handler of globalHandlers) handler(event);
    },

    /** Remove all handlers */
    clear(): void {
      handlers.clear();
      globalHandlers.clear();
    },
  };
};

export type EventBus = ReturnType<typeof createEventBus>;
