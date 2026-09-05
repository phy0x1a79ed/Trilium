import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getNextColorSchemeTheme, getStoredColorScheme, resolveColorScheme, setStoredColorScheme, withStoredColorScheme } from "./color_scheme.js";

describe("resolveColorScheme", () => {
    it("resolves each built-in theme to its family and scheme", () => {
        expect(resolveColorScheme("next")).toEqual({ family: "modern", scheme: "system", isCustom: false });
        expect(resolveColorScheme("next-light")).toEqual({ family: "modern", scheme: "light", isCustom: false });
        expect(resolveColorScheme("next-dark")).toEqual({ family: "modern", scheme: "dark", isCustom: false });
        expect(resolveColorScheme("auto")).toEqual({ family: "legacy", scheme: "system", isCustom: false });
        expect(resolveColorScheme("light")).toEqual({ family: "legacy", scheme: "light", isCustom: false });
        expect(resolveColorScheme("dark")).toEqual({ family: "legacy", scheme: "dark", isCustom: false });
    });

    it("treats unknown, empty and nullish themes as custom", () => {
        for (const theme of [ "my-theme", "", null, undefined ]) {
            expect(resolveColorScheme(theme)).toEqual({ family: null, scheme: "system", isCustom: true });
        }
    });
});

describe("getNextColorSchemeTheme", () => {
    it("cycles system → light → dark → system while keeping the family", () => {
        expect(getNextColorSchemeTheme("next")).toBe("next-light");
        expect(getNextColorSchemeTheme("next-light")).toBe("next-dark");
        expect(getNextColorSchemeTheme("next-dark")).toBe("next");

        expect(getNextColorSchemeTheme("auto")).toBe("light");
        expect(getNextColorSchemeTheme("light")).toBe("dark");
        expect(getNextColorSchemeTheme("dark")).toBe("auto");
    });

    it("returns null for a custom theme that cannot switch color scheme", () => {
        expect(getNextColorSchemeTheme("my-theme")).toBeNull();
        expect(getNextColorSchemeTheme(null)).toBeNull();
    });
});

describe("the per-browser store", () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => {
        // Restored first: a test that made the accessor throw would throw here too.
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it("keeps a scheme this browser chose and refuses anything else", () => {
        expect(getStoredColorScheme()).toBeNull();

        setStoredColorScheme("dark");
        expect(getStoredColorScheme()).toBe("dark");

        localStorage.setItem("trilium-color-scheme", "chartreuse");
        expect(getStoredColorScheme()).toBeNull();
    });

    it("answers as an unchosen browser would when the accessor itself throws", () => {
        // A browser set to block site data throws on the accessor rather than answering nothing.
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
            throw new Error("access denied");
        });

        expect(getStoredColorScheme()).toBeNull();
        expect(() => setStoredColorScheme("light")).not.toThrow();
        expect(withStoredColorScheme("next")).toBe("next");
    });

    it("substitutes the stored scheme into the configured theme, keeping its family", () => {
        expect(withStoredColorScheme("next")).toBe("next");

        setStoredColorScheme("dark");
        expect(withStoredColorScheme("next")).toBe("next-dark");
        expect(withStoredColorScheme("next-light")).toBe("next-dark");
        expect(withStoredColorScheme("auto")).toBe("dark");

        setStoredColorScheme("system");
        expect(withStoredColorScheme("next-dark")).toBe("next");
    });

    it("leaves a custom theme alone, which has no light and dark variants", () => {
        setStoredColorScheme("dark");
        expect(withStoredColorScheme("my-theme")).toBe("my-theme");
        expect(withStoredColorScheme(null)).toBe("");
    });
});
