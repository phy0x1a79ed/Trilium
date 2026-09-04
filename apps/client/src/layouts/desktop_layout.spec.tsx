import { afterEach, describe, expect, it } from "vitest";

import type { AppContext } from "../components/app_context.js";
import type { TypedComponent } from "../components/component.js";
import { WidgetsByParent } from "../services/bundle.js";
import QuickSearchWidget from "../widgets/quick_search.js";
import DesktopLayout from "./desktop_layout.js";

afterEach(() => {
    (globalThis as any).glob.sliceRootNoteId = undefined;
});

/** Walks the widget tree `getRootWidget` builds, without rendering, looking for a given id. */
function containsWidgetId(root: TypedComponent<any>, id: string): boolean {
    if ((root as any).attrs?.id === id) {
        return true;
    }
    return root.children.some((child) => containsWidgetId(child, id));
}

function containsQuickSearch(root: TypedComponent<any>): boolean {
    if (root instanceof QuickSearchWidget) {
        return true;
    }
    return root.children.some((child) => containsQuickSearch(child));
}

function buildRootWidget() {
    const layout = new DesktopLayout(new WidgetsByParent());
    return layout.getRootWidget({} as AppContext);
}

describe("DesktopLayout", () => {
    it("mounts the launcher pane and quick search outside a slice", () => {
        const root = buildRootWidget();

        expect(containsWidgetId(root, "launcher-pane")).toBe(true);
        expect(containsQuickSearch(root)).toBe(true);
    });

    it("hides the launcher pane (launchbar, global search, jump-to-note, settings, new note) and quick search inside a slice", () => {
        (globalThis as any).glob.sliceRootNoteId = "slice-root-note";

        const root = buildRootWidget();

        expect(containsWidgetId(root, "launcher-pane")).toBe(false);
        expect(containsQuickSearch(root)).toBe(false);
    });
});
