import type { BackgroundRequest, BackgroundState, ContentRequest, MediaResponse, StateBroadcast } from "../shared/messages";
import type { DownloadJob, HistoryEntry, MediaItem } from "../shared/types";
import { DEFAULT_SETTINGS, RESOLUTION_OPTIONS } from "../shared/types";
import { applyFilters, RESOLUTION_LABELS, type TypeFilter } from "./filters";
import { h, icon, ICONS, thumbnail } from "./dom";
import {
  basename,
  estimateSize,
  formatBytes,
  formatDate,
  formatResolution,
  progressPercent,
  STATUS_LABEL,
  summarize,
} from "./format";

type Tab = "media" | "queue" | "history" | "settings";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  tabs: document.querySelectorAll<HTMLButtonElement>(".tab"),
  panels: document.querySelectorAll<HTMLElement>(".panel"),
  chips: document.querySelectorAll<HTMLButtonElement>(".chip"),
  grid: $<HTMLUListElement>("media-grid"),
  mediaMessage: $("media-message"),
  selectionInfo: $("selection-info"),
  selectAll: $<HTMLButtonElement>("select-all"),
  clearSelection: $<HTMLButtonElement>("clear-selection"),
  refresh: $<HTMLButtonElement>("refresh"),
  queueBadge: $("queue-badge"),
  queueList: $<HTMLUListElement>("queue-list"),
  queueEmpty: $("queue-empty"),
  queueSummary: $("queue-summary"),
  retryFailed: $<HTMLButtonElement>("retry-failed"),
  cancelAll: $<HTMLButtonElement>("cancel-all"),
  clearFinished: $<HTMLButtonElement>("clear-finished"),
  historyList: $<HTMLUListElement>("history-list"),
  historyEmpty: $("history-empty"),
  historySummary: $("history-summary"),
  openFolder: $<HTMLButtonElement>("open-folder"),
  clearHistory: $<HTMLButtonElement>("clear-history"),
  concurrency: $<HTMLSelectElement>("concurrency"),
  subfolders: $<HTMLInputElement>("subfolders"),
  showOverlay: $<HTMLInputElement>("show-overlay"),
  minResolution: $<HTMLSelectElement>("min-resolution"),
  hiddenInfo: $("hidden-info"),
  footer: $("footer"),
  downloadSelected: $<HTMLButtonElement>("download-selected"),
  overall: $("overall-progress"),
  overallBar: $("overall-bar"),
  overallText: $("overall-text"),
  toast: $("toast"),
};

const view = {
  tab: "media" as Tab,
  filter: "all" as TypeFilter,
  media: [] as MediaItem[],
  selected: new Set<string>(),
  bg: { jobs: [], history: [], settings: DEFAULT_SETTINGS } as BackgroundState,
  tabId: undefined as number | undefined,
};

// ---------- Comunicação ----------

function send<T = unknown>(request: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
}

function connect(): void {
  const port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener((message: StateBroadcast) => {
    if (message.type !== "STATE") return;
    view.bg = message.state;
    renderBackground();
  });
  // O service worker pode ser reiniciado pelo Chrome; reconecta automaticamente.
  port.onDisconnect.addListener(() => setTimeout(connect, 300));
}

let toastTimer: number | undefined;
function toast(text: string): void {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.hidden = true), 3200);
}

function showMediaMessage(title: string, text: string): void {
  ui.mediaMessage.replaceChildren(h("strong", {}, title), text);
  ui.mediaMessage.hidden = false;
}

async function loadMedia(): Promise<void> {
  // ?tabId= permite abrir o popup como página comum (útil em testes de integração).
  const forcedTabId = Number(new URLSearchParams(location.search).get("tabId")) || undefined;
  const [tab] = forcedTabId
    ? [await chrome.tabs.get(forcedTabId)]
    : await chrome.tabs.query({ active: true, currentWindow: true });
  view.tabId = tab?.id;
  const isInstagram = !!tab?.url && /^https:\/\/([a-z0-9-]+\.)*instagram\.com\//i.test(tab.url);

  if (!tab?.id || (tab.url && !isInstagram)) {
    view.media = [];
    renderMedia();
    showMediaMessage("Abra o Instagram", "Navegue até uma publicação, reel ou perfil em instagram.com e abra o InstaFetch novamente.");
    return;
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: "GET_MEDIA" } satisfies ContentRequest)) as
      | MediaResponse
      | undefined;
    view.media = response?.items ?? [];
    const keys = new Set(view.media.map((m) => m.key));
    for (const key of view.selected) if (!keys.has(key)) view.selected.delete(key);
    renderMedia();
    if (view.media.length === 0) {
      showMediaMessage(
        "Nenhuma mídia encontrada",
        "Role a página ou abra uma publicação. Em carrosséis, passe pelos itens ou recarregue a publicação para capturar todos.",
      );
    }
  } catch {
    view.media = [];
    renderMedia();
    showMediaMessage(
      "Recarregue a página",
      "O InstaFetch ainda não está ativo nesta aba (ela foi aberta antes da instalação). Recarregue a página do Instagram e tente novamente.",
    );
  }
}

