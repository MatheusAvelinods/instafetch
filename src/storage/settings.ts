import { DEFAULT_SETTINGS, MAX_CONCURRENCY, RESOLUTION_OPTIONS, type Settings } from "../shared/types";

export const SETTINGS_KEY = "settings";

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  return {
    concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(Number(merged.concurrency)) || 1)),
    useSubfolders: Boolean(merged.useSubfolders),
    showOverlay: Boolean(merged.showOverlay),
    minResolution: (RESOLUTION_OPTIONS as readonly number[]).includes(Number(merged.minResolution))
      ? Number(merged.minResolution)
      : 0,
  };
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}
