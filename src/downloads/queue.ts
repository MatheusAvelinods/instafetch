import type { DownloadJob, JobStatus, MediaItem } from "../shared/types";
import { MAX_CONCURRENCY } from "../shared/types";
import { buildFilename } from "../shared/filename";
import { friendlyDownloadError, friendlyStartError } from "../shared/errors";

/** Abstrai o chrome.downloads para que a fila possa ser testada isoladamente. */
export interface DownloadAdapter {
  /** Inicia o download e devolve o id do Chrome. Rejeita se não puder iniciar. */
  start(url: string, filename: string): Promise<number>;
  cancel(downloadId: number): Promise<void>;
}

/** Subconjunto do chrome.downloads.onChanged que interessa à fila. */
export interface DownloadChange {
  state?: "in_progress" | "interrupted" | "complete";
  error?: string;
  bytesReceived?: number;
  totalBytes?: number;
}

export interface QueueOptions {
  concurrency: number;
  useSubfolders: boolean;
  onChange?: (jobs: DownloadJob[]) => void;
  onCompleted?: (job: DownloadJob) => void;
  now?: () => number;
  createId?: () => string;
}

const ACTIVE: JobStatus[] = ["waiting", "downloading"];
const clampConcurrency = (n: number) => Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(n) || 1));

