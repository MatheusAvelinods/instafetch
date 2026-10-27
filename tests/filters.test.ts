import { describe, expect, it } from "vitest";
import { applyFilters, meetsResolution } from "../src/popup/filters";
import { normalizeSettings } from "../src/storage/settings";
import type { MediaItem } from "../src/shared/types";

const m = (key: string, width?: number, height?: number, type: MediaItem["type"] = "image"): MediaItem => ({
  key,
  type,
  url: `https://a.cdninstagram.com${key}`,
  width,
  height,
  source: "network",
});

describe("filtro de resolução", () => {
  const items = [
    m("/thumb", 150, 150),
    m("/medio", 640, 640),
    m("/full", 1080, 1350),
    m("/paisagem", 1080, 608),
    m("/video", 720, 1280, "video"),
    m("/desconhecido"),
  ];

  it("sem filtro mostra tudo", () => {
    expect(applyFilters(items, "all", 0).visible).toHaveLength(6);
  });

  it("considera o maior lado e esconde miniaturas e tamanhos desconhecidos", () => {
    const { visible, hiddenByResolution } = applyFilters(items, "all", 1080);
    expect(visible.map((i) => i.key)).toEqual(["/full", "/paisagem", "/video"]);
    expect(hiddenByResolution).toBe(3);
  });

  it("combina com o filtro de tipo", () => {
    const { visible, hiddenByResolution } = applyFilters(items, "image", 640);
    expect(visible.map((i) => i.key)).toEqual(["/medio", "/full", "/paisagem"]);
    expect(hiddenByResolution).toBe(2);
  });

  it("limite exato passa", () => {
    expect(meetsResolution(m("/x", 320, 200), 320)).toBe(true);
    expect(meetsResolution(m("/x", 319, 200), 320)).toBe(false);
  });
});

describe("configurações", () => {
  it("valida resolução mínima e mantém padrões", () => {
    expect(normalizeSettings({ minResolution: 1080 }).minResolution).toBe(1080);
    expect(normalizeSettings({ minResolution: 999 }).minResolution).toBe(0);
    expect(normalizeSettings(undefined)).toMatchObject({ showOverlay: true, minResolution: 0, concurrency: 3 });
    expect(normalizeSettings({ showOverlay: false }).showOverlay).toBe(false);
  });
});
