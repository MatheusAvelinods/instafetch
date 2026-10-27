import type { DownloadJob, HistoryEntry, JobStatus, MediaItem, Settings } from "./types";

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
  | { type: "SET_SETTINGS"; settings: Partial<Settings> }
  | { type: "JOB_STATUS"; jobIds: string[] };

/** Comandos que o content script (botão sobre a mídia) também pode enviar. */
export const PAGE_ALLOWED_REQUESTS: ReadonlySet<BackgroundRequest["type"]> = new Set(["ENQUEUE", "JOB_STATUS"]);

export interface EnqueueResponse {
  ok?: boolean;
  error?: string;
  added: number;
  /** Para cada mídia enviada (mesma ordem), o job que a representa na fila. */
  jobIds: (string | undefined)[];
}

/** Resumo mínimo de um job, sem URLs, para o botão sobre a mídia. */
export interface JobStatusSummary {
  id: string;
  status: JobStatus;
  percent?: number;
  error?: string;
}

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

/** Pedaço de vídeo/áudio baixado pelo player da página (só o endereço). */
export interface PageSegmentMessage {
  source: typeof PAGE_MESSAGE_SOURCE;
  type: "SEGMENT";
  url: string;
}
