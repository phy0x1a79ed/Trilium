import { describe, expect, it } from "vitest";

import { CHIP_PALETTE_SIZE, getChipColorProps, getChipPaletteIndex, parseChipColorOverrides } from "./chip_colors";

describe("Chip colors", () => {
    it("keeps a value on one palette slot and spreads different values over the palette", () => {
        const slot = getChipPaletteIndex("owner", "tony/altair/fix agent perms");
        expect(getChipPaletteIndex("owner", "tony/altair/fix agent perms")).toBe(slot);
        expect(getChipPaletteIndex("owner", "tony")).not.toBe(getChipPaletteIndex("project", "tony"));

        const slots = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const index = getChipPaletteIndex("project", `project-${i}`);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(CHIP_PALETTE_SIZE);
            slots.add(index);
        }
        expect(slots.size).toBe(CHIP_PALETTE_SIZE);
    });

    it("parses name:value=color entries and skips malformed ones", () => {
        const overrides = parseChipColorOverrides(
            "owner:tony/altair=#4a7; project:factorio=#c84;broken;owner:=red;:x=red;owner:bad=notacolor;note:a:b=c=rgb(1, 2, 3)"
        );

        expect(overrides.get("owner")?.get("tony/altair")).toBe("#4a7");
        expect(overrides.get("project")?.get("factorio")).toBe("#c84");
        expect(overrides.get("owner")?.has("bad")).toBe(false);
        expect(overrides.get("owner")?.size).toBe(1);
        expect(overrides.get("note")?.get("a:b=c")).toBe("rgb(1, 2, 3)");
        expect(parseChipColorOverrides(undefined).size).toBe(0);
        expect(parseChipColorOverrides("").size).toBe(0);
    });

    it("prefers an override, with a readable text color, over the palette", () => {
        const overrides = parseChipColorOverrides("owner:tony=#4a7;owner:dark=#102030");

        const light = getChipColorProps("owner", "tony", overrides);
        expect(light.className).toBe("chip-custom-color");
        expect(light.style).toEqual({ backgroundColor: "#4a7", color: "#000" });
        expect(getChipColorProps("owner", "dark", overrides).style?.color).toBe("#fff");

        const hashed = getChipColorProps("owner", "someone", overrides);
        expect(hashed.className).toBe(`chip-palette-${getChipPaletteIndex("owner", "someone")}`);
        expect(hashed.style).toBeUndefined();
    });
});
