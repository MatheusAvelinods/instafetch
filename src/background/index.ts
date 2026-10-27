/**
 * Service worker: coordena a fila de downloads, guarda o estado (que precisa
 * sobreviver ao encerramento do worker pelo Chrome) e mantém o popup atualizado.
 */
import { DownloadQueue, type DownloadChange } from "../downloads/queue";
import { chromeDownloadAdapter } from "../downloads/chrome-adapter";
import { clearHistory, loadHistory, prependEntry, saveHistory, toHistoryEntry } from "../storage/history";
import { loadSettings, saveSettings } from "../storage/settings";
import {
  PAGE_ALLOWED_REQUESTS,
  type BackgroundRequest,
  type BackgroundState,
  type EnqueueResponse,
  type JobStatusSummary,
  type StateBroadcast,
} from "../shared/messages";
import type { DownloadJob, HistoryEntry, Settings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";
import { isAllowedMediaUrl } from "../shared/url";

const JOBS_KEY = "jobs";
const PROGRESS_INTERVAL_MS = 700;

let settings: Settings = DEFAULT_SETTINGS;
let history: HistoryEntry[] = [];
const ports = new Set<chrome.runtime.Port>();

const queue = new DownloadQueue(chromeDownloadAdapter, {
  concurrency: DEFAULT_SETTINGS.concurrency,
  useSubfolders: DEFAULT_SETTINGS.useSubfolders,
  onChange: (jobs) => {
    persistJobs(jobs);
    updateProgressPolling(jobs);
    broadcast();
  },
  onCompleted: (job) => {
    const entry = toHistoryEntry(job);
    if (!entry) return;
    history = prependEntry(history, entry);
    void saveHistory(history);
  },
});

function state(): BackgroundState {
  return { jobs: queue.list(), history, settings };
}

let broadcastScheduled = false;
function broadcast(): void {
  if (broadcastScheduled || ports.size === 0) return;
  broadcastScheduled = true;
  queueMicrotask(() => {
    broadcastScheduled = false;
    const message: StateBroadcast = { type: "STATE", state: state() };
    for (const port of ports) port.postMessage(message);
  });
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistJobs(jobs: DownloadJob[]): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void chrome.storage.session.set({ [JOBS_KEY]: jobs }), 150);
}

/** Atualiza bytes recebidos dos downloads ativos (o onChanged não informa progresso). */
let progressTimer: ReturnType<typeof setInterval> | undefined;
function updateProgressPolling(jobs: DownloadJob[]): void {
  const active = jobs.some((j) => j.status === "downloading");
  if (active && !progressTimer) {
    progressTimer = setInterval(pollProgress, PROGRESS_INTERVAL_MS);
  } else if (!active && progressTimer) {
    clearInterval(progressTimer);
    progressTimer = undefined;
  }
}

async function pollProgress(): Promise<void> {
  const active = queue.list().filter((j) => j.status === "downloading" && j.downloadId !== undefined);
  for (const job of active) {
    const [item] = await chrome.downloads.search({ id: job.downloadId });
    if (!item) {
      queue.handleChange(job.downloadId!, { state: "interrupted", error: "FILE_FAILED" });
      continue;
    }
    queue.handleChange(item.id, {
      bytesReceived: item.bytesReceived,
      totalBytes: item.totalBytes,
      state: item.state as DownloadChange["state"],
      error: item.error,
    });
  }
}

const ready = (async () => {
  settings = await loadSettings();
  history = await loadHistory();
  queue.configure(settings);
  const saved = await chrome.storage.session.get(JOBS_KEY);
  const jobs = Array.isArray(saved[JOBS_KEY]) ? (saved[JOBS_KEY] as DownloadJob[]) : [];
  queue.restore(jobs);
  // Sincroniza downloads que mudaram enquanto o worker estava inativo.
  await pollProgress();
})();

chrome.downloads.onChanged.addListener((delta) => {
  void ready.then(() => {
    queue.handleChange(delta.id, {
      state: delta.state?.current as DownloadChange["state"],
      error: delta.error?.current,
      totalBytes: delta.totalBytes?.current,
    });
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  void ready.then(() => port.postMessage({ type: "STATE", state: state() } satisfies StateBroadcast));
});

async function handle(request: BackgroundRequest): Promise<unknown> {
  await ready;
  switch (request.type) {
    case "ENQUEUE": {
      // Nunca baixa endereços fora dos CDNs do Instagram, mesmo que a lista venha adulterada.
      const items = request.items.filter((item) => item.unavailableReason || isAllowedMediaUrl(item.url));
      const added = queue.enqueue(items).length;
      const response: EnqueueResponse = {
        ok: true,
        added,
        jobIds: request.items.map((item) => queue.latestJobForKey(item.key)?.id),
      };
      return response;
    }
    case "JOB_STATUS": {
      const wanted = new Set(request.jobIds);
      return queue
        .list()
        .filter((job) => wanted.has(job.id))
        .map(
          (job): JobStatusSummary => ({
            id: job.id,
            status: job.status,
            error: job.error,
            percent: job.totalBytes ? Math.round(((job.bytesReceived ?? 0) / job.totalBytes) * 100) : undefined,
          }),
        );
    }
    case "CANCEL":
      queue.cancel(request.jobId);
      break;
    case "CANCEL_ALL":
      queue.cancelAll();
      break;
    case "RETRY":
      queue.retry(request.jobId);
      break;
    case "RETRY_FAILED":
      queue.retryFailed();
      break;
    case "CLEAR_FINISHED":
      queue.clearFinished();
      break;
    case "SHOW_FILE": {
      const [item] = await chrome.downloads.search({ id: request.downloadId });
      if (!item || !item.exists) return { ok: false, error: "O arquivo foi movido ou excluído." };
      chrome.downloads.show(request.downloadId);
      break;
    }
    case "SHOW_FOLDER":
      chrome.downloads.showDefaultFolder();
      break;
    case "CLEAR_HISTORY":
      history = [];
      await clearHistory();
      broadcast();
      break;
    case "SET_SETTINGS":
      settings = await saveSettings(request.settings);
      queue.configure(settings);
      broadcast();
      break;
    case "GET_STATE":
      return state();
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((request: BackgroundRequest, sender, sendResponse) => {
  // Popup: todos os comandos. Content script do Instagram: só adicionar à fila e consultar estado.
  if (sender.id !== chrome.runtime.id) return false;
  const fromPopup = !!sender.url?.startsWith(chrome.runtime.getURL(""));
  const fromInstagram = !!sender.tab && /^https:\/\/www\.instagram\.com\//.test(sender.url ?? "");
  if (!fromPopup && !(fromInstagram && PAGE_ALLOWED_REQUESTS.has(request.type))) return false;
  handle(request).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});
