type Attrs = Record<string, string | number | boolean | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

/** Cria elementos sem innerHTML, evitando injeção de conteúdo vindo da página. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") {
      el.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === "class") {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(name, "");
    } else {
      el.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export const ICONS = {
  download: "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z",
  retry:
    "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  folder: "M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z",
  image:
    "M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z",
  video:
    "M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z",
};

export function icon(path: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

/** Miniatura com fallback para ícone quando o CDN recusa ou o link expira. */
export function thumbnail(url: string | undefined, kind: "image" | "video", size = 28): HTMLElement {
  const wrap = h("span", { class: "thumb-img" });
  const placeholder = h("span", { class: "placeholder" }, icon(kind === "video" ? ICONS.video : ICONS.image, size));
  if (!url) {
    wrap.append(placeholder);
    return wrap;
  }
  const img = h("img", { src: url, alt: "", loading: "lazy", referrerpolicy: "no-referrer", decoding: "async" });
  img.addEventListener("error", () => img.replaceWith(placeholder), { once: true });
  wrap.append(img);
  return wrap;
}
