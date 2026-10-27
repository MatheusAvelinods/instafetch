import type { DownloadJob, HistoryEntry } from "../shared/types";

const KEY = "history";
export const HISTORY_LIMIT = 100;

/**
 * Guarda apenas o necessário para exibir e localizar o arquivo: nome, tipo,
 * publicação e id do download. Links assinados do CDN não são armazenados.
 */
export function toHistoryEntry(job: DownloadJob): HistoryEntry | undefined {
  if (job.downloadId === undefined) return undefined;
  return {
    downloadId: job.downloadId,
    filename: job.filename,
    type: job.media.type,
    shortcode: job.media.shortcode,
    finishedAt: job.finishedAt ?? Date.now(),
  };
}

export function prependEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history.filter((h) => h.downloadId !== entry.downloadId)].slice(0, HISTORY_LIMIT);
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get(KEY);
  return Array.isArray(data[KEY]) ? (data[KEY] as HistoryEntry[]) : [];
}

export async function saveHistory(history: HistoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: history });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
