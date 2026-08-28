import { EventEmitter } from 'node:events';
import type { TokenUsage } from '@mastra/core/agent-controller';
import type { SessionNotification } from '@agentclientprotocol/sdk';

export interface TextDeltaEvent {
  sessionId: string;
  delta: string;
  fullText?: string;
}

export interface ProgressEvent {
  sessionId: string;
  type: 'tool_start' | 'tool_end' | 'step_progress' | 'notification' | 'info';
  message?: string;
  toolName?: string;
  toolCallId?: string;
  status?: 'in_progress' | 'completed' | 'failed';
  details?: Record<string, unknown>;
}

export interface ToolCallEvent {
  sessionId: string;
  toolCallId: string;
  title: string;
  kind?: string;
  rawInput?: string;
  rawOutput?: string;
  status: 'in_progress' | 'completed' | 'failed';
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionRequestEvent {
  id: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  rawInput?: string;
  options?: PermissionOption[];
  resolve: (decision: 'approve' | 'decline' | string) => void;
  reject: (reason?: Error | string) => void;
}

export interface PendingPermission {
  id: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  rawInput?: string;
  options?: PermissionOption[];
  resolve: (decision: 'approve' | 'decline' | string) => void;
  reject: (reason?: Error | string) => void;
  createdAt: Date;
}

export interface UsageUpdateEvent {
  sessionId: string;
  usage: TokenUsage;
}

export interface AgentLifecycleEvent {
  sessionId: string;
  reason?: string;
}

export interface AcpEventMap {
  text_delta: (event: TextDeltaEvent) => void;
  progress: (event: ProgressEvent) => void;
  tool_call: (event: ToolCallEvent) => void;
  permission_request: (event: PermissionRequestEvent) => void;
  usage_update: (event: UsageUpdateEvent) => void;
  agent_start: (event: AgentLifecycleEvent) => void;
  agent_end: (event: AgentLifecycleEvent) => void;
  error: (event: { sessionId?: string; error: Error | string }) => void;
  sse_raw: (event: { eventType: string; data: unknown }) => void;
}

export interface SSEMessage {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

/**
 * Parses raw text lines from a Server-Sent Events (SSE) stream.
 */
export class SSEParser {
  private buffer = '';

  /**
   * Feed a chunk of SSE text data and parse complete SSE messages.
   */
  public parseChunk(chunk: string): SSEMessage[] {
    this.buffer += chunk;
    const messages: SSEMessage[] = [];

    // Normalize lines CRLF to LF
    const normalized = this.buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split('\n\n');

    // Keep the last uncompleted block in the buffer
    this.buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.split('\n');
      let id: string | undefined;
      let event: string | undefined;
      const dataLines: string[] = [];
      let retry: number | undefined;

      for (const line of lines) {
        if (!line.trim() || line.startsWith(':')) continue; // Ignore empty lines or comments
        const colonIdx = line.indexOf(':');
        let field = line;
        let value = '';

        if (colonIdx !== -1) {
          field = line.slice(0, colonIdx);
          value = line.slice(colonIdx + 1);
          if (value.startsWith(' ')) {
            value = value.slice(1);
          }
        }

        switch (field) {
          case 'event':
            event = value;
            break;
          case 'data':
            dataLines.push(value);
            break;
          case 'id':
            id = value;
            break;
          case 'retry': {
            const parsedRetry = parseInt(value, 10);
            if (!isNaN(parsedRetry)) retry = parsedRetry;
            break;
          }
        }
      }

      if (dataLines.length > 0) {
        messages.push({
          id,
          event,
          data: dataLines.join('\n'),
          retry,
        });
      }
    }

    return messages;
  }

  /**
   * Flush any remaining buffer content.
   */
  public flush(): SSEMessage[] {
    if (!this.buffer.trim()) {
      this.buffer = '';
      return [];
    }
    const remaining = this.buffer;
    this.buffer = '';
    return this.parseChunk(remaining + '\n\n');
  }
}

/**
 * Event Bus for ACP (Agent Client Protocol) communication.
 * Manages real-time token deltas, progress events, and permission lifecycles.
 */
export class AcpEventBus extends EventEmitter {
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly sseParser = new SSEParser();

  /**
   * Add a strongly-typed event listener.
   */
  public on<K extends keyof AcpEventMap>(event: K, listener: AcpEventMap[K]): this {
    return super.on(event, listener);
  }

  /**
   * Remove a strongly-typed event listener.
   */
  public off<K extends keyof AcpEventMap>(event: K, listener: AcpEventMap[K]): this {
    return super.off(event, listener);
  }

  /**
   * Emit a strongly-typed event.
   */
  public emit<K extends keyof AcpEventMap>(event: K, ...args: Parameters<AcpEventMap[K]>): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Emit a text delta event (streaming token text).
   */
  public emitTextDelta(sessionId: string, delta: string, fullText?: string): void {
    this.emit('text_delta', { sessionId, delta, fullText });
  }

  /**
   * Emit a real-time progress event.
   */
  public emitProgress(event: ProgressEvent): void {
    this.emit('progress', event);
  }

  /**
   * Emit a tool call status change event.
   */
  public emitToolCall(event: ToolCallEvent): void {
    this.emit('tool_call', event);
    // Also emit a progress event for convenience
    this.emit('progress', {
      sessionId: event.sessionId,
      type: event.status === 'in_progress' ? 'tool_start' : 'tool_end',
      toolName: event.title,
      toolCallId: event.toolCallId,
      status: event.status,
    });
  }

