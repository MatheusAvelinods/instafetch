import type { MediaItem, MediaSource } from "../shared/types";

const SOURCE_RANK: Record<MediaSource, number> = { network: 2, embedded: 2, dom: 1 };

function area(item: MediaItem): number {
  return (item.width ?? 0) * (item.height ?? 0);
}

/** Decide qual versão de uma mesma mídia manter. */
function better(current: MediaItem, incoming: MediaItem): MediaItem {
  const rankDiff = SOURCE_RANK[incoming.source] - SOURCE_RANK[current.source];
  const preferred = rankDiff > 0 || (rankDiff === 0 && area(incoming) > area(current)) ? incoming : current;
  const other = preferred === incoming ? current : incoming;
  // Mantém metadados que só uma das versões conhece.
  return {
    ...preferred,
    thumbnailUrl: preferred.thumbnailUrl ?? other.thumbnailUrl,
    shortcode: preferred.shortcode ?? other.shortcode,
    owner: preferred.owner ?? other.owner,
    index: preferred.index ?? other.index,
    mediaId: preferred.mediaId ?? other.mediaId,
    duration: preferred.duration ?? other.duration,
    dashKeys: preferred.dashKeys ?? other.dashKeys,
  };
}

/** Coleção de mídias sem duplicatas, limitada às mais recentes. */
export class MediaStore {
  private items = new Map<string, MediaItem>();

  constructor(private readonly limit = 500) {}

  add(incoming: MediaItem[]): void {
    for (const item of incoming) {
      const existing = this.items.get(item.key);
      // Reinserir move o item para o fim (mais recente).
      this.items.delete(item.key);
      this.items.set(item.key, existing ? better(existing, item) : item);
    }
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }

  get(key: string): MediaItem | undefined {
    return this.items.get(key);
  }

  clear(): void {
    this.items.clear();
  }

  all(): MediaItem[] {
    return [...this.items.values()];
  }

  get size(): number {
    return this.items.size;
  }
}

/**
 * Seleciona o que mostrar no popup. Em páginas de publicação, só as mídias
 * dela; nas demais (feed, perfil), tudo o que já foi carregado, mais recente primeiro.
 * Vídeos em streaming (blob:) do DOM só aparecem se não houver um link direto.
 */
export function selectForPage(items: MediaItem[], pageShortcode: string | undefined): MediaItem[] {
  let selected = items;
  if (pageShortcode) {
    const ofPage = items.filter((item) => item.shortcode === pageShortcode);
    if (ofPage.length > 0) selected = ofPage;
  }

  const postsWithDirectVideo = new Set(
    selected
      .filter((item) => item.type === "video" && !item.unavailableReason && item.shortcode)
      .map((item) => item.shortcode),
  );
  selected = selected.filter(
    (item) => !(item.unavailableReason && item.type === "video" && postsWithDirectVideo.has(item.shortcode)),
  );

  if (pageShortcode && selected.every((item) => item.shortcode === pageShortcode)) {
    return [...selected].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }
  return [...selected].reverse();
}

/** Últimos pedaços de vídeo baixados pelo player (caminho no CDN + horário). */
export class SegmentLog {
  private entries: { key: string; at: number }[] = [];

  constructor(
    private readonly limit = 60,
    private readonly now: () => number = Date.now,
  ) {}

  add(key: string): void {
    this.entries = this.entries.filter((e) => e.key !== key);
    this.entries.push({ key, at: this.now() });
    if (this.entries.length > this.limit) this.entries.shift();
  }

  /** Caminhos do mais recente para o mais antigo. */
  recent(): string[] {
    return this.entries.map((e) => e.key).reverse();
  }
}
