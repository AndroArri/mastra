import type { ContentBlock, SessionNotification } from '@agentclientprotocol/sdk';
import { AcpEventBus } from './event-bus.js';
import type { TextDeltaEvent, ProgressEvent, ToolCallEvent, PermissionRequestEvent, PendingPermission } from './event-bus.js';

export interface AcpClientOptions {
  eventBus?: AcpEventBus;
}

/**
 * Base Client for the Agent Client Protocol (ACP).
 * Acts as the primary client-side abstraction for connecting UIs and clients
 * to ACP agents and SSE event streams.
 */
export class AcpBaseClient {
  public readonly eventBus: AcpEventBus;

  constructor(options?: AcpClientOptions) {
    this.eventBus = options?.eventBus ?? new AcpEventBus();
  }

  /**
   * Subscribe to streaming text token deltas.
   */
  public onTextDelta(listener: (event: TextDeltaEvent) => void): () => void {
    this.eventBus.on('text_delta', listener);
    return () => this.eventBus.off('text_delta', listener);
  }

  /**
   * Subscribe to real-time progress events.
   */
  public onProgress(listener: (event: ProgressEvent) => void): () => void {
    this.eventBus.on('progress', listener);
    return () => this.eventBus.off('progress', listener);
  }

  /**
   * Subscribe to tool call lifecycle events.
   */
  public onToolCall(listener: (event: ToolCallEvent) => void): () => void {
    this.eventBus.on('tool_call', listener);
    return () => this.eventBus.off('tool_call', listener);
  }

  /**
   * Subscribe to interactive permission request events.
   */
  public onPermissionRequest(listener: (event: PermissionRequestEvent) => void): () => void {
    this.eventBus.on('permission_request', listener);
    return () => this.eventBus.off('permission_request', listener);
  }

  /**
   * Subscribe to client errors.
   */
  public onError(listener: (event: { sessionId?: string; error: Error | string }) => void): () => void {
    this.eventBus.on('error', listener);
    return () => this.eventBus.off('error', listener);
  }

  /**
   * Approve an interactive permission request by ID.
   */
  public approvePermission(permissionId: string, decision: 'approve' | string = 'approve'): boolean {
    return this.eventBus.approvePermission(permissionId, decision);
  }

  /**
   * Reject an interactive permission request by ID.
   */
  public rejectPermission(permissionId: string, reason?: string): boolean {
    return this.eventBus.rejectPermission(permissionId, reason);
  }

  /**
   * Get all currently pending permission requests awaiting user interaction.
   */
  public getPendingPermissions(): PendingPermission[] {
    return this.eventBus.getPendingPermissions();
  }

  /**
   * Ingest an ACP SessionNotification (e.g. from AgentSideConnection or JSON-RPC stream).
   */
  public handleSessionNotification(notification: SessionNotification): void {
    this.eventBus.ingestNotification(notification);
  }

  /**
   * Connect and process a Server-Sent Events (SSE) stream.
   */
  public async processSSEStream(
    stream: AsyncIterable<string | Uint8Array> | ReadableStream<Uint8Array>,
    sessionId = 'default',
  ): Promise<void> {
    await this.eventBus.ingestSSEStream(stream, sessionId);
  }

  /**
   * Ingest a chunk of SSE data.
   */
  public processSSEChunk(chunk: string, sessionId = 'default'): void {
    this.eventBus.ingestSSEChunk(chunk, sessionId);
  }
}
