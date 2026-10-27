import { DEFAULT_SETTINGS, MAX_CONCURRENCY, type Settings } from "../shared/types";

const KEY = "settings";

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  return {
    concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(Number(merged.concurrency)) || 1)),
    useSubfolders: Boolean(merged.useSubfolders),
  };
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(KEY);
  return normalizeSettings(data[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: settings });
  return settings;
}
