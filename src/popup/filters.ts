import type { MediaItem, MediaType } from "../shared/types";

export type TypeFilter = "all" | MediaType;

/** Maior lado da mídia em pixels, quando conhecido. */
export function longestSide(item: MediaItem): number | undefined {
  if (!item.width && !item.height) return undefined;
  return Math.max(item.width ?? 0, item.height ?? 0);
}

/**
 * Passa no filtro de resolução quando o maior lado é >= mínimo.
 * Mídias de tamanho desconhecido só aparecem sem filtro (podem ser miniaturas).
 */
export function meetsResolution(item: MediaItem, minResolution: number): boolean {
  if (minResolution <= 0) return true;
  const side = longestSide(item);
  return side !== undefined && side >= minResolution;
}

export interface FilterResult {
  visible: MediaItem[];
  /** Quantas mídias do tipo escolhido foram escondidas pelo filtro de resolução. */
  hiddenByResolution: number;
}

export function applyFilters(items: MediaItem[], type: TypeFilter, minResolution: number): FilterResult {
  const ofType = type === "all" ? items : items.filter((m) => m.type === type);
  const visible = ofType.filter((m) => meetsResolution(m, minResolution));
  return { visible, hiddenByResolution: ofType.length - visible.length };
}

export const RESOLUTION_LABELS: Record<number, string> = {
  0: "Qualquer resolução",
  320: "≥ 320 px",
  640: "≥ 640 px",
  1080: "≥ 1080 px (HD)",
};
