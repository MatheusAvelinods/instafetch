/**
 * Content script (mundo isolado). Junta as mídias vindas do DOM, dos dados JSON
 * embutidos na página e das respostas observadas pelo page-hook, e responde ao popup.
 */
import { extractFromPayload, looksLikeMediaPayload, parseJsonLoose } from "./extract";
import { isCandidate, scanDom } from "./dom";
import { MediaOverlay } from "./overlay";
import { isStoryPath, resolveElement } from "./resolve";
import { MediaStore, SegmentLog, selectForPage } from "./store";
import {
  PAGE_MESSAGE_SOURCE,
  type BackgroundRequest,
  type ContentRequest,
  type EnqueueResponse,
  type JobStatusSummary,
  type MediaResponse,
} from "../shared/messages";
import { isAllowedMediaUrl, mediaKey, shortcodeFromPath } from "../shared/url";
import { SETTINGS_KEY, normalizeSettings } from "../storage/settings";
import type { MediaItem, Settings } from "../shared/types";

const store = new MediaStore();
const segments = new SegmentLog();

const sendToBackground = <T>(request: BackgroundRequest) => chrome.runtime.sendMessage(request) as Promise<T>;

const overlay = new MediaOverlay({
  resolve: (el) => resolveElement(el, store, document, segments),
  enqueue: (item) => sendToBackground<EnqueueResponse>({ type: "ENQUEUE", items: [item] }),
  status: (jobIds) => sendToBackground<JobStatusSummary[]>({ type: "JOB_STATUS", jobIds }),
});

/** Mídias da página que recebem o botão de download. */
function overlayTargets(): (HTMLImageElement | HTMLVideoElement)[] {
  return [...document.querySelectorAll("img, video")].filter(
    (el): el is HTMLImageElement | HTMLVideoElement =>
      isCandidate(el) && (el instanceof HTMLVideoElement || isAllowedMediaUrl(el.currentSrc || el.src)),
  );
}

function refreshOverlay(): void {
  if (overlay.isEnabled) overlay.sync(overlayTargets());
}

function applySettings(settings: Settings): void {
  overlay.setEnabled(settings.showOverlay);
  refreshOverlay();
}
const scannedScripts = new WeakSet<HTMLScriptElement>();

function scanEmbeddedJson(): void {
  for (const script of document.querySelectorAll<HTMLScriptElement>("script[type='application/json']")) {
    if (scannedScripts.has(script)) continue;
    scannedScripts.add(script);
    const text = script.textContent ?? "";
    if (!looksLikeMediaPayload(text)) continue;
    const payload = parseJsonLoose(text);
    if (payload !== undefined) store.add(extractFromPayload(payload, "embedded"));
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { source?: string; type?: string; payload?: unknown; url?: unknown } | null;
  if (!data || data.source !== PAGE_MESSAGE_SOURCE) return;
  if (data.type === "PAYLOAD") {
    store.add(extractFromPayload(data.payload, "network"));
  } else if (data.type === "SEGMENT" && typeof data.url === "string" && isAllowedMediaUrl(data.url)) {
    segments.add(mediaKey(data.url));
  }
});

// Itens de carrossel só entram no DOM quando o usuário navega por eles, então
// observamos mudanças para acumular cada slide exibido.
let scanTimer: number | undefined;
function scheduleDomScan(): void {
  if (scanTimer !== undefined) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = undefined;
    store.add(scanDom());
    refreshOverlay();
  }, 400);
}

function start(): void {
  scanEmbeddedJson();
  store.add(scanDom());
  chrome.storage.local
    .get(SETTINGS_KEY)
    .then((data) => applySettings(normalizeSettings(data[SETTINGS_KEY] as Partial<Settings> | undefined)))
    .catch(() => applySettings(normalizeSettings(undefined)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_KEY]) {
      applySettings(normalizeSettings(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined));
    }
  });
  // Imagens que terminam de carregar mudam de tamanho e podem passar a ter botão.
  document.addEventListener("load", (event) => {
    if (event.target instanceof HTMLImageElement) scheduleDomScan();
  }, true);
  document.addEventListener("loadedmetadata", scheduleDomScan, true);
  // Janelas e slides que só mudam de classe/estilo ao abrir não geram novos nós:
  // varre de novo após interações e, com a aba visível, de tempos em tempos.
  for (const type of ["click", "keydown"]) document.addEventListener(type, scheduleDomScan, { capture: true, passive: true });
  window.setInterval(() => {
    if (document.visibilityState === "visible") scheduleDomScan();
  }, 2000);
  new MutationObserver(scheduleDomScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === "GET_MEDIA") {
    scanEmbeddedJson();
    store.add(scanDom());
    const pageShortcode = shortcodeFromPath(location.pathname);
    let items = selectForPage(store.all(), pageShortcode);
    if (isStoryPath(location.pathname)) {
      // Em stories, o que está na tela vem primeiro, já identificado (sem o aviso de streaming).
      const current = overlayTargets()
        .map((el) => resolveElement(el, store, document, segments))
        .filter((item): item is MediaItem => !!item && !item.unavailableReason);
      if (current.length > 0) {
        const keys = new Set(current.map((item) => item.key));
        items = [...current, ...items.filter((item) => !keys.has(item.key) && !item.unavailableReason)];
      }
    }
    const response: MediaResponse = { pageUrl: location.href, pageShortcode, items };
    sendResponse(response);
  } else if (message.type === "CLEAR_MEDIA") {
    store.clear();
    store.add(scanDom());
    sendResponse({ ok: true });
  }
  return false;
});
