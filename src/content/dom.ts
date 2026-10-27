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
function postContext(el: Element, doc: Document): string | undefined {
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

/** Varre imagens e vídeos visíveis na página. */
export function scanDom(doc: Document = document): MediaItem[] {
  const out: MediaItem[] = [];

  for (const img of doc.querySelectorAll<HTMLImageElement>("img")) {
    if (AVATAR_ALT.test(img.alt) || !isLargeEnough(img)) continue;
    const { url, width } = bestImageUrl(img);
    if (!isAllowedMediaUrl(url)) continue;
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : undefined;
    out.push({
      key: mediaKey(url),
      type: "image",
      url,
      thumbnailUrl: img.currentSrc || img.src,
      width: width ?? (img.naturalWidth || undefined),
      height: width && ratio ? Math.round(width * ratio) : img.naturalHeight || undefined,
      shortcode: postContext(img, doc),
      source: "dom",
    });
  }

  for (const video of doc.querySelectorAll<HTMLVideoElement>("video")) {
    if (!isLargeEnough(video)) continue;
    const sources = [video.currentSrc, video.src, ...[...video.querySelectorAll("source")].map((s) => s.src)].filter(
      Boolean,
    );
    const direct = sources.find(isAllowedMediaUrl);
    const poster = video.poster && isAllowedMediaUrl(video.poster) ? video.poster : undefined;
    const shortcode = postContext(video, doc);

    if (direct) {
      out.push({
        key: mediaKey(direct),
        type: "video",
        url: direct,
        thumbnailUrl: poster,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        shortcode,
        source: "dom",
      });
    } else if (sources.some((s) => s.startsWith("blob:"))) {
      out.push({
        key: `blob:${shortcode ?? sources[0]}`,
        type: "video",
        url: sources[0],
        thumbnailUrl: poster,
        shortcode,
        source: "dom",
        unavailableReason:
          "Este vídeo é transmitido em partes. Abra a publicação diretamente (ou recarregue a página) para a extensão obter o link do arquivo.",
      });
    }
  }

  return out;
}
