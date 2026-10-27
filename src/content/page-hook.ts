/**
 * Executa no contexto da página (world: MAIN). Observa as respostas JSON que o
 * próprio Instagram já recebeu na sessão do usuário e repassa ao content script.
 * Não faz requisições novas e não altera as respostas.
 */
import { looksLikeMediaPayload, parseJsonLoose } from "./extract";
import { PAGE_MESSAGE_SOURCE, type PagePayloadMessage, type PageSegmentMessage } from "../shared/messages";

const MAX_TEXT = 15 * 1024 * 1024;

function forward(text: string): void {
  if (text.length > MAX_TEXT || !looksLikeMediaPayload(text)) return;
  // Respostas em streaming podem trazer vários JSON separados por linha.
  const chunks = text.includes("\n{") ? text.split(/\n(?=\{)/) : [text];
  for (const chunk of chunks) {
    const payload = parseJsonLoose(chunk);
    if (payload === undefined) continue;
    const message: PagePayloadMessage = { source: PAGE_MESSAGE_SOURCE, type: "PAYLOAD", payload };
    window.postMessage(message, window.location.origin);
  }
}

/**
 * Vídeos em partes (stories, reels) chegam como pedaços de vídeo/áudio. Só o
 * endereço é repassado, para saber qual vídeo está tocando; o conteúdo não é lido.
 */
function forwardSegment(url: string, contentType: string): void {
  if (!/^(video|audio)\//.test(contentType) || !url.startsWith("https://")) return;
  const message: PageSegmentMessage = { source: PAGE_MESSAGE_SOURCE, type: "SEGMENT", url };
  window.postMessage(message, window.location.origin);
}

const originalFetch = window.fetch;
window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
  const response = await originalFetch.apply(this, args);
  try {
    const type = response.headers.get("content-type") ?? "";
    forwardSegment(response.url, type);
    if (/json|javascript|text/.test(type)) {
      response
        .clone()
        .text()
        .then(forward)
        .catch(() => undefined);
    }
  } catch {
    // Nunca interfere no funcionamento da página.
  }
  return response;
};

const originalSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
  this.addEventListener("load", () => {
    try {
      forwardSegment(this.responseURL, this.getResponseHeader("content-type") ?? "");
      if (this.responseType === "" || this.responseType === "text") forward(this.responseText);
      else if (this.responseType === "json" && this.response) forward(JSON.stringify(this.response));
    } catch {
      // Ignora respostas que não podem ser lidas.
    }
  });
  return originalSend.apply(this, args);
};
