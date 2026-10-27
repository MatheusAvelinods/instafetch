import type { MediaItem } from "./types";

const KNOWN_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "gif", "mp4", "mov", "webm", "m4v"];

/** Remove caracteres inválidos em nomes de arquivo no Windows/macOS/Linux. */
export function sanitize(part: string, maxLength = 60): string {
  const cleaned = part
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/^[.\s_]+|[.\s_]+$/g, "")
    .slice(0, maxLength);
  return cleaned || "midia";
}

export function extensionFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const match = path.match(/\.([a-z0-9]{2,5})$/);
    if (match && KNOWN_EXTENSIONS.includes(match[1])) {
      return match[1] === "jpeg" ? "jpg" : match[1];
    }
  } catch {
    // URL inválida: usa a extensão padrão
  }
  return fallback;
}

function timestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Gera um caminho relativo à pasta de downloads, por exemplo:
 * InstaFetch/fulano_Cx1Ab2/fulano_Cx1Ab2_02.jpg
 */
export function buildFilename(
  media: MediaItem,
  options: { useSubfolders: boolean; position: number; now?: Date },
): string {
  const ext = extensionFromUrl(media.url, media.type === "video" ? "mp4" : "jpg");
  const owner = media.owner ? sanitize(media.owner, 30) : undefined;
  const post = media.shortcode ? sanitize(media.shortcode, 30) : undefined;

  const base =
    [owner, post].filter(Boolean).join("_") || `instagram_${timestamp(options.now ?? new Date())}`;
  const index = String(media.index ?? options.position).padStart(2, "0");
  const name = `${base}_${index}.${ext}`;

  if (!options.useSubfolders) return name;
  return `InstaFetch/${base}/${name}`;
}
