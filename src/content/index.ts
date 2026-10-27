/**
 * Content script (mundo isolado). Junta as mídias vindas do DOM, dos dados JSON
 * embutidos na página e das respostas observadas pelo page-hook, e responde ao popup.
 */
import { extractFromPayload, looksLikeMediaPayload, parseJsonLoose } from "./extract";
import { isCandidate, scanDom } from "./dom";
import { MediaOverlay } from "./overlay";
import { resolveElement } from "./resolve";
import { MediaStore, selectForPage } from "./store";
import {
  PAGE_MESSAGE_SOURCE,
  type BackgroundRequest,
  type ContentRequest,
  type EnqueueResponse,
  type JobStatusSummary,
  type MediaResponse,
} from "../shared/messages";
import { isAllowedMediaUrl, shortcodeFromPath } from "../shared/url";
import { SETTINGS_KEY, normalizeSettings } from "../storage/settings";
import type { Settings } from "../shared/types";

const store = new MediaStore();

const sendToBackground = <T>(request: BackgroundRequest) => chrome.runtime.sendMessage(request) as Promise<T>;

const overlay = new MediaOverlay({
  resolve: (el) => resolveElement(el, store),
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
  const data = event.data as { source?: string; type?: string; payload?: unknown } | null;
  if (!data || data.source !== PAGE_MESSAGE_SOURCE || data.type !== "PAYLOAD") return;
  store.add(extractFromPayload(data.payload, "network"));
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
    const response: MediaResponse = {
      pageUrl: location.href,
      pageShortcode,
      items: selectForPage(store.all(), pageShortcode),
    };
    sendResponse(response);
  } else if (message.type === "CLEAR_MEDIA") {
    store.clear();
    store.add(scanDom());
    sendResponse({ ok: true });
  }
  return false;
});
