// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { dashKeysOf, extractFromPayload } from "../src/content/extract";
import { resolveElement, storyMediaIdFromPath, STORY_UNAVAILABLE } from "../src/content/resolve";
import { MediaStore, SegmentLog } from "../src/content/store";
import { buildFilename } from "../src/shared/filename";
import type { MediaItem } from "../src/shared/types";

const cdn = (path: string) => `https://scontent.cdninstagram.com${path}`;
const manifest = (...paths: string[]) =>
  `<MPD><Period>${paths.map((p) => `<Representation><BaseURL>${cdn(p)}?a=1&amp;b=2</BaseURL></Representation>`).join("")}</Period></MPD>`;

function storyVideo(id: string, duration: number, dash: string[]): MediaItem {
  return {
    key: `/o1/${id}.mp4`,
    type: "video",
    url: cdn(`/o1/${id}.mp4`),
    mediaId: id,
    duration,
    dashKeys: dash,
    owner: "perfil",
    source: "network",
  };
}

/** Simula o <video> do story: transmitido em partes (blob:), sem capa. */
function blobVideo(duration: number): HTMLVideoElement {
  document.body.innerHTML = `<section><video></video></section>`;
  const video = document.querySelector("video")!;
  video.getBoundingClientRect = () => ({ width: 400, height: 700 }) as DOMRect;
  Object.defineProperty(video, "currentSrc", { value: "blob:https://www.instagram.com/x" });
  Object.defineProperty(video, "duration", { value: duration });
  return video;
}

function setPath(path: string) {
  window.history.replaceState(null, "", path);
}

describe("extração de stories", () => {
  it("guarda id, duração e arquivos DASH do vídeo", () => {
    const payload = {
      reels_media: [
        {
          id: "highlight:179",
          user: { username: "perfil" },
          items: [
            {
              pk: "3501",
              id: "3501_99",
              video_duration: 14.9,
              video_dash_manifest: manifest("/v/seg-video-1.mp4", "/v/seg-audio-1.mp4"),
              image_versions2: { candidates: [{ url: cdn("/v/capa1.jpg"), width: 720, height: 1280 }] },
              video_versions: [{ url: cdn("/o1/3501.mp4"), width: 720, height: 1280 }],
            },
          ],
        },
      ],
    };
    const [item] = extractFromPayload(payload);
    expect(item).toMatchObject({ type: "video", mediaId: "3501", duration: 14.9, owner: "perfil" });
    expect(item.dashKeys).toEqual(["/v/seg-video-1.mp4", "/v/seg-audio-1.mp4"]);
  });

  it("ignora manifestos sem arquivos válidos", () => {
    expect(dashKeysOf("<MPD/>")).toBeUndefined();
    expect(dashKeysOf(manifest().replace("<Period>", "<Period><BaseURL>https://evil.com/a.mp4</BaseURL>"))).toBeUndefined();
  });

  it("nomeia stories pelo id da mídia", () => {
    const name = buildFilename(storyVideo("3501", 10, []), { useSubfolders: true, position: 1 });
    expect(name).toBe("InstaFetch/perfil_story_3501/perfil_story_3501_01.mp4");
  });
});

describe("vídeo de story/destaque em partes", () => {
  const a = storyVideo("1001", 15.0, ["/v/a-video.mp4", "/v/a-audio.mp4"]);
  const b = storyVideo("1002", 8.2, ["/v/b-video.mp4", "/v/b-audio.mp4"]);
  const c = storyVideo("1003", 15.1, ["/v/c-video.mp4", "/v/c-audio.mp4"]);
  const store = new MediaStore();
  store.add([a, b, c]);

  it("identifica pela duração quando ela é única", () => {
    setPath("/stories/highlights/179/");
    expect(resolveElement(blobVideo(8.21), store)?.mediaId).toBe("1002");
  });

  it("desempata durações parecidas pelos pedaços que o player baixou", () => {
    setPath("/stories/highlights/179/");
    const segments = new SegmentLog();
    segments.add("/v/a-video.mp4");
    segments.add("/v/c-audio.mp4"); // o mais recente pertence ao vídeo C
    expect(resolveElement(blobVideo(15.05), store, document, segments)?.mediaId).toBe("1003");
  });

  it("sem duração conhecida usa o pedaço mais recente", () => {
    setPath("/stories/highlights/179/");
    const segments = new SegmentLog();
    segments.add("/v/b-video.mp4");
    expect(resolveElement(blobVideo(Number.NaN), store, document, segments)?.mediaId).toBe("1002");
  });

  it("usa o id do story na URL /stories/<usuario>/<id>/", () => {
    setPath("/stories/perfil/1003/");
    expect(resolveElement(blobVideo(Number.NaN), store)?.mediaId).toBe("1003");
    expect(storyMediaIdFromPath("/stories/highlights/179/")).toBeUndefined();
  });

  it("explica o problema quando não há como identificar", () => {
    setPath("/stories/highlights/179/");
    const item = resolveElement(blobVideo(Number.NaN), store, document, new SegmentLog());
    expect(item?.unavailableReason).toBe(STORY_UNAVAILABLE);
  });
});

describe("SegmentLog", () => {
  it("mantém os mais recentes primeiro, sem repetir", () => {
    const log = new SegmentLog(3);
    ["/a", "/b", "/a", "/c", "/d"].forEach((k) => log.add(k));
    expect(log.recent()).toEqual(["/d", "/c", "/a"]);
  });
});