// ---------- Mídias ----------

function filtered() {
  return applyFilters(view.media, view.filter, view.bg.settings.minResolution);
}

function visibleMedia(): MediaItem[] {
  return filtered().visible;
}

/** Último job de cada mídia, para mostrar o estado sobre a miniatura. */
function latestJobByKey(): Map<string, DownloadJob> {
  const map = new Map<string, DownloadJob>();
  for (const job of view.bg.jobs) {
    const current = map.get(job.media.key);
    if (!current || job.createdAt >= current.createdAt) map.set(job.media.key, job);
  }
  return map;
}

function renderMedia(): void {
  ui.mediaMessage.hidden = true;
  const counts = { all: view.media.length, image: 0, video: 0 };
  // Contadores consideram o filtro de resolução atual.
  const matching = applyFilters(view.media, "all", view.bg.settings.minResolution).visible;
  counts.all = matching.length;
  for (const m of matching) counts[m.type]++;
  $("count-all").textContent = String(counts.all);
  $("count-image").textContent = String(counts.image);
  $("count-video").textContent = String(counts.video);

  const { visible: items, hiddenByResolution } = filtered();
  ui.grid.replaceChildren(...items.map(renderCard));
  ui.hiddenInfo.textContent = hiddenByResolution
    ? `${hiddenByResolution} ${hiddenByResolution === 1 ? "oculta" : "ocultas"} (menores)`
    : "";
  ui.minResolution.classList.toggle("active", view.bg.settings.minResolution > 0);
  if (view.media.length > 0 && items.length === 0) {
    if (hiddenByResolution > 0) {
      showMediaMessage("Nada nesta resolução", "Todas as mídias encontradas são menores que o filtro escolhido.");
      ui.mediaMessage.append(
        h("br"),
        h("button", { class: "link", onclick: () => setMinResolution(0) }, "Mostrar todas as resoluções"),
      );
    } else {
      showMediaMessage("Nada neste filtro", view.filter === "video" ? "Nenhum vídeo encontrado." : "Nenhuma imagem encontrada.");
    }
  }
  updateCardStatuses();
  renderSelection();
}

function renderCard(item: MediaItem): HTMLLIElement {
  const unavailable = !!item.unavailableReason;
  const checkbox = h("input", {
    type: "checkbox",
    "aria-label": "Selecionar mídia",
    disabled: unavailable,
  });
  checkbox.checked = view.selected.has(item.key);
  checkbox.addEventListener("change", () => toggleSelection(item.key, checkbox.checked));

  // O tipo já aparece no selo da miniatura; aqui ficam resolução e tamanho estimado.
  const meta =
    [formatResolution(item), estimateSize(item)].filter(Boolean).join(" · ") || (item.type === "video" ? "Vídeo" : "Imagem");

  const downloadBtn = h(
    "button",
    {
      class: "icon-btn",
      title: unavailable ? item.unavailableReason : "Baixar esta mídia",
      "aria-label": "Baixar esta mídia",
      onclick: () => void enqueue([item]),
    },
    icon(ICONS.download),
  );
  if (unavailable) downloadBtn.addEventListener("click", () => toast(item.unavailableReason!), { capture: true });

  const card = h(
    "li",
    {
      class: `card${checkbox.checked ? " selected" : ""}${unavailable ? " unavailable" : ""}`,
      "data-key": item.key,
      title: item.unavailableReason,
    },
    h(
      "label",
      { class: "thumb" },
      thumbnail(item.thumbnailUrl ?? (item.type === "image" ? item.url : undefined), item.type),
      checkbox,
      h("span", { class: "type-badge" }, item.type === "video" ? "Vídeo" : "Foto"),
    ),
    h("div", { class: "card-info" }, h("span", { class: "meta", title: meta }, unavailable ? "Indisponível" : meta), downloadBtn),
  );
  return card;
}

