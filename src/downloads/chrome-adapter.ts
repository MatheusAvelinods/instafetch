import type { DownloadAdapter } from "./queue";

export const chromeDownloadAdapter: DownloadAdapter = {
  async start(url, filename) {
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false,
    });
    if (downloadId === undefined) {
      throw new Error(chrome.runtime.lastError?.message ?? "download não iniciado");
    }
    return downloadId;
  },
  async cancel(downloadId) {
    await chrome.downloads.cancel(downloadId);
  },
};