let counter = 0;
const defaultId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class DownloadQueue {
  private jobs: DownloadJob[] = [];
  /** Eventos que chegaram antes de o Chrome devolver o id do download. */
  private earlyChanges = new Map<number, DownloadChange[]>();
  private concurrency: number;
  private useSubfolders: boolean;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly adapter: DownloadAdapter,
    private readonly options: QueueOptions,
  ) {
    this.concurrency = clampConcurrency(options.concurrency);
    this.useSubfolders = options.useSubfolders;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultId;
  }

  list(): DownloadJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }

  /** Restaura a fila salva (por exemplo, após o service worker ser reiniciado). */
  restore(jobs: DownloadJob[]): void {
    this.jobs = jobs.map((job) =>
      // Um início que não chegou a receber id foi perdido; volta para a fila.
      job.status === "downloading" && job.downloadId === undefined ? { ...job, status: "waiting" } : { ...job },
    );
    this.pump();
  }

  configure(settings: { concurrency?: number; useSubfolders?: boolean }): void {
    if (settings.concurrency !== undefined) this.concurrency = clampConcurrency(settings.concurrency);
    if (settings.useSubfolders !== undefined) this.useSubfolders = settings.useSubfolders;
    this.pump();
  }

  enqueue(items: MediaItem[]): DownloadJob[] {
    const batchId = this.createId();
    const busy = new Set(this.jobs.filter((j) => ACTIVE.includes(j.status)).map((j) => j.media.key));
    const positions = new Map<string, number>();
    const added: DownloadJob[] = [];

    for (const media of items) {
      if (busy.has(media.key)) continue;
      busy.add(media.key);
      const group = media.shortcode ?? "";
      const position = (positions.get(group) ?? 0) + 1;
      positions.set(group, position);

      const job: DownloadJob = {
        id: this.createId(),
        batchId,
        media,
        filename: buildFilename(media, { useSubfolders: this.useSubfolders, position, now: new Date(this.now()) }),
        status: "waiting",
        attempts: 0,
        createdAt: this.now(),
      };
      if (media.unavailableReason) {
        job.status = "failed";
        job.error = media.unavailableReason;
        job.finishedAt = this.now();
      }
      this.jobs.push(job);
      added.push(job);
    }

    this.emit();
    this.pump();
    return added;
  }

  cancel(jobId: string): void {
    const job = this.find(jobId);
    if (!job) return;
    this.cancelJob(job);
    this.emit();
    this.pump();
  }

  cancelAll(): void {
    // Cancela tudo antes de chamar pump(), senão itens aguardando seriam iniciados.
    for (const job of this.jobs) this.cancelJob(job);
    this.emit();
  }

  retry(jobId: string): void {
    const job = this.find(jobId);
    if (!job || (job.status !== "failed" && job.status !== "cancelled")) return;
    if (job.media.unavailableReason) return;
    Object.assign(job, {
      status: "waiting" as JobStatus,
      error: undefined,
      downloadId: undefined,
      bytesReceived: undefined,
      totalBytes: undefined,
      finishedAt: undefined,
    });
    this.emit();
    this.pump();
  }

  retryFailed(): void {
    for (const job of this.jobs.filter((j) => j.status === "failed")) this.retry(job.id);
  }

  /** Remove da lista os itens concluídos, cancelados e com falha. */
  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => ACTIVE.includes(j.status));
    this.emit();
  }

  /** Recebe atualizações do chrome.downloads.onChanged. */
  handleChange(downloadId: number, change: DownloadChange): void {
    const job = this.jobs.find((j) => j.downloadId === downloadId);
    if (!job) {
      const pending = this.earlyChanges.get(downloadId) ?? [];
      pending.push(change);
      this.earlyChanges.set(downloadId, pending);
      return;
    }
    this.apply(job, change);
    this.emit();
    this.pump();
  }

  /** Esquece eventos de downloads que não pertencem à fila. */
  isTracked(downloadId: number): boolean {
    return this.jobs.some((j) => j.downloadId === downloadId);
  }

  private apply(job: DownloadJob, change: DownloadChange): void {
    if (change.bytesReceived !== undefined) job.bytesReceived = change.bytesReceived;
    if (change.totalBytes !== undefined && change.totalBytes > 0) job.totalBytes = change.totalBytes;
    if (job.status !== "downloading") return;

    if (change.state === "complete") {
      if (job.totalBytes) job.bytesReceived = job.totalBytes;
      this.finish(job, "completed");
      this.options.onCompleted?.({ ...job });
    } else if (change.state === "interrupted" || change.error) {
      if (change.error === "USER_CANCELED") this.finish(job, "cancelled");
      else this.finish(job, "failed", friendlyDownloadError(change.error));
    }
  }

  private cancelJob(job: DownloadJob): void {
    if (job.status === "downloading" && job.downloadId !== undefined) {
      // O evento USER_CANCELED que virá depois é ignorado, pois o item já estará finalizado.
      this.adapter.cancel(job.downloadId).catch(() => undefined);
    }
    if (ACTIVE.includes(job.status)) this.finish(job, "cancelled");
  }

  private finish(job: DownloadJob, status: JobStatus, error?: string): void {
    job.status = status;
    job.error = error;
    job.finishedAt = this.now();
  }

  private find(jobId: string): DownloadJob | undefined {
    return this.jobs.find((j) => j.id === jobId);
  }

  private emit(): void {
    this.options.onChange?.(this.list());
  }

  /** Inicia novos downloads respeitando o limite de concorrência. */
  private pump(): void {
    let active = this.jobs.filter((j) => j.status === "downloading").length;
    for (const job of this.jobs) {
      if (active >= this.concurrency) break;
      if (job.status !== "waiting") continue;
      active++;
      this.startJob(job);
    }
  }

  private startJob(job: DownloadJob): void {
    job.status = "downloading";
    job.attempts++;
    job.error = undefined;
    this.emit();

    this.adapter.start(job.media.url, job.filename).then(
      (downloadId) => {
        if (job.status === "cancelled") {
          // Cancelado enquanto o Chrome ainda iniciava o download.
          this.adapter.cancel(downloadId).catch(() => undefined);
          return;
        }
        job.downloadId = downloadId;
        const early = this.earlyChanges.get(downloadId);
        this.earlyChanges.delete(downloadId);
        early?.forEach((change) => this.apply(job, change));
        this.emit();
        this.pump();
      },
      (error: unknown) => {
        if (job.status !== "downloading") return;
        this.finish(job, "failed", friendlyStartError(error instanceof Error ? error.message : String(error)));
        this.emit();
        this.pump();
      },
    );
  }
}