function updateCardStatuses(): void {
  const jobs = latestJobByKey();
  for (const card of ui.grid.querySelectorAll<HTMLLIElement>(".card")) {
    const job = jobs.get(card.dataset.key ?? "");
    let badge = card.querySelector<HTMLElement>(".card-status");
    if (!job) {
      badge?.remove();
      continue;
    }
    if (!badge) {
      badge = h("div", { class: "card-status" });
      card.append(badge);
    }
    const percent = progressPercent(job);
    badge.className = `card-status ${job.status}`;
    badge.textContent =
      job.status === "downloading" && percent !== undefined ? `Baixando ${percent}%` : STATUS_LABEL[job.status];
    badge.title = job.error ?? "";
  }
}

function toggleSelection(key: string, selected: boolean): void {
  if (selected) view.selected.add(key);
  else view.selected.delete(key);
  ui.grid.querySelector(`.card[data-key="${CSS.escape(key)}"]`)?.classList.toggle("selected", selected);
  renderSelection();
}

function renderSelection(): void {
  const n = view.selected.size;
  ui.selectionInfo.textContent = n === 0 ? "Nenhuma selecionada" : n === 1 ? "1 selecionada" : `${n} selecionadas`;
  ui.downloadSelected.disabled = n === 0;
  ui.downloadSelected.textContent = n > 0 ? `Baixar selecionadas (${n})` : "Baixar selecionadas";
  const selectable = visibleMedia().filter((m) => !m.unavailableReason);
  ui.selectAll.disabled = selectable.length === 0 || selectable.every((m) => view.selected.has(m.key));
  ui.clearSelection.disabled = n === 0;
}

async function enqueue(items: MediaItem[]): Promise<void> {
  const downloadable = items.filter((m) => !m.unavailableReason);
  if (downloadable.length === 0) return;
  try {
    const result = await send<{ added?: number; ok?: boolean; error?: string }>({ type: "ENQUEUE", items: downloadable });
    if (!result || result.ok === false) throw new Error(result?.error ?? "Sem resposta da extensão.");
    const added = result?.added ?? 0;
    const skipped = downloadable.length - added;
    if (added === 0) toast("Essas mídias já estão na fila.");
    else toast(`${added} ${added === 1 ? "download adicionado" : "downloads adicionados"} à fila${skipped ? ` (${skipped} já estavam na fila)` : ""}.`);
  } catch (error) {
    toast(`Não foi possível adicionar à fila. ${error instanceof Error ? error.message : ""}`);
  }
}

// ---------- Fila ----------

const queueRows = new Map<string, HTMLLIElement>();

function renderQueue(): void {
  const jobs = [...view.bg.jobs].reverse();
  const summary = summarize(view.bg.jobs);

  ui.queueEmpty.hidden = jobs.length > 0;
  ui.queueBadge.hidden = summary.active === 0;
  ui.queueBadge.textContent = String(summary.active);
  ui.retryFailed.disabled = summary.failed === 0;
  ui.cancelAll.disabled = summary.active === 0;
  ui.clearFinished.disabled = summary.done === 0;
  ui.queueSummary.textContent = jobs.length
    ? `${summary.completed} de ${summary.total} concluídos${summary.failed ? ` · ${summary.failed} com falha` : ""}`
    : "Nenhum download";

  const seen = new Set<string>();
  const ordered: HTMLLIElement[] = [];
  for (const job of jobs) {
    seen.add(job.id);
    let row = queueRows.get(job.id);
    if (!row) {
      row = createQueueRow(job);
      queueRows.set(job.id, row);
    }
    updateQueueRow(row, job);
    ordered.push(row);
  }
  for (const [id, row] of queueRows) {
    if (!seen.has(id)) {
      row.remove();
      queueRows.delete(id);
    }
  }
  ui.queueList.replaceChildren(...ordered);
}

