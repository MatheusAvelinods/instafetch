import { describe, expect, it } from "vitest";
import { extractFromPayload, parseJsonLoose } from "../src/content/extract";

const img = (id: string, w: number) => ({
  url: `https://scontent-gru1-1.cdninstagram.com/v/t51/${id}_n.jpg?stp=p${w}`,
  width: w,
  height: w,
});

describe("extractFromPayload", () => {
  it("extrai a maior versão de uma imagem com dono e shortcode", () => {
    const payload = {
      data: {
        items: [
          {
            code: "Cabc123",
            user: { username: "fulano" },
            image_versions2: { candidates: [img("1", 320), img("1", 1080), img("1", 640)] },
          },
        ],
      },
    };
    const [item] = extractFromPayload(payload);
    expect(item).toMatchObject({ type: "image", width: 1080, shortcode: "Cabc123", owner: "fulano" });
    expect(item.key).toBe("/v/t51/1_n.jpg");
  });

  it("lista cada item do carrossel com índice e sem a capa duplicada", () => {
    const payload = {
      code: "Ccar",
      user: { username: "ciclana" },
      image_versions2: { candidates: [img("cover", 1080)] },
      carousel_media: [
        { image_versions2: { candidates: [img("a", 1080)] } },
        {
          image_versions2: { candidates: [img("thumb", 640)] },
          video_versions: [{ url: "https://x.cdninstagram.com/o1/v/b.mp4", width: 720, height: 1280 }],
        },
      ],
    };
    const items = extractFromPayload(payload);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "image", index: 1, shortcode: "Ccar", owner: "ciclana" });
    expect(items[1]).toMatchObject({ type: "video", index: 2, width: 720, height: 1280 });
    expect(items[1].thumbnailUrl).toContain("thumb_n.jpg");
  });

  it("entende o formato GraphQL antigo (display_url / edge_sidecar)", () => {
    const payload = {
      shortcode_media: {
        shortcode: "Cold",
        owner: { username: "beltrano" },
        edge_sidecar_to_children: {
          edges: [
            { node: { display_url: img("x", 1080).url, dimensions: { width: 1080, height: 1350 } } },
            { node: { display_url: img("y", 1080).url, video_url: "https://x.fbcdn.net/v/y.mp4" } },
          ],
        },
      },
    };
    const items = extractFromPayload(payload);
    expect(items.map((i) => i.type)).toEqual(["image", "video"]);
    expect(items[0]).toMatchObject({ width: 1080, height: 1350, owner: "beltrano", shortcode: "Cold" });
  });

  it("ignora URLs fora dos CDNs do Instagram", () => {
    const payload = { image_versions2: { candidates: [{ url: "https://evil.example.com/a.jpg", width: 9, height: 9 }] } };
    expect(extractFromPayload(payload)).toEqual([]);
  });

  it("não confunde fotos de perfil com mídias", () => {
    const payload = { user: { username: "x", profile_pic_url: img("p", 150).url } };
    expect(extractFromPayload(payload)).toEqual([]);
  });
});

describe("parseJsonLoose", () => {
  it("remove o prefixo for (;;);", () => {
    expect(parseJsonLoose('for (;;);{"a":1}')).toEqual({ a: 1 });
  });
  it("devolve undefined para texto inválido", () => {
    expect(parseJsonLoose("<html>")).toBeUndefined();
  });
});
