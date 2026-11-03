import { z } from "zod";

const themeSchema = z.enum(["system", "light", "dark"]);
const viewModeSchema = z.enum(["single", "all"]);
const diffStyleSchema = z.enum(["unified", "split"]);

/** Reads saved choices leniently: a missing or unknown value falls back to its default on its own. */
export const savedPreferencesSchema = z.object({
  theme: themeSchema.catch("system"),
  viewMode: viewModeSchema.catch("single"),
  diffStyle: diffStyleSchema.catch("unified"),
});

export const preferenceChangeSchema = z.object({
  theme: themeSchema,
  viewMode: viewModeSchema,
  diffStyle: diffStyleSchema,
}).partial().strict();

export type Preferences = z.infer<typeof savedPreferencesSchema>;
export type PreferenceChange = z.infer<typeof preferenceChangeSchema>;
export type ThemePreference = Preferences["theme"];

export const defaultPreferences: Preferences = savedPreferencesSchema.parse({});

export function parseSavedPreferences(value: unknown): Preferences {
  const parsed = savedPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultPreferences;
}

export interface PreferenceStore {
  read(): Promise<Preferences>;
  update(change: PreferenceChange): Promise<Preferences>;
}