function createQueueRow(job: DownloadJob): HTMLLIElement {
  return h(
    "li",
    { class: "row" },
    h("div", { class: "mini" }, thumbnail(job.media.thumbnailUrl ?? job.media.url, job.media.type, 18)),
    h(
      "div",
      { class: "body" },
      h("div", { class: "name", title: job.filename }, basename(job.filename)),
      h("div", { class: "detail" }),
      h("div", { class: "progress-bar" }, h("div")),
    ),
    h("div", { class: "actions" }),
  );
}

function updateQueueRow(row: HTMLLIElement, job: DownloadJob): void {
  const detail = row.querySelector<HTMLElement>(".detail")!;
  const bar = row.querySelector<HTMLElement>(".progress-bar")!;
  const actions = row.querySelector<HTMLElement>(".actions")!;
  const percent = progressPercent(job);

  const sizeText =
    job.status === "downloading" && job.totalBytes
      ? `${formatBytes(job.bytesReceived)} de ${formatBytes(job.totalBytes)}`
      : job.status === "completed"
        ? formatBytes(job.totalBytes)
        : "";
  detail.className = `detail${job.error ? " error" : ""}`;
  detail.replaceChildren(
    h("span", { class: `status ${job.status}` }, STATUS_LABEL[job.status]),
    job.error ?? sizeText,
    job.attempts > 1 && !job.error ? ` · tentativa ${job.attempts}` : "",
  );

  bar.hidden = job.status !== "downloading" && job.status !== "waiting";
  bar.classList.toggle("indeterminate", job.status === "downloading" && percent === undefined);
  (bar.firstElementChild as HTMLElement).style.width = `${percent ?? 0}%`;

  const key = `${job.status}:${job.downloadId ?? ""}`;
  if (actions.dataset.key === key) return;
  actions.dataset.key = key;
  const buttons: HTMLElement[] = [];
  if (job.status === "waiting" || job.status === "downloading") {
    buttons.push(
      h("button", { class: "icon-btn", title: "Cancelar", "aria-label": "Cancelar", onclick: () => void send({ type: "CANCEL", jobId: job.id }) }, icon(ICONS.close)),
    );
  }
  if ((job.status === "failed" || job.status === "cancelled") && !job.media.unavailableReason) {
    buttons.push(
      h("button", { class: "icon-btn", title: "Tentar novamente", "aria-label": "Tentar novamente", onclick: () => void send({ type: "RETRY", jobId: job.id }) }, icon(ICONS.retry)),
    );
  }
  if (job.status === "completed" && job.downloadId !== undefined) {
    const id = job.downloadId;
    buttons.push(
      h("button", { class: "icon-btn", title: "Mostrar na pasta", "aria-label": "Mostrar na pasta", onclick: () => void showFile(id) }, icon(ICONS.folder)),
    );
  }
  actions.replaceChildren(...buttons);
}

async function showFile(downloadId: number): Promise<void> {
  const result = await send<{ ok: boolean; error?: string }>({ type: "SHOW_FILE", downloadId });
  if (!result?.ok) toast(result?.error ?? "Não foi possível localizar o arquivo.");
}

// ---------- Histórico ----------

function renderHistory(): void {
  const history = view.bg.history;
  ui.historyEmpty.hidden = history.length > 0;
  ui.clearHistory.disabled = history.length === 0;
  ui.historySummary.textContent = history.length ? `${history.length} ${history.length === 1 ? "arquivo" : "arquivos"}` : "";
  ui.historyList.replaceChildren(...history.map(renderHistoryRow));
}

function renderHistoryRow(entry: HistoryEntry): HTMLLIElement {
  return h(
    "li",
    { class: "row" },
    h("div", { class: "mini" }, icon(entry.type === "video" ? ICONS.video : ICONS.image)),
    h(
      "div",
      { class: "body" },
      h("div", { class: "name", title: entry.filename }, basename(entry.filename)),
      h("div", { class: "detail" }, formatDate(entry.finishedAt), entry.shortcode ? ` · publicação ${entry.shortcode}` : ""),
    ),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { class: "icon-btn", title: "Mostrar na pasta", "aria-label": "Mostrar na pasta", onclick: () => void showFile(entry.downloadId) },
        icon(ICONS.folder),
      ),
    ),
  );
}

// ---------- Estado geral ----------

