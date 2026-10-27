import { describe, expect, it } from "vitest";
import { buildFilename, extensionFromUrl, sanitize } from "../src/shared/filename";
import { friendlyDownloadError } from "../src/shared/errors";
import { isAllowedMediaUrl, shortcodeFromPath } from "../src/shared/url";
import type { MediaItem } from "../src/shared/types";

describe("nomes de arquivo", () => {
  it("remove caracteres inválidos e acentos", () => {
    expect(sanitize('jo:ão/*"teste"?')).toBe("joaoteste");
    expect(sanitize("...")).toBe("midia");
  });

  it("detecta a extensão pela URL", () => {
    expect(extensionFromUrl("https://a.cdninstagram.com/v/1_n.jpeg?x=1", "jpg")).toBe("jpg");
    expect(extensionFromUrl("https://a.cdninstagram.com/o1/v/abc.mp4", "jpg")).toBe("mp4");
    expect(extensionFromUrl("https://a.cdninstagram.com/o1/v/abc", "mp4")).toBe("mp4");
  });

  it("usa data/hora quando não há perfil nem publicação", () => {
    const media: MediaItem = { key: "k", type: "image", url: "https://a.cdninstagram.com/1.webp", source: "dom" };
    const name = buildFilename(media, { useSubfolders: false, position: 3, now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(name).toBe("instagram_20260102_030405_03.webp");
  });
});

describe("URLs", () => {
  it("aceita apenas CDNs do Instagram por HTTPS", () => {
    expect(isAllowedMediaUrl("https://scontent.cdninstagram.com/a.jpg")).toBe(true);
    expect(isAllowedMediaUrl("https://video.fgru1-1.fna.fbcdn.net/a.mp4")).toBe(true);
    expect(isAllowedMediaUrl("http://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(isAllowedMediaUrl("https://cdninstagram.com.evil.com/a.jpg")).toBe(false);
    expect(isAllowedMediaUrl("blob:https://www.instagram.com/123")).toBe(false);
  });

  it("extrai shortcode de publicações e reels", () => {
    expect(shortcodeFromPath("/p/Cx1Ab2Z/")).toBe("Cx1Ab2Z");
    expect(shortcodeFromPath("/reel/DAbc_12-/")).toBe("DAbc_12-");
    expect(shortcodeFromPath("/fulano/p/Cx1Ab2Z/")).toBe("Cx1Ab2Z");
    expect(shortcodeFromPath("/fulano/")).toBeUndefined();
  });
});

describe("mensagens de erro", () => {
  it("traduz códigos do Chrome", () => {
    expect(friendlyDownloadError("NETWORK_FAILED")).toBe("Falha de rede. Verifique sua conexão.");
    expect(friendlyDownloadError("ALGO_NOVO")).toBe("Falha no download (ALGO_NOVO).");
  });
});
