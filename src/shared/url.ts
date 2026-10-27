const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net"];

/** Aceita apenas mídias servidas por HTTPS a partir dos CDNs do Instagram/Meta. */
export function isAllowedMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * O mesmo arquivo aparece em vários tamanhos com o mesmo caminho e parâmetros
 * diferentes na query (ex.: stp=dst-jpg_p640x640), então o caminho identifica a mídia.
 */
export function mediaKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "blob:") return url;
    return parsed.pathname;
  } catch {
    return url;
  }
}

/** Extrai o shortcode de caminhos como /p/ABC123/, /reel/ABC123/ ou /usuario/p/ABC123/. */
export function shortcodeFromPath(path: string): string | undefined {
  const match = path.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
  return match?.[1];
}
