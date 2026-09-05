/**
 * Light, dark, or following the operating system — and where that choice is kept.
 *
 * Preferences in Trilium are synced options; this one is deliberately not, on the maintainer's
 * instruction: light and dark belong to the browser looking at the vault, not to the vault, so two
 * browsers pointed at one server can disagree. The `theme` option still owns the theme family and
 * the scheme a browser that has never chosen starts on.
 */

export type ColorScheme = "system" | "light" | "dark";

/** Order the color-scheme switcher cycles through on each click. */
export const COLOR_SCHEME_CYCLE: readonly ColorScheme[] = [ "system", "light", "dark" ];

/** Maps each theme family and color scheme to the concrete `theme` option value. */
export const THEME_FAMILY_SCHEMES: Record<string, Record<ColorScheme, string>> = {
    modern: { system: "next", light: "next-light", dark: "next-dark" },
    legacy: { system: "auto", light: "light", dark: "dark" }
};

export interface ResolvedColorScheme {
    /** The theme family key, or `null` for a custom theme that has no color-scheme variants. */
    family: string | null;
    scheme: ColorScheme;
    isCustom: boolean;
}

export function resolveColorScheme(theme: string | null | undefined): ResolvedColorScheme {
    for (const [ family, schemes ] of Object.entries(THEME_FAMILY_SCHEMES)) {
        for (const [ scheme, value ] of Object.entries(schemes)) {
            if (value === theme) {
                return { family, scheme: scheme as ColorScheme, isCustom: false };
            }
        }
    }
    return { family: null, scheme: "system", isCustom: true };
}

/**
 * Returns the `theme` value for the next color scheme in the cycle, keeping the current family.
 * Returns `null` when the theme is custom and therefore has no color-scheme variants to cycle through.
 */
export function getNextColorSchemeTheme(theme: string | null | undefined): string | null {
    const { family, scheme } = resolveColorScheme(theme);
    if (!family) {
        return null;
    }
    const nextScheme = COLOR_SCHEME_CYCLE[(COLOR_SCHEME_CYCLE.indexOf(scheme) + 1) % COLOR_SCHEME_CYCLE.length];
    return THEME_FAMILY_SCHEMES[family][nextScheme];
}

/** Where this browser keeps its colour scheme. Absent means it has never chosen one. */
const STORED_SCHEME_KEY = "trilium-color-scheme";

/**
 * The colour scheme this browser has chosen, or `null` when it has none.
 *
 * A private window, cleared site data or a browser set to block storage throws on the accessor
 * itself rather than answering nothing, so every read and write here is guarded.
 */
export function getStoredColorScheme(): ColorScheme | null {
    try {
        const stored = localStorage.getItem(STORED_SCHEME_KEY);
        return COLOR_SCHEME_CYCLE.includes(stored as ColorScheme) ? (stored as ColorScheme) : null;
    } catch {
        return null;
    }
}

export function setStoredColorScheme(scheme: ColorScheme) {
    try {
        localStorage.setItem(STORED_SCHEME_KEY, scheme);
    } catch {
        // A browser that refuses to store keeps rendering the scheme the `theme` option names.
    }
}

/**
 * The theme this browser should render: the configured one, with its colour scheme replaced by the
 * stored choice. A custom theme has no light and dark variants, so it is returned as it stands.
 */
export function withStoredColorScheme(theme: string | null | undefined): string {
    const stored = getStoredColorScheme();
    const { family } = resolveColorScheme(theme);
    if (!stored || !family) {
        return theme ?? "";
    }
    return THEME_FAMILY_SCHEMES[family][stored];
}
