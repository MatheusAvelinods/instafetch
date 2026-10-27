import type { MediaItem, MediaSource } from "../shared/types";
import { isAllowedMediaUrl, mediaKey } from "../shared/url";

interface Candidate {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface Context {
  shortcode?: string;
  owner?: string;
  index?: number;
}

const MAX_DEPTH = 60;
/** Chaves que já são tratadas explicitamente e não precisam ser percorridas. */
const HANDLED_KEYS = new Set([
  "image_versions2",
  "video_versions",
  "carousel_media",
  "edge_sidecar_to_children",
  "display_resources",
  "user",
  "owner",
]);

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Escolhe a maior resolução entre as versões oferecidas. */
export function pickLargest(candidates: unknown): { url: string; width?: number; height?: number } | undefined {
  if (!Array.isArray(candidates)) return undefined;
  let best: { url: string; width?: number; height?: number; area: number } | undefined;
  for (const raw of candidates as Candidate[]) {
    if (!isObject(raw)) continue;
    const url = asString(raw.url);
    if (!url || !isAllowedMediaUrl(url)) continue;
    const width = asNumber(raw.width);
    const height = asNumber(raw.height);
    const area = (width ?? 0) * (height ?? 0);
    if (!best || area > best.area) best = { url, width, height, area };
  }
  if (!best) return undefined;
  return { url: best.url, width: best.width, height: best.height };
}

function usernameOf(node: Json): string | undefined {
  for (const key of ["user", "owner"]) {
    const value = node[key];
    if (isObject(value)) {
      const username = asString(value.username);
      if (username) return username;
    }
  }
  return undefined;
}

/** Lê as mídias de um único nó (post, item de carrossel ou reel). */
function mediaFromNode(node: Json, ctx: Context, source: MediaSource): MediaItem | undefined {
  const image =
    pickLargest(isObject(node.image_versions2) ? node.image_versions2.candidates : undefined) ??
    pickLargest(node.display_resources) ??
    (() => {
      const url = asString(node.display_url);
      if (!url || !isAllowedMediaUrl(url)) return undefined;
      const dims = isObject(node.dimensions) ? node.dimensions : {};
      return { url, width: asNumber(dims.width), height: asNumber(dims.height) };
    })();

  const video =
    pickLargest(node.video_versions) ??
    (() => {
      const url = asString(node.video_url);
      if (!url || !isAllowedMediaUrl(url)) return undefined;
      const dims = isObject(node.dimensions) ? node.dimensions : {};
      return { url, width: asNumber(dims.width), height: asNumber(dims.height) };
    })();

  const chosen = video ?? image;
  if (!chosen) return undefined;

  return {
    key: mediaKey(chosen.url),
    type: video ? "video" : "image",
    url: chosen.url,
    thumbnailUrl: image?.url ?? (video ? undefined : chosen.url),
    width: chosen.width,
    height: chosen.height,
    shortcode: ctx.shortcode,
    owner: ctx.owner,
    index: ctx.index,
    source,
  };
}

function walk(node: unknown, ctx: Context, out: MediaItem[], source: MediaSource, depth: number): void {
  if (depth > MAX_DEPTH) return;

  if (Array.isArray(node)) {
    for (const child of node) walk(child, ctx, out, source, depth + 1);
    return;
  }
  if (!isObject(node)) return;

  const shortcode = asString(node.code) ?? asString(node.shortcode);
  const next: Context = {
    shortcode: shortcode ?? ctx.shortcode,
    owner: usernameOf(node) ?? ctx.owner,
    // Um novo post (com shortcode próprio) reinicia a numeração do carrossel.
    index: shortcode ? undefined : ctx.index,
  };

  const carousel = Array.isArray(node.carousel_media)
    ? node.carousel_media
    : isObject(node.edge_sidecar_to_children) && Array.isArray(node.edge_sidecar_to_children.edges)
      ? node.edge_sidecar_to_children.edges.map((edge) => (isObject(edge) ? edge.node : undefined))
      : undefined;

  if (carousel && carousel.length > 0) {
    // A capa do carrossel repete o primeiro item, então só os filhos são listados.
    carousel.forEach((child, i) => walk(child, { ...next, index: i + 1 }, out, source, depth + 1));
  } else {
    const media = mediaFromNode(node, next, source);
    if (media) out.push(media);
  }

  for (const [key, value] of Object.entries(node)) {
    if (HANDLED_KEYS.has(key)) continue;
    if (typeof value === "object" && value !== null) walk(value, next, out, source, depth + 1);
  }
}

/** Extrai mídias de qualquer JSON do Instagram (APIs REST, GraphQL ou dados embutidos). */
export function extractFromPayload(payload: unknown, source: MediaSource = "network"): MediaItem[] {
  const out: MediaItem[] = [];
  walk(payload, {}, out, source, 0);
  return out;
}

/** O Instagram às vezes prefixa respostas JSON com "for (;;);". */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.replace(/^\s*for\s*\(;;\);\s*/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Filtro barato antes de fazer o parse completo de um texto grande. */
export function looksLikeMediaPayload(text: string): boolean {
  return (
    text.includes("image_versions2") ||
    text.includes("video_versions") ||
    text.includes("display_url") ||
    text.includes("video_url")
  );
}
