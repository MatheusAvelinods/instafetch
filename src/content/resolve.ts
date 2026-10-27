import type { MediaItem } from "../shared/types";
import { isAllowedMediaUrl, mediaKey } from "../shared/url";
import { mediaFromImage, mediaFromVideo, postContext, STREAMING_REASON, videoSources } from "./dom";
import type { MediaStore } from "./store";

/**
 * Descobre qual mídia um elemento da página representa, preferindo a versão
 * de maior resolução já conhecida (dados JSON) à que está sendo exibida, que
 * muitas vezes é só uma miniatura.
 */
export function resolveElement(
  el: HTMLImageElement | HTMLVideoElement,
  store: MediaStore,
  doc: Document = document,
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

  // 2. A capa (poster) é o mesmo arquivo usado como miniatura nos dados JSON.
  if (el.poster && isAllowedMediaUrl(el.poster)) {
    const posterKey = mediaKey(el.poster);
    const match = videos.find((v) => v.thumbnailUrl && mediaKey(v.thumbnailUrl) === posterKey);
    if (match) return match;
  }

  // 3. A publicação tem um único vídeo conhecido.
  const shortcode = postContext(el, doc);
  if (shortcode) {
    const ofPost = videos.filter((v) => v.shortcode === shortcode);
    if (ofPost.length === 1) return ofPost[0];
  }

  return mediaFromVideo(el, doc) ?? {
    key: `video:${shortcode ?? "desconhecido"}`,
    type: "video",
    url: "",
    shortcode,
    source: "dom",
    unavailableReason: STREAMING_REASON,
  };
}
