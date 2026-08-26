import type { WorkflowEvent } from './types.js';

export type WorkflowEventListener = (event: WorkflowEvent) => void;

/**
 * WorkflowStream provides a real-time event stream of workflow execution events,
 * supporting both callback subscriptions and AsyncIterable pattern (`for await`).
 */
export class WorkflowStream implements AsyncIterable<WorkflowEvent> {
  private events: WorkflowEvent[] = [];
  private listeners: Set<WorkflowEventListener> = new Set();
  private asyncQueue: WorkflowEvent[] = [];
  private resolveNext: ((value: IteratorResult<WorkflowEvent>) => void) | null = null;
  private closed = false;

  emit(event: WorkflowEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallowing listener errors to protect stream execution
      }
    }

    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: event, done: false });
    } else {
      this.asyncQueue.push(event);
    }
  }

  subscribe(listener: WorkflowEventListener): () => void {
    this.listeners.add(listener);
    // Replay existing events to new listener if any
    for (const event of this.events) {
      try {
        listener(event);
      } catch {
        // Swallowing listener errors
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  getEvents(): WorkflowEvent[] {
    return [...this.events];
  }

  close(): void {
    this.closed = true;
    if (this.resolveNext) {
      const resolve = this.resolveNext;
      this.resolveNext = null;
      resolve({ value: undefined as unknown as WorkflowEvent, done: true });
    }

  }

  [Symbol.asyncIterator](): AsyncIterator<WorkflowEvent> {
    let index = 0;
    const self = this;

    return {
      async next(): Promise<IteratorResult<WorkflowEvent>> {
        if (index < self.events.length) {
          const value = self.events[index++];
          return { value, done: false };
        }

        if (self.closed && self.asyncQueue.length === 0) {
          return { value: undefined as any, done: true };
        }

        if (self.asyncQueue.length > 0) {
          const value = self.asyncQueue.shift()!;
          index++;
          return { value, done: false };
        }

        return new Promise<IteratorResult<WorkflowEvent>>(resolve => {
          self.resolveNext = (result) => {
            if (!result.done) index++;
            resolve(result);
          };
        });
      },
    };
  }
}