  /**
   * Request interactive permission from client and register in lifecycle tracking.
   * Returns a promise that resolves when permission is approved or declined.
   */
  public requestPermission(params: {
    id?: string;
    sessionId: string;
    toolCallId: string;
    title: string;
    rawInput?: string;
    options?: PermissionOption[];
  }): Promise<'approve' | 'decline' | string> {
    const id = params.id ?? `perm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    return new Promise<'approve' | 'decline' | string>((resolve, reject) => {
      const pending: PendingPermission = {
        id,
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        title: params.title,
        rawInput: params.rawInput,
        options: params.options,
        resolve: decision => {
          this.pendingPermissions.delete(id);
          resolve(decision);
        },
        reject: reason => {
          this.pendingPermissions.delete(id);
          reject(typeof reason === 'string' ? new Error(reason) : reason);
        },
        createdAt: new Date(),
      };

      this.pendingPermissions.set(id, pending);

      this.emit('permission_request', {
        id,
        sessionId: params.sessionId,
        toolCallId: params.toolCallId,
        title: params.title,
        rawInput: params.rawInput,
        options: params.options,
        resolve: pending.resolve,
        reject: pending.reject,
      });
    });
  }

  /**
   * Approve a pending permission request.
   */
  public approvePermission(permissionId: string, decision: 'approve' | string = 'approve'): boolean {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return false;
    pending.resolve(decision);
    return true;
  }

  /**
   * Reject/Decline a pending permission request.
   */
  public rejectPermission(permissionId: string, reason?: string): boolean {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return false;
    if (reason) {
      pending.reject(new Error(reason));
    } else {
      pending.resolve('decline');
    }
    return true;
  }

  /**
   * Get all currently pending permission requests.
   */
  public getPendingPermissions(): PendingPermission[] {
    return Array.from(this.pendingPermissions.values());
  }

  /**
   * Ingest an ACP SessionNotification update and translate it to EventBus events.
   */
  public ingestNotification(notification: SessionNotification): void {
    const { sessionId, update } = notification;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.type === 'text') {
          this.emitTextDelta(sessionId, update.content.text);
        }
        break;

      case 'tool_call':
        this.emitToolCall({
          sessionId,
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          rawInput: update.rawInput,
          status: update.status === 'in_progress' ? 'in_progress' : 'completed',
        });
        break;

      case 'tool_call_update':
        this.emitToolCall({
          sessionId,
          toolCallId: update.toolCallId,
          title: '', // Title may not be present in update
          rawOutput: update.rawOutput,
          status: update.status === 'completed' ? 'completed' : 'failed',
        });
        break;

      default:
        break;
    }
  }

  /**
   * Feed a chunk of SSE data into the bus, parsing events and emitting corresponding signals.
   */
  public ingestSSEChunk(chunk: string, sessionId = 'default'): void {
    const messages = this.sseParser.parseChunk(chunk);
    for (const msg of messages) {
      this.handleSSEMessage(msg, sessionId);
    }
  }

  /**
   * Ingest a full SSE stream from an AsyncIterable or ReadableStream.
   */
  public async ingestSSEStream(
    stream: AsyncIterable<string | Uint8Array> | ReadableStream<Uint8Array>,
    sessionId = 'default',
  ): Promise<void> {
    const decoder = new TextDecoder();

    if ('getReader' in stream && typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
          this.ingestSSEChunk(text, sessionId);
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      const asyncIterable = stream as AsyncIterable<string | Uint8Array>;
      for await (const chunk of asyncIterable) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        this.ingestSSEChunk(text, sessionId);
      }
    }

    const flushed = this.sseParser.flush();
    for (const msg of flushed) {
      this.handleSSEMessage(msg, sessionId);
    }
  }

  /**
   * Process a parsed SSE message and emit high-level ACP events.
   */
  private handleSSEMessage(msg: SSEMessage, defaultSessionId: string): void {
    let dataObj: unknown;
    try {
      dataObj = JSON.parse(msg.data);
    } catch {
      dataObj = msg.data;
    }

    this.emit('sse_raw', { eventType: msg.event ?? 'message', data: dataObj });

    const eventName = msg.event ?? 'message';

    if (eventName === 'text_delta' || eventName === 'message_chunk') {
      const delta = typeof dataObj === 'string' ? dataObj : (dataObj as any)?.text ?? (dataObj as any)?.delta;
      const sessionId = (dataObj as any)?.sessionId ?? defaultSessionId;
      if (delta) {
        this.emitTextDelta(sessionId, delta);
      }
    } else if (eventName === 'progress') {
      const sessionId = (dataObj as any)?.sessionId ?? defaultSessionId;
      this.emitProgress({
        sessionId,
        type: (dataObj as any)?.type ?? 'step_progress',
        message: (dataObj as any)?.message,
        toolName: (dataObj as any)?.toolName,
        details: typeof dataObj === 'object' ? (dataObj as Record<string, unknown>) : undefined,
      });
    } else if (eventName === 'permission_request') {
      const obj = dataObj as any;
      void this.requestPermission({
        id: obj?.id,
        sessionId: obj?.sessionId ?? defaultSessionId,
        toolCallId: obj?.toolCallId ?? 'unknown',
        title: obj?.title ?? obj?.toolName ?? 'Sensitive Operation',
        rawInput: obj?.rawInput,
        options: obj?.options,
      });
    } else if (eventName === 'session_update' || eventName === 'acp_notification') {
      if (dataObj && typeof dataObj === 'object' && 'sessionId' in dataObj && 'update' in dataObj) {
        this.ingestNotification(dataObj as SessionNotification);
      }
    }
  }
}
