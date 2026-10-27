import { describe, expect, it, vi } from "vitest";
import { DownloadQueue, type DownloadAdapter } from "../src/downloads/queue";
import type { MediaItem } from "../src/shared/types";

function media(n: number, extra: Partial<MediaItem> = {}): MediaItem {
  return {
    key: `/v/t51/${n}_n.jpg`,
    type: "image",
    url: `https://scontent.cdninstagram.com/v/t51/${n}_n.jpg?sig=x`,
    shortcode: "ABC123",
    owner: "fulano",
    source: "network",
    ...extra,
  };
}

/** Adaptador falso: cada start devolve um id; o teste controla o resultado. */
function fakeAdapter() {
  let nextId = 100;
  const started: { url: string; filename: string; id: number }[] = [];
  const adapter: DownloadAdapter = {
    start: vi.fn(async (url: string, filename: string) => {
      const id = nextId++;
      started.push({ url, filename, id });
      return id;
    }),
    cancel: vi.fn(async () => undefined),
  };
  return { adapter, started };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
let idCounter = 0;
const createId = () => `id${idCounter++}`;

describe("DownloadQueue", () => {
  it("respeita o limite de concorrência", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 2, useSubfolders: true, createId });
    queue.enqueue([media(1), media(2), media(3), media(4)]);
    await flush();

    expect(started).toHaveLength(2);
    expect(queue.list().map((j) => j.status)).toEqual(["downloading", "downloading", "waiting", "waiting"]);

    queue.handleChange(started[0].id, { state: "complete" });
    await flush();
    expect(started).toHaveLength(3);
    expect(queue.list()[0].status).toBe("completed");
  });

  it("gera nomes descritivos dentro de subpasta", () => {
    const { adapter } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: true, createId });
    const [a, b] = queue.enqueue([media(1, { index: 1 }), media(2, { index: 2, type: "video", url: "https://x.cdninstagram.com/v/2.mp4" })]);
    expect(a.filename).toBe("InstaFetch/fulano_ABC123/fulano_ABC123_01.jpg");
    expect(b.filename).toBe("InstaFetch/fulano_ABC123/fulano_ABC123_02.mp4");
  });

  it("uma falha não interrompe o lote e preserva os concluídos", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 3, useSubfolders: false, createId });
    queue.enqueue([media(1), media(2), media(3)]);
    await flush();

    queue.handleChange(started[0].id, { state: "complete" });
    queue.handleChange(started[1].id, { state: "interrupted", error: "SERVER_FORBIDDEN" });
    queue.handleChange(started[2].id, { state: "complete" });

    const jobs = queue.list();
    expect(jobs.map((j) => j.status)).toEqual(["completed", "failed", "completed"]);
    expect(jobs[1].error).toMatch(/expirado/);
  });

  it("permite tentar novamente um download com falha", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    const [job] = queue.enqueue([media(1)]);
    await flush();
    queue.handleChange(started[0].id, { state: "interrupted", error: "NETWORK_FAILED" });
    expect(queue.list()[0].status).toBe("failed");

    queue.retry(job.id);
    await flush();
    expect(started).toHaveLength(2);
    const retried = queue.list()[0];
    expect(retried.status).toBe("downloading");
    expect(retried.attempts).toBe(2);
    expect(retried.error).toBeUndefined();
  });

  it("cancela itens aguardando e em andamento", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    const [first, second] = queue.enqueue([media(1), media(2)]);
    await flush();

    queue.cancel(second.id);
    expect(queue.list()[1].status).toBe("cancelled");

    queue.cancel(first.id);
    expect(adapter.cancel).toHaveBeenCalledWith(started[0].id);
    expect(queue.list()[0].status).toBe("cancelled");
    // O evento USER_CANCELED posterior não altera o estado.
    queue.handleChange(started[0].id, { state: "interrupted", error: "USER_CANCELED" });
    expect(queue.list()[0].status).toBe("cancelled");
    await flush();
    expect(started).toHaveLength(1);
  });

  it("cancelar tudo não inicia os itens que estavam aguardando", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    queue.enqueue([media(1), media(2), media(3)]);
    await flush();
    queue.cancelAll();
    await flush();
    expect(started).toHaveLength(1);
    expect(queue.list().every((j) => j.status === "cancelled")).toBe(true);
  });

  it("não duplica mídias que já estão na fila", () => {
    const { adapter } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    queue.enqueue([media(1), media(2)]);
    const added = queue.enqueue([media(2), media(3)]);
    expect(added).toHaveLength(1);
    expect(queue.list()).toHaveLength(3);
  });

  it("aplica eventos que chegam antes do id do download", async () => {
    let resolveStart!: (id: number) => void;
    const adapter: DownloadAdapter = {
      start: () => new Promise((r) => (resolveStart = r)),
      cancel: async () => undefined,
    };
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    queue.enqueue([media(1)]);
    queue.handleChange(7, { state: "complete" });
    resolveStart(7);
    await flush();
    expect(queue.list()[0].status).toBe("completed");
  });

  it("marca como falha quando o Chrome recusa iniciar", async () => {
    const adapter: DownloadAdapter = {
      start: async () => {
        throw new Error("Invalid URL");
      },
      cancel: async () => undefined,
    };
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    queue.enqueue([media(1), media(2)]);
    await flush();
    await flush();
    expect(queue.list().map((j) => j.status)).toEqual(["failed", "failed"]);
    expect(queue.list()[0].error).toBe("Link inválido para download.");
  });

  it("registra mídias indisponíveis como falha sem tentar baixar", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId });
    queue.enqueue([media(1, { unavailableReason: "streaming" })]);
    await flush();
    expect(started).toHaveLength(0);
    expect(queue.list()[0]).toMatchObject({ status: "failed", error: "streaming" });
  });

  it("restaura a fila e reinicia inícios perdidos", async () => {
    const { adapter, started } = fakeAdapter();
    const queue = new DownloadQueue(adapter, { concurrency: 2, useSubfolders: false, createId });
    queue.restore([
      { id: "a", batchId: "b", media: media(1), filename: "a.jpg", status: "downloading", attempts: 1, createdAt: 0 },
      { id: "c", batchId: "b", media: media(2), filename: "c.jpg", status: "downloading", downloadId: 55, attempts: 1, createdAt: 0 },
    ]);
    await flush();
    expect(started).toHaveLength(1);
    queue.handleChange(55, { state: "complete" });
    expect(queue.list().find((j) => j.id === "c")?.status).toBe("completed");
  });

  it("chama onCompleted para alimentar o histórico", async () => {
    const { adapter, started } = fakeAdapter();
    const onCompleted = vi.fn();
    const queue = new DownloadQueue(adapter, { concurrency: 1, useSubfolders: false, createId, onCompleted });
    queue.enqueue([media(1)]);
    await flush();
    queue.handleChange(started[0].id, { state: "complete" });
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onCompleted.mock.calls[0][0].downloadId).toBe(started[0].id);
  });
});
