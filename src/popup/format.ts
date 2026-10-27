import type { DownloadJob, JobStatus, MediaItem } from "../shared/types";

export const STATUS_LABEL: Record<JobStatus, string> = {
  waiting: "Aguardando",
  downloading: "Baixando",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatResolution(item: MediaItem): string {
  return item.width && item.height ? `${item.width}×${item.height}` : "";
}

/** Estimativa de tamanho com base na resolução (JPEG ~0,25 byte/pixel). */
export function estimateSize(item: MediaItem): string {
  if (item.type !== "image" || !item.width || !item.height) return "";
  return `~${formatBytes(item.width * item.height * 0.25)}`;
}

export function progressPercent(job: DownloadJob): number | undefined {
  if (job.status === "completed") return 100;
  if (!job.totalBytes || job.bytesReceived === undefined) return undefined;
  return Math.min(100, Math.round((job.bytesReceived / job.totalBytes) * 100));
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(timestamp);
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface BatchSummary {
  total: number;
  done: number;
  completed: number;
  failed: number;
  cancelled: number;
  active: number;
  percent: number;
}

export function summarize(jobs: DownloadJob[]): BatchSummary {
  const count = (status: JobStatus) => jobs.filter((j) => j.status === status).length;
  const completed = count("completed");
  const failed = count("failed");
  const cancelled = count("cancelled");
  const done = completed + failed + cancelled;
  const active = jobs.length - done;
  // Downloads em andamento contam proporcionalmente ao progresso.
  const partial = jobs
    .filter((j) => j.status === "downloading")
    .reduce((sum, j) => sum + (progressPercent(j) ?? 0) / 100, 0);
  const percent = jobs.length ? Math.round(((done + partial) / jobs.length) * 100) : 0;
  return { total: jobs.length, done, completed, failed, cancelled, active, percent };
}
