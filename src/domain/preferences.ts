import { z } from "zod";

const themeSchema = z.enum(["system", "light", "dark"]);
const viewModeSchema = z.enum(["single", "all"]);
const diffStyleSchema = z.enum(["unified", "split"]);
/** Pull request URLs whose briefing the reviewer collapsed; only the most recent ones are kept. */
export const maximumCollapsedBriefings = 50;
const collapsedBriefingsSchema = z.array(z.string().min(1).max(500)).max(maximumCollapsedBriefings);

/** Reads saved choices leniently: a missing or unknown value falls back to its default on its own. */
export const savedPreferencesSchema = z.object({
  theme: themeSchema.catch("system"),
  viewMode: viewModeSchema.catch("single"),
  diffStyle: diffStyleSchema.catch("unified"),
  collapsedBriefings: collapsedBriefingsSchema.catch([]),
});

export const preferenceChangeSchema = z.object({
  theme: themeSchema,
  viewMode: viewModeSchema,
  diffStyle: diffStyleSchema,
  collapsedBriefings: collapsedBriefingsSchema,
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
