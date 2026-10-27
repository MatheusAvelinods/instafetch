import type { MediaItem } from "../shared/types";
import { isAllowedMediaUrl, mediaKey, shortcodeFromPath } from "../shared/url";

/** Abaixo disso a imagem provavelmente é avatar, ícone ou miniatura de interface. */
const MIN_SIDE = 150;
const AVATAR_ALT = /(profile picture|foto do perfil|foto de perfil|avatar)/i;

interface SrcsetCandidate {
  url: string;
  width: number;
}

export function parseSrcset(srcset: string): SrcsetCandidate[] {
  return srcset
    .split(/,\s+(?=https?:)/)
    .map((part) => {
      const [url, descriptor = ""] = part.trim().split(/\s+/);
      const width = Number.parseInt(descriptor, 10);
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((c) => c.url);
}

function bestImageUrl(img: HTMLImageElement): { url: string; width?: number } {
  const candidates = img.srcset ? parseSrcset(img.srcset) : [];
  const best = candidates.sort((a, b) => b.width - a.width)[0];
  if (best && isAllowedMediaUrl(best.url)) return { url: best.url, width: best.width || undefined };
  return { url: img.currentSrc || img.src, width: img.naturalWidth || undefined };
}

/** Procura o link da publicação mais próximo do elemento. */
export function postContext(el: Element, doc: Document): string | undefined {
  const container = el.closest("article, [role='dialog'], main") ?? doc.body;
  const link = container?.querySelector<HTMLAnchorElement>("a[href*='/p/'], a[href*='/reel/'], a[href*='/tv/']");
  const fromLink = link ? shortcodeFromPath(new URL(link.href, doc.baseURI).pathname) : undefined;
  return fromLink ?? shortcodeFromPath(doc.location?.pathname ?? "");
}

function isLargeEnough(el: HTMLImageElement | HTMLVideoElement): boolean {
  const rect = el.getBoundingClientRect();
  const natural =
    el instanceof HTMLImageElement ? Math.max(el.naturalWidth, el.naturalHeight) : Math.max(el.videoWidth, el.videoHeight);
  return Math.max(rect.width, rect.height) >= MIN_SIDE || natural >= MIN_SIDE;
}

/** Imagem ou vídeo grande o bastante para ser conteúdo (e não avatar ou ícone). */
export function isCandidate(el: Element): el is HTMLImageElement | HTMLVideoElement {
  if (el instanceof HTMLImageElement) return !AVATAR_ALT.test(el.alt) && isLargeEnough(el);
  if (el instanceof HTMLVideoElement) return isLargeEnough(el);
  return false;
}

export function mediaFromImage(img: HTMLImageElement, doc: Document = document): MediaItem | undefined {
  const { url, width } = bestImageUrl(img);
  if (!isAllowedMediaUrl(url)) return undefined;
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : undefined;
  return {
    key: mediaKey(url),
    type: "image",
    url,
    thumbnailUrl: img.currentSrc || img.src,
    width: width ?? (img.naturalWidth || undefined),
    height: width && ratio ? Math.round(width * ratio) : img.naturalHeight || undefined,
    shortcode: postContext(img, doc),
    source: "dom",
  };
}

export function videoSources(video: HTMLVideoElement): string[] {
  return [video.currentSrc, video.src, ...[...video.querySelectorAll("source")].map((s) => s.src)].filter(Boolean);
}

export function mediaFromVideo(video: HTMLVideoElement, doc: Document = document): MediaItem | undefined {
  const sources = videoSources(video);
  const direct = sources.find(isAllowedMediaUrl);
  const poster = video.poster && isAllowedMediaUrl(video.poster) ? video.poster : undefined;
  const shortcode = postContext(video, doc);

  if (direct) {
    return {
      key: mediaKey(direct),
      type: "video",
      url: direct,
      thumbnailUrl: poster,
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
      shortcode,
      source: "dom",
    };
  }
  if (sources.some((s) => s.startsWith("blob:"))) {
    return {
      key: `blob:${shortcode ?? sources[0]}`,
      type: "video",
      url: sources[0],
      thumbnailUrl: poster,
      shortcode,
      source: "dom",
      unavailableReason: STREAMING_REASON,
    };
  }
  return undefined;
}

export const STREAMING_REASON =
  "Este vídeo é transmitido em partes. Abra a publicação diretamente (ou recarregue a página) para a extensão obter o link do arquivo.";

/** Varre imagens e vídeos visíveis na página. */
export function scanDom(doc: Document = document): MediaItem[] {
  const out: MediaItem[] = [];
  for (const el of doc.querySelectorAll("img, video")) {
    if (!isCandidate(el)) continue;
    const item = el instanceof HTMLImageElement ? mediaFromImage(el, doc) : mediaFromVideo(el, doc);
    if (item) out.push(item);
  }
  return out;
}
