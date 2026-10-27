export type MediaType = "image" | "video";

/** Origem da detecção: dados JSON recebidos pela página ou elementos do DOM. */
export type MediaSource = "network" | "embedded" | "dom";

export interface MediaItem {
  /** Chave estável usada para eliminar duplicatas (caminho do arquivo no CDN). */
  key: string;
  type: MediaType;
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  /** Código curto da publicação (ex.: /p/<shortcode>/). */
  shortcode?: string;
  owner?: string;
  /** Posição dentro de um carrossel (1-based). */
  index?: number;
  source: MediaSource;
  /** Id numérico da mídia (pk). Identifica stories, que não têm shortcode. */
  mediaId?: string;
  /** Duração do vídeo em segundos, quando informada pelo Instagram. */
  duration?: number;
  /**
   * Caminhos dos arquivos do player em partes (DASH) deste vídeo. Permitem
   * descobrir qual vídeo está tocando a partir dos pedaços que o player baixa.
   */
  dashKeys?: string[];
  /** Preenchido quando a mídia foi identificada, mas não pode ser baixada. */
  unavailableReason?: string;
}

export type JobStatus = "waiting" | "downloading" | "completed" | "failed" | "cancelled";

export interface DownloadJob {
  id: string;
  batchId: string;
  media: MediaItem;
  filename: string;
  status: JobStatus;
  downloadId?: number;
  bytesReceived?: number;
  totalBytes?: number;
  error?: string;
  attempts: number;
  createdAt: number;
  finishedAt?: number;
}

export interface HistoryEntry {
  /** Id do download no Chrome, usado para mostrar o arquivo na pasta. */
  downloadId: number;
  filename: string;
  type: MediaType;
  shortcode?: string;
  finishedAt: number;
}

export interface Settings {
  /** Quantidade máxima de downloads simultâneos (1–5). */
  concurrency: number;
  /** Organizar arquivos em InstaFetch/<publicação>/. */
  useSubfolders: boolean;
  /** Mostrar o botão de download no canto das mídias do Instagram. */
  showOverlay: boolean;
  /** Filtro do popup: maior lado mínimo, em pixels (0 = qualquer resolução). */
  minResolution: number;
}

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 3,
  useSubfolders: true,
  showOverlay: true,
  minResolution: 0,
};

/** Opções do filtro de resolução (maior lado da mídia, em pixels). */
export const RESOLUTION_OPTIONS = [0, 320, 640, 1080] as const;

export const MAX_CONCURRENCY = 5;
