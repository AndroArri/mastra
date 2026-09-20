import type { BrowserProvider, BrowserViewport, StagehandEnv } from '../onboarding/settings.js';

export type ScrapingLogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface ScrapingLogEntry {
  id: string;
  timestamp: number;
  level: ScrapingLogLevel;
  message: string;
  action?: string;
  url?: string;
  details?: Record<string, unknown>;
}

export type BrowserSSEEventType = 'frame' | 'log' | 'navigated' | 'action' | 'status';

export interface BrowserSSEEvent {
  type: BrowserSSEEventType;
  timestamp: number;
  url?: string;
  data: any;
}

export interface ScreenshotOptions {
  path?: string;
  fullPage?: boolean;
  format?: 'base64' | 'binary' | 'data-url';
}

export interface VideoRecordingResult {
  videoPath?: string;
  durationMs: number;
  recording: boolean;
}

export interface MastraBrowserOptions {
  provider?: BrowserProvider;
  headless?: boolean;
  viewport?: BrowserViewport;
  cdpUrl?: string;
  profile?: string;
  executablePath?: string;
  recordVideo?: boolean;
  videoDir?: string;
  enablePreviewStream?: boolean;
  previewIntervalMs?: number;
  stagehand?: {
    env?: StagehandEnv;
    apiKey?: string;
    projectId?: string;
    preserveUserDataDir?: boolean;
    model?: unknown;
  };
  agentBrowser?: {
    storageState?: string;
  };
  /** Pre-constructed inner browser instance or mock for testing */
  innerBrowser?: any;
}
