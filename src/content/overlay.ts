/**
 * Botões de download desenhados sobre as mídias do Instagram.
 *
 * Os botões ficam numa camada própria (Shadow DOM, fora da árvore do React do
 * Instagram), posicionada sobre cada mídia. Assim a página não é alterada, os
 * estilos não se misturam e cliques no botão não abrem a publicação.
 * Em carrosséis, só o slide visível recebe botão: os vizinhos ficam recortados
 * pelo contêiner com overflow e são ignorados.
 */
import type { MediaItem } from "../shared/types";
import type { EnqueueResponse, JobStatusSummary } from "../shared/messages";

export interface OverlayDeps {
  /** Mídia (na melhor resolução conhecida) que o elemento representa. */
  resolve(el: HTMLImageElement | HTMLVideoElement): MediaItem | undefined;
  enqueue(item: MediaItem): Promise<EnqueueResponse>;
  status(jobIds: string[]): Promise<JobStatusSummary[]>;
}

type ButtonState = "idle" | "busy" | "done" | "error";

interface Tracked {
  el: HTMLImageElement | HTMLVideoElement;
  wrap: HTMLDivElement;
  button: HTMLButtonElement;
  label: HTMLSpanElement;
  /** Ancestrais com overflow que recortam a mídia (ex.: trilho do carrossel). */
  clips: Element[];
  state: ButtonState;
  jobId?: string;
  resetTimer?: number;
}

const MIN_VISIBLE_SIDE = 64;
/** Fração mínima visível dentro do recorte (slides vizinhos do carrossel ficam abaixo). */
const MIN_VISIBLE_FRACTION = 0.55;
const INSET = 8;
const BUTTON_SIZE = 34;
const ANIMATION_WINDOW_MS = 900;
const POLL_MS = 600;
const MAX_CLIP_DEPTH = 15;

