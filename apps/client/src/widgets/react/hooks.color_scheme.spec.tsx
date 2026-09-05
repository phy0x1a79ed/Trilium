import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real one swaps stylesheets and waits for them to load; what matters here is that cycling
// asks for a repaint at all.
const themeMocks = vi.hoisted(() => ({ applyThemeFromOptions: vi.fn() }));
vi.mock("../../services/theme", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/theme")>()),
    applyThemeFromOptions: themeMocks.applyThemeFromOptions
}));

// Imported after the mock, which vi.mock hoists above it.
import { getStoredColorScheme, setStoredColorScheme } from "../../services/color_scheme";
import { useColorSchemeSwitcher } from "./hooks";

let api: ReturnType<typeof useColorSchemeSwitcher> | undefined;
let container: HTMLDivElement | undefined;

describe("useColorSchemeSwitcher", () => {
    beforeEach(() => {
        localStorage.clear();
        themeMocks.applyThemeFromOptions.mockClear();
    });

    afterEach(() => {
        unmount();
        localStorage.clear();
    });

    it("cycles system → light → dark → system for the theme being rendered", async () => {
        // Each step starts from the theme `applyTheme` would have left in `glob` after the last one.
        for (const [ theme, expected ] of [
            [ "next", "light" ], [ "next-light", "dark" ], [ "next-dark", "system" ],
            [ "auto", "light" ], [ "dark", "system" ]
        ]) {
            await mount(theme);
            act(() => api?.cycle());

            expect(getStoredColorScheme(), `cycling from ${theme}`).toBe(expected);
            expect(themeMocks.applyThemeFromOptions).toHaveBeenCalled();
            unmount();
        }
    });

    it("names the scheme being rendered rather than the one the option holds", async () => {
        setStoredColorScheme("dark");
        await mount("next-dark");

        expect(api?.scheme).toBe("dark");
        expect(api?.icon).toBe("bx bx-moon");
        expect(api?.isCustom).toBe(false);
    });

    it("stays inert for a custom theme, which has no light and dark variants", async () => {
        await mount("my-theme");

        expect(api?.isCustom).toBe(true);
        act(() => api?.cycle());

        expect(getStoredColorScheme()).toBeNull();
        expect(themeMocks.applyThemeFromOptions).not.toHaveBeenCalled();
    });
});

function Probe() {
    api = useColorSchemeSwitcher();
    return null;
}

async function mount(theme: string) {
    window.glob = { ...(window.glob ?? {}), theme } as typeof window.glob;
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
        if (container) {
            render(<Probe />, container);
        }
    });
}

function unmount() {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    api = undefined;
}
