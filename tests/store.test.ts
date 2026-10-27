import { describe, expect, it } from "vitest";
import { MediaStore, selectForPage } from "../src/content/store";
import type { MediaItem } from "../src/shared/types";

const item = (key: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  key,
  type: "image",
  url: `https://a.cdninstagram.com${key}`,
  source: "dom",
  ...extra,
});

describe("MediaStore", () => {
  it("elimina duplicatas mantendo a melhor versão", () => {
    const store = new MediaStore();
    store.add([item("/1.jpg", { width: 640, height: 640, thumbnailUrl: "t" })]);
    store.add([item("/1.jpg", { width: 1080, height: 1080, source: "network", shortcode: "X" })]);
    store.add([item("/1.jpg", { width: 320, height: 320 })]);
    const all = store.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ width: 1080, source: "network", shortcode: "X", thumbnailUrl: "t" });
  });

  it("respeita o limite descartando os mais antigos", () => {
    const store = new MediaStore(2);
    store.add([item("/1"), item("/2"), item("/3")]);
    expect(store.all().map((i) => i.key)).toEqual(["/2", "/3"]);
  });
});

describe("selectForPage", () => {
  it("na página de uma publicação mostra só as mídias dela, em ordem", () => {
    const items = [item("/b", { shortcode: "P", index: 2 }), item("/x", { shortcode: "Q" }), item("/a", { shortcode: "P", index: 1 })];
    expect(selectForPage(items, "P").map((i) => i.key)).toEqual(["/a", "/b"]);
  });

  it("oculta o vídeo em streaming quando já existe link direto", () => {
    const items = [
      item("blob:P", { type: "video", shortcode: "P", unavailableReason: "stream" }),
      item("/v.mp4", { type: "video", shortcode: "P", source: "network" }),
    ];
    expect(selectForPage(items, "P").map((i) => i.key)).toEqual(["/v.mp4"]);
  });

  it("fora de publicações mostra tudo, mais recente primeiro", () => {
    const items = [item("/1"), item("/2")];
    expect(selectForPage(items, undefined).map((i) => i.key)).toEqual(["/2", "/1"]);
  });
});