const ICON_DOWNLOAD = "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z";
const ICON_CHECK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
const ICON_ALERT = "M11 15h2v2h-2zm0-8h2v6h-2zm1-5C6.47 2 2 6.5 2 12a10 10 0 1 0 10-10z";

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.wrap {
  position: absolute; top: 0; left: 0;
  display: flex; align-items: center; gap: 6px;
  will-change: transform;
}
.wrap[hidden] { display: none; }
button {
  all: unset;
  pointer-events: auto;
  box-sizing: border-box;
  width: 34px; height: 34px;
  display: grid; place-items: center;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(6px);
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.35);
  opacity: 0.85;
  transition: opacity .15s, transform .15s, background .15s;
  position: relative;
}
button:hover, button:focus-visible { opacity: 1; transform: scale(1.08); background: linear-gradient(135deg, #d6246e, #f56040); }
button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
button svg { width: 18px; height: 18px; position: relative; }
button[data-state="busy"]::before {
  content: ""; position: absolute; inset: 2px; border-radius: 50%;
  background: conic-gradient(#fff calc(var(--p, 15) * 1%), rgb(255 255 255 / 0.25) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
}
button[data-state="busy"][data-indeterminate]::before { animation: spin 0.9s linear infinite; --p: 30; }
button[data-state="done"] { background: #1f9d55; opacity: 1; }
button[data-state="error"] { background: #d33a3a; opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
.label {
  pointer-events: none;
  max-width: 240px;
  padding: 5px 9px;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.78);
  color: #fff;
  font: 500 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity .15s, transform .15s;
  white-space: normal;
}
.wrap:hover .label, .label.show { opacity: 1; transform: none; }
`;

function svgIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

export function describe(item: MediaItem): string {
  const kind = item.type === "video" ? "vídeo" : "foto";
  const size = item.width && item.height ? ` · ${item.width}×${item.height}` : "";
  const position = item.index ? ` · item ${item.index}` : "";
  return `Baixar ${kind}${size}${position}`;
}

/** Ancestrais que recortam o conteúdo (overflow diferente de visible). */
export function clippingAncestors(el: Element): Element[] {
  const clips: Element[] = [];
  let node = el.parentElement;
  for (let depth = 0; node && depth < MAX_CLIP_DEPTH; depth++, node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") clips.push(node);
  }
  return clips;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Área visível de um elemento: recortada pelos ancestrais com overflow e pela
 * janela. Devolve null quando a mídia está escondida (ex.: slide fora de vista).
 */
export function visibleBox(rect: Box, clipRects: Box[], viewport: Box): Box | null {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width < MIN_VISIBLE_SIDE || height < MIN_VISIBLE_SIDE) return null;

  // Cópia campo a campo: num DOMRect os valores ficam no protótipo e o spread devolveria {}.
  const box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  for (const clip of clipRects) {
    box.left = Math.max(box.left, clip.left);
    box.top = Math.max(box.top, clip.top);
    box.right = Math.min(box.right, clip.right);
    box.bottom = Math.min(box.bottom, clip.bottom);
  }
  const clippedArea = Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
  if (clippedArea < width * height * MIN_VISIBLE_FRACTION) return null;

  box.left = Math.max(box.left, viewport.left);
  box.top = Math.max(box.top, viewport.top);
  box.right = Math.min(box.right, viewport.right);
  box.bottom = Math.min(box.bottom, viewport.bottom);
  if (box.right - box.left < MIN_VISIBLE_SIDE || box.bottom - box.top < MIN_VISIBLE_SIDE) return null;
  return box;
}

/** Até quantos níveis acima da mídia procurar o contêiner que ela compartilha com camadas da própria mídia. */
const MAX_OWNER_DEPTH = 6;
/** O contêiner comum não pode ser muito maior que a mídia (senão é a página, um modal etc.). */
const MAX_OWNER_AREA_RATIO = 2.5;

/**
 * Diz se o elemento no topo de um ponto da tela pertence à mídia: ela mesma,
 * algo dentro dela, ou uma camada irmã do mesmo bloco (o Instagram cobre fotos
 * e vídeos com divs transparentes e controles). Uma janela aberta por cima,
 * o fundo escurecido de um modal ou outro post não passam nesse teste.
 */
export function hitBelongsToMedia(hit: Element | null, media: Element): boolean {
  if (!hit) return false;
  if (hit === media || media.contains(hit)) return true;
  const mediaRect = media.getBoundingClientRect();
  const mediaArea = Math.max(1, mediaRect.width * mediaRect.height);
  let node = media.parentElement;
  for (let depth = 0; node && depth < MAX_OWNER_DEPTH; depth++, node = node.parentElement) {
    const rect = node.getBoundingClientRect();
    if (rect.width * rect.height > mediaArea * MAX_OWNER_AREA_RATIO) return false;
    if (node.contains(hit)) return true;
  }
  return false;
}

export class MediaOverlay {
  private host?: HTMLElement;
  private layer?: HTMLDivElement;
  private tracked = new Map<Element, Tracked>();
  private enabled = false;
  private frame?: number;
  private animateUntil = 0;
  private readonly onActivity = () => this.schedule();

  constructor(private readonly deps: OverlayDeps) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.mount();
    } else {
      this.unmount();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Atualiza a lista de mídias acompanhadas (chamado após varrer o DOM). */
  sync(elements: (HTMLImageElement | HTMLVideoElement)[]): void {
    if (!this.enabled || !this.layer) return;
    const current = new Set<Element>(elements);
    for (const [el, t] of this.tracked) {
      if (!current.has(el) || !el.isConnected) {
        clearTimeout(t.resetTimer);
        t.wrap.remove();
        this.tracked.delete(el);
      }
    }
    for (const el of elements) {
      if (this.tracked.has(el)) continue;
      this.tracked.set(el, this.createButton(el));
    }
    this.schedule();
  }

  private mount(): void {
    if (this.host) return;
    this.host = document.createElement("instafetch-overlay");
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    this.layer = document.createElement("div");
    this.layer.className = "layer";
    root.append(style, this.layer);
    document.documentElement.append(this.host);

    window.addEventListener("scroll", this.onActivity, { capture: true, passive: true });
    window.addEventListener("resize", this.onActivity, { passive: true });
    // Navegação no carrossel anima o trilho sem disparar scroll.
    for (const type of ["click", "keydown", "pointerup", "transitionend", "wheel"]) {
      document.addEventListener(type, this.onActivity, { capture: true, passive: true });
    }
  }

  private unmount(): void {
    window.removeEventListener("scroll", this.onActivity, { capture: true });
    window.removeEventListener("resize", this.onActivity);
    for (const type of ["click", "keydown", "pointerup", "transitionend", "wheel"]) {
      document.removeEventListener(type, this.onActivity, { capture: true });
    }
    for (const t of this.tracked.values()) clearTimeout(t.resetTimer);
    this.tracked.clear();
    this.host?.remove();
    this.host = undefined;
    this.layer = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private createButton(el: HTMLImageElement | HTMLVideoElement): Tracked {
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.hidden = true;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.state = "idle";
    button.setAttribute("aria-label", "Baixar com InstaFetch");
    button.append(svgIcon(ICON_DOWNLOAD));
    const label = document.createElement("span");
    label.className = "label";
    wrap.append(button, label);
    this.layer!.append(wrap);

    const tracked: Tracked = { el, wrap, button, label, clips: clippingAncestors(el), state: "idle" };

    wrap.addEventListener("mouseenter", () => {
      if (tracked.state !== "idle") return;
      const item = this.deps.resolve(el);
      label.textContent = item?.unavailableReason ? "Vídeo indisponível para download" : item ? describe(item) : "Baixar";
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.download(tracked);
    });
    return tracked;
  }

  private setState(t: Tracked, state: ButtonState, text: string, options: { percent?: number; flash?: boolean } = {}): void {
    t.state = state;
    t.button.dataset.state = state;
    t.button.replaceChildren(svgIcon(state === "done" ? ICON_CHECK : state === "error" ? ICON_ALERT : ICON_DOWNLOAD));
    if (options.percent === undefined) {
      t.button.setAttribute("data-indeterminate", "");
      t.button.style.removeProperty("--p");
    } else {
      t.button.removeAttribute("data-indeterminate");
      t.button.style.setProperty("--p", String(options.percent));
    }
    t.button.setAttribute("aria-label", text);
    t.label.textContent = text;
    t.label.classList.toggle("show", !!options.flash);

    clearTimeout(t.resetTimer);
    if (state === "done" || state === "error") {
      // Volta ao normal depois de um tempo; um novo clique baixa de novo.
      t.resetTimer = window.setTimeout(() => this.setState(t, "idle", "Baixar"), state === "done" ? 4000 : 7000);
    }
  }

  private async download(t: Tracked): Promise<void> {
    if (t.state === "busy") return;
    const item = this.deps.resolve(t.el);
    if (!item) {
      this.setState(t, "error", "Não foi possível identificar esta mídia.", { flash: true });
      return;
    }
    if (item.unavailableReason) {
      this.setState(t, "error", item.unavailableReason, { flash: true });
      return;
    }

    this.setState(t, "busy", "Adicionando à fila…", { flash: true });
    try {
      const response = await this.deps.enqueue(item);
      const jobId = response?.jobIds?.[0];
      if (!response?.ok || !jobId) throw new Error(response?.error ?? "sem resposta");
      t.jobId = jobId;
      await this.poll(t, jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const text = /context invalidated|Receiving end/i.test(message)
        ? "A extensão foi atualizada. Recarregue a página."
        : "Não foi possível iniciar o download.";
      this.setState(t, "error", text, { flash: true });
    }
  }

  private async poll(t: Tracked, jobId: string): Promise<void> {
    while (t.jobId === jobId && this.tracked.get(t.el) === t) {
      const [job] = await this.deps.status([jobId]);
      if (!job) return this.setState(t, "idle", "Baixar");
      switch (job.status) {
        case "completed":
          return this.setState(t, "done", "Baixado", { flash: true });
        case "failed":
          return this.setState(t, "error", job.error ?? "Falha no download.", { flash: true });
        case "cancelled":
          return this.setState(t, "idle", "Baixar");
        case "waiting":
          this.setState(t, "busy", "Na fila…");
          break;
        case "downloading":
          this.setState(t, "busy", job.percent !== undefined ? `Baixando ${job.percent}%` : "Baixando…", {
            percent: job.percent,
          });
          break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /**
   * Confere se a mídia é o que está visível onde o botão ficaria e no centro da
   * área visível. Evita botões de posts da grade aparecendo por cima de uma
   * publicação aberta, de menus ou de outras janelas.
   */
  private isOnTop(el: Element, box: Box): boolean {
    const points = [
      [box.left + INSET + BUTTON_SIZE / 2, box.top + INSET + BUTTON_SIZE / 2],
      [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
    ];
    return points.every(([x, y]) => {
      // Ignora a própria camada de botões, que fica acima de tudo.
      const hit = document.elementsFromPoint(x, y).find((node) => node !== this.host) ?? null;
      return hitBelongsToMedia(hit, el);
    });
  }

  /** Reposiciona os botões a cada quadro durante rolagens e animações. */
  schedule(): void {
    if (!this.enabled) return;
    this.animateUntil = performance.now() + ANIMATION_WINDOW_MS;
    if (this.frame === undefined) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frame = undefined;
    this.position();
    if (now < this.animateUntil) this.frame = requestAnimationFrame(this.tick);
  };

  private position(): void {
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const placed: { left: number; top: number }[] = [];
    // Vídeos primeiro: quando há capa + vídeo no mesmo lugar, fica o botão do vídeo.
    const entries = [...this.tracked.values()].sort(
      (a, b) => Number(b.el instanceof HTMLVideoElement) - Number(a.el instanceof HTMLVideoElement),
    );

    for (const t of entries) {
      let box: Box | null = null;
      if (t.el.isConnected) {
        const style = getComputedStyle(t.el);
        if (style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05) {
          box = visibleBox(
            t.el.getBoundingClientRect(),
            t.clips.map((c) => c.getBoundingClientRect()),
            viewport,
          );
        }
      }
      const overlaps =
        box && placed.some((p) => Math.abs(p.left - box!.left) < 12 && Math.abs(p.top - box!.top) < 12);
      if (box && !overlaps && !this.isOnTop(t.el, box)) box = null;
      if (!box || overlaps) {
        t.wrap.hidden = true;
        continue;
      }
      placed.push({ left: box.left, top: box.top });
      t.wrap.hidden = false;
      t.wrap.style.transform = `translate(${Math.round(box.left + INSET)}px, ${Math.round(box.top + INSET)}px)`;
    }
  }
}
