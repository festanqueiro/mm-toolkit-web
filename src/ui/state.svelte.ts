/** App-wide reactive state: persisted settings and detected browser capabilities. */
import { detectCapabilities, type Capabilities } from "../engine/media/capabilities";
import { dbDelete } from "../storage/db";
import { loadSettings, saveSetting, SETTING_DEFAULTS, type SettingKey, type Settings, type Theme } from "../storage/settings";

export const app = $state({
  settings: { ...SETTING_DEFAULTS } as Settings,
  settingsLoaded: false,
  capabilities: null as Capabilities | null,
});

export function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

let initialising: Promise<void> | null = null;

/** Load settings and detect capabilities once per page load. */
export function initApp(): Promise<void> {
  initialising ??= (async () => {
    try {
      app.settings = await loadSettings();
    } catch {
      // Private mode / blocked storage: keep defaults, the app still works without persistence.
    }
    applyTheme(app.settings["web/theme"]);
    app.settingsLoaded = true;
    app.capabilities = await detectCapabilities();
  })();
  return initialising;
}

export async function updateSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  app.settings[key] = value;
  if (key === "web/theme") applyTheme(value as Theme);
  try {
    await saveSetting(key, $state.snapshot(value) as Settings[K]);
  } catch {
    // Persistence unavailable; the in-memory value still applies for this session.
  }
}

/** Remove stored values so the keys fall back to their defaults (desktop `settings.remove`). */
export async function resetSettings(keys: SettingKey[]): Promise<void> {
  for (const key of keys) {
    (app.settings as Record<SettingKey, unknown>)[key] = SETTING_DEFAULTS[key];
    try {
      await dbDelete("settings", key);
    } catch {
      // Persistence unavailable.
    }
  }
}