function renderOverall(): void {
  // Progresso do lote mais recente.
  const lastBatch = view.bg.jobs.at(-1)?.batchId;
  const jobs = view.bg.jobs.filter((j) => j.batchId === lastBatch);
  const summary = summarize(jobs);
  const show = jobs.length > 1 || summary.active > 0;
  ui.overall.hidden = !show || view.tab === "settings";
  if (!show) return;
  ui.overallBar.style.width = `${summary.percent}%`;
  const parts = [`${summary.done} de ${summary.total} processados`];
  if (summary.failed) parts.push(`${summary.failed} com falha`);
  if (summary.cancelled) parts.push(`${summary.cancelled} cancelados`);
  if (summary.active === 0) parts.push("lote finalizado");
  ui.overallText.textContent = parts.join(" · ");
}

function setMinResolution(value: number): void {
  // Atualiza na hora; a configuração salva volta pelo broadcast do service worker.
  view.bg = { ...view.bg, settings: { ...view.bg.settings, minResolution: value } };
  ui.minResolution.value = String(value);
  // Mídias que saíram do filtro deixam de estar selecionadas.
  const visible = new Set(visibleMedia().map((m) => m.key));
  for (const key of view.selected) if (!visible.has(key)) view.selected.delete(key);
  renderMedia();
  void send({ type: "SET_SETTINGS", settings: { minResolution: value } });
}

function renderBackground(): void {
  const resolutionChanged = Number(ui.minResolution.value) !== view.bg.settings.minResolution;
  updateCardStatuses();
  renderQueue();
  renderHistory();
  renderOverall();
  ui.concurrency.value = String(view.bg.settings.concurrency);
  ui.subfolders.checked = view.bg.settings.useSubfolders;
  ui.showOverlay.checked = view.bg.settings.showOverlay;
  if (resolutionChanged) {
    ui.minResolution.value = String(view.bg.settings.minResolution);
    renderMedia();
  }
}

function switchTab(tab: Tab): void {
  view.tab = tab;
  ui.tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
  ui.panels.forEach((p) => (p.hidden = p.dataset.panel !== tab));
  ui.downloadSelected.hidden = tab !== "media";
  ui.footer.hidden = tab === "settings";
  renderOverall();
}

// ---------- Eventos ----------

ui.tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab as Tab)));
ui.chips.forEach((chip) =>
  chip.addEventListener("click", () => {
    view.filter = chip.dataset.filter as TypeFilter;
    ui.chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    renderMedia();
  }),
);
ui.selectAll.addEventListener("click", () => {
  for (const m of visibleMedia()) if (!m.unavailableReason) view.selected.add(m.key);
  renderMedia();
});
ui.clearSelection.addEventListener("click", () => {
  view.selected.clear();
  renderMedia();
});
ui.refresh.addEventListener("click", () => void loadMedia().then(() => toast("Lista atualizada.")));
ui.downloadSelected.addEventListener("click", async () => {
  const items = view.media.filter((m) => view.selected.has(m.key));
  await enqueue(items);
  view.selected.clear();
  renderMedia();
});
ui.retryFailed.addEventListener("click", () => void send({ type: "RETRY_FAILED" }));
ui.cancelAll.addEventListener("click", () => void send({ type: "CANCEL_ALL" }));
ui.clearFinished.addEventListener("click", () => void send({ type: "CLEAR_FINISHED" }));
ui.openFolder.addEventListener("click", () => void send({ type: "SHOW_FOLDER" }));
ui.clearHistory.addEventListener("click", () => {
  if (confirm("Limpar o histórico do InstaFetch? Os arquivos baixados não serão apagados.")) {
    void send({ type: "CLEAR_HISTORY" });
  }
});
ui.concurrency.addEventListener("change", () =>
  void send({ type: "SET_SETTINGS", settings: { concurrency: Number(ui.concurrency.value) } }),
);
ui.subfolders.addEventListener("change", () =>
  void send({ type: "SET_SETTINGS", settings: { useSubfolders: ui.subfolders.checked } }),
);

ui.minResolution.replaceChildren(
  ...RESOLUTION_OPTIONS.map((value) => h("option", { value: String(value) }, RESOLUTION_LABELS[value])),
);
ui.minResolution.addEventListener("change", () => setMinResolution(Number(ui.minResolution.value)));
ui.showOverlay.addEventListener("change", () =>
  void send({ type: "SET_SETTINGS", settings: { showOverlay: ui.showOverlay.checked } }),
);

connect();
void loadMedia();
