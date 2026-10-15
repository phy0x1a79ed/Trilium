import Color from "color";
import type { CSSProperties } from "preact";

/** Number of `chip-palette-N` classes in `UserAttributesList.css`. */
export const CHIP_PALETTE_SIZE = 12;

/**
 * Explicit chip colours, keyed by label name and then by label value. The map is read from a
 * collection note's `#board:chipColors` label.
 */
export type ChipColorOverrides = ReadonlyMap<string, ReadonlyMap<string, string>>;

export const NO_CHIP_COLOR_OVERRIDES: ChipColorOverrides = new Map();

/**
 * Parses the `#board:chipColors` label.
 *
 * The value is a `;`-separated list of `name:value=color` entries, for example
 * `owner:tony/altair=#4a7;project:factorio=#c84`. The label name ends at the first `:`, the color
 * starts after the last `=`, and everything between is the label value, so a value can contain
 * `:` and `=` but not `;`. Entries with an empty name or value, or a color that CSS Color cannot
 * parse, are skipped.
 */
export function parseChipColorOverrides(source: string | null | undefined): ChipColorOverrides {
    const overrides = new Map<string, Map<string, string>>();

    for (const entry of (source ?? "").split(";")) {
        const equalsIndex = entry.lastIndexOf("=");
        const colonIndex = entry.indexOf(":");
        if (equalsIndex < 0 || colonIndex < 0 || colonIndex > equalsIndex) continue;

        const name = entry.slice(0, colonIndex).trim();
        const value = entry.slice(colonIndex + 1, equalsIndex).trim();
        const color = entry.slice(equalsIndex + 1).trim();
        if (!name || !value || !isParsableColor(color)) continue;

        const byValue = overrides.get(name) ?? new Map<string, string>();
        byValue.set(value, color);
        overrides.set(name, byValue);
    }

    return overrides;
}

/** Maps a label name and value to a palette slot with a 32-bit FNV-1a hash, so a value keeps its slot across sessions. */
export function getChipPaletteIndex(name: string, value: string) {
    let hash = 0x811c9dc5;
    for (const char of `${name}\u0000${value}`) {
        hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
    }
    return (hash >>> 0) % CHIP_PALETTE_SIZE;
}

/**
 * Picks the class or inline color for a chip: the override when one matches, otherwise the hashed
 * palette slot. The palette follows the theme in CSS; an override is a literal color, so it gets a
 * readable text color computed from it.
 */
export function getChipColorProps(name: string, value: string, overrides: ChipColorOverrides): { className: string, style?: CSSProperties } {
    const override = overrides.get(name)?.get(value);
    if (override) {
        const isLight = Color(override.toLowerCase()).isLight();
        return {
            className: "chip-custom-color",
            style: { backgroundColor: override, color: isLight ? "#000" : "#fff" }
        };
    }
    return { className: `chip-palette-${getChipPaletteIndex(name, value)}` };
}

function isParsableColor(color: string) {
    try {
        Color(color.toLowerCase());
        return true;
    } catch {
        return false;
    }
}
