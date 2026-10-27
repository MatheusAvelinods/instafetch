import type { MediaItem } from "../shared/types";
import { isAllowedMediaUrl, mediaKey } from "../shared/url";
import { mediaFromImage, mediaFromVideo, postContext, videoSources } from "./dom";
import type { MediaStore, SegmentLog } from "./store";

/** Diferença máxima (s) entre a duração do <video> e a informada pelo Instagram. */
const DURATION_TOLERANCE = 0.35;

export const STORY_UNAVAILABLE =
  "Não consegui identificar este vídeo do story. Deixe-o tocar por um instante e tente de novo; se continuar, recarregue a página.";
export const POST_VIDEO_UNAVAILABLE =
  "Não consegui identificar este vídeo. Abra a publicação diretamente (ou recarregue a página) e tente de novo.";

/** Id da mídia em URLs de story: /stories/<usuario>/<id>/. */
export function storyMediaIdFromPath(path: string): string | undefined {
  return path.match(/^\/stories\/(?!highlights\/)[^/]+\/(\d+)/)?.[1];
}

export const isStoryPath = (path: string) => path.startsWith("/stories/");

/**
 * Descobre qual mídia um elemento da página representa, preferindo a versão
 * de maior resolução já conhecida (dados JSON) à que está sendo exibida, que
 * muitas vezes é só uma miniatura.
 */
export function resolveElement(
  el: HTMLImageElement | HTMLVideoElement,
  store: MediaStore,
  doc: Document = document,
  segments?: SegmentLog,
): MediaItem | undefined {
  if (el instanceof HTMLImageElement) {
    const fromDom = mediaFromImage(el, doc);
    if (!fromDom) return undefined;
    const keys = [fromDom.key, mediaKey(el.currentSrc || el.src)];
    for (const key of keys) {
      const known = store.get(key);
      if (known) return known;
    }
    // Na grade do perfil, a miniatura de um reel é a capa do vídeo: baixa o vídeo.
    const video = store
      .all()
      .find((v) => v.type === "video" && !v.unavailableReason && v.thumbnailUrl && keys.includes(mediaKey(v.thumbnailUrl)));
    return video ?? fromDom;
  }

  // 1. Link direto no próprio <video>.
  const direct = videoSources(el).find(isAllowedMediaUrl);
  if (direct) return store.get(mediaKey(direct)) ?? mediaFromVideo(el, doc);

  const videos = store.all().filter((item) => item.type === "video" && !item.unavailableReason);
  const path = doc.location?.pathname ?? "";

  // 2. A capa (poster) é o mesmo arquivo usado como miniatura nos dados JSON.
  if (el.poster && isAllowedMediaUrl(el.poster)) {
    const posterKey = mediaKey(el.poster);
    const match = videos.find((v) => v.thumbnailUrl && mediaKey(v.thumbnailUrl) === posterKey);
    if (match) return match;
  }

  // 3. Story aberto pela URL /stories/<usuario>/<id>/.
  const storyId = storyMediaIdFromPath(path);
  if (storyId) {
    const match = videos.find((v) => v.mediaId === storyId);
    if (match) return match;
  }

  // 4. Vídeo em partes (stories, destaques, reels): duração + pedaços que o player baixou.
  const byPlayback = matchByPlayback(el, videos, segments);
  if (byPlayback) return byPlayback;

  // 5. A publicação tem um único vídeo conhecido.
  const shortcode = postContext(el, doc);
  if (shortcode) {
    const ofPost = videos.filter((v) => v.shortcode === shortcode);
    if (ofPost.length === 1) return ofPost[0];
  }

  const reason = isStoryPath(path) ? STORY_UNAVAILABLE : POST_VIDEO_UNAVAILABLE;
  const fromDom = mediaFromVideo(el, doc);
  if (fromDom && !fromDom.unavailableReason) return fromDom;
  return {
    key: fromDom?.key ?? `video:${shortcode ?? "desconhecido"}`,
    type: "video",
    url: fromDom?.url ?? "",
    thumbnailUrl: fromDom?.thumbnailUrl,
    shortcode,
    source: "dom",
    unavailableReason: reason,
  };
}

/**
 * Restringe pelos vídeos com a mesma duração do que está tocando e desempata
 * pelo pedaço de vídeo baixado mais recentemente que pertença a um deles.
 */
function matchByPlayback(el: HTMLVideoElement, videos: MediaItem[], segments?: SegmentLog): MediaItem | undefined {
  let candidates = videos;
  const duration = el.duration;
  if (Number.isFinite(duration) && duration > 0) {
    const sameDuration = videos.filter(
      (v) => v.duration !== undefined && Math.abs(v.duration - duration) <= DURATION_TOLERANCE,
    );
    if (sameDuration.length === 1) return sameDuration[0];
    if (sameDuration.length > 1) candidates = sameDuration;
  }

  const recent = segments?.recent() ?? [];
  for (const key of recent) {
    const match = candidates.find((v) => v.dashKeys?.includes(key));
    if (match) return match;
  }
  return undefined;
}
