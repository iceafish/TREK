/**
 * The default categories the server seeds (server/src/db/seeds.ts) store as
 * English proper names in the DB, so any UI printing them verbatim shows
 * English strings in a translated app. Built-in names map to translation keys
 * (shared/src/i18n per-locale categories.ts, key prefix `categories.builtin.`); user-created or
 * renamed categories fall through to their stored name. Keep the keys in sync
 * with the seed list — a renamed seed there must be renamed here.
 */
const BUILTIN_CATEGORY_KEYS: Record<string, string> = {
  Hotel: 'categories.builtin.hotel',
  Restaurant: 'categories.builtin.restaurant',
  Attraction: 'categories.builtin.attraction',
  Shopping: 'categories.builtin.shopping',
  Transport: 'categories.builtin.transport',
  Activity: 'categories.builtin.activity',
  'Bar/Cafe': 'categories.builtin.barcafe',
  Beach: 'categories.builtin.beach',
  Nature: 'categories.builtin.nature',
  Other: 'categories.builtin.other',
}

/** Display label for a category: translated when it is a built-in, else as-is. */
export function categoryLabel(name: string | null | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!name) return ''
  const key = BUILTIN_CATEGORY_KEYS[name]
  return key ? t(key) : name
}
