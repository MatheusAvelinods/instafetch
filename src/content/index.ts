/**
 * Content script (mundo isolado). Junta as mídias vindas do DOM, dos dados JSON
 * embutidos na página e das respostas observadas pelo page-hook, e responde ao popup.
 */
import { extractFromPayload, looksLikeMediaPayload, parseJsonLoose } from "./extract";
import { scanDom } from "./dom";
import { MediaStore, selectForPage } from "./store";
import { PAGE_MESSAGE_SOURCE, type ContentRequest, type MediaResponse } from "../shared/messages";
import { shortcodeFromPath } from "../shared/url";

const store = new MediaStore();
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
  }, 400);
}

function start(): void {
  scanEmbeddedJson();
  store.add(scanDom());
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
