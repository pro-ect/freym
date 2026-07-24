/**
 * Mirrors whether the Imagine/Copy Shot tab currently has a reference photo
 * attached. The app-level clipboard watcher reads this to avoid clobbering a
 * photo the user already chose — clipboard auto-paste only fills an empty
 * slot. Plain module-scope ref (no context) because the watcher lives in the
 * tabs layout, outside the Imagine screen's tree.
 */
export const imagineHasRefPhoto = { current: false };
