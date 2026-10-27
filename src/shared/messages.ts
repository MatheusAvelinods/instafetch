import type { DownloadJob, HistoryEntry, MediaItem, Settings } from "./types";

/** Mensagens popup -> content script. */
export type ContentRequest = { type: "GET_MEDIA" } | { type: "CLEAR_MEDIA" };

export interface MediaResponse {
  pageUrl: string;
  /** Shortcode da publicação aberta, se a página for /p/, /reel/ ou /tv/. */
  pageShortcode?: string;
  items: MediaItem[];
}

/** Mensagens popup -> service worker. */
export type BackgroundRequest =
  | { type: "ENQUEUE"; items: MediaItem[] }
  | { type: "CANCEL"; jobId: string }
  | { type: "CANCEL_ALL" }
  | { type: "RETRY"; jobId: string }
  | { type: "RETRY_FAILED" }
  | { type: "CLEAR_FINISHED" }
  | { type: "GET_STATE" }
  | { type: "SHOW_FILE"; downloadId: number }
  | { type: "SHOW_FOLDER" }
  | { type: "CLEAR_HISTORY" }
  | { type: "SET_SETTINGS"; settings: Partial<Settings> };

export interface BackgroundState {
  jobs: DownloadJob[];
  history: HistoryEntry[];
  settings: Settings;
}

/** Mensagem service worker -> popup (via porta). */
export interface StateBroadcast {
  type: "STATE";
  state: BackgroundState;
}

/** Mensagem do script no contexto da página (MAIN world) -> content script. */
export const PAGE_MESSAGE_SOURCE = "instafetch-page";

export interface PagePayloadMessage {
  source: typeof PAGE_MESSAGE_SOURCE;
  type: "PAYLOAD";
  /** JSON já recebido pela própria página do Instagram. */
  payload: unknown;
}
