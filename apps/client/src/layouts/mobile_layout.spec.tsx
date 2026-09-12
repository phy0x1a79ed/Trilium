import { afterEach, describe, expect, it } from "vitest";

import type AppContext from "../components/app_context.js";
import type { TypedComponent } from "../components/component.js";
import QuickSearchWidget from "../widgets/quick_search.js";
import MobileLayout from "./mobile_layout.js";

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

/**
 * Whether the tree holds a React widget rendering the named component. The layouts mount components
 * through JSX, which `ReactWrappedWidget` keeps as a VNode rather than as a widget subclass.
 */
function containsReactWidget(root: TypedComponent<any>, componentName: string): boolean {
    const type = (root as any).el?.type;
    if (typeof type === "function" && type.name === componentName) {
        return true;
    }
    return root.children.some((child) => containsReactWidget(child, componentName));
}

function buildRootWidget() {
    const layout = new MobileLayout();
    return layout.getRootWidget({} as typeof AppContext);
}

describe("MobileLayout", () => {
    it("mounts the launcher pane and quick search outside a slice", () => {
        const root = buildRootWidget();

        expect(containsWidgetId(root, "launcher-pane")).toBe(true);
        expect(containsQuickSearch(root)).toBe(true);
    });

    it("gives a slice its own launcher bar, and leaves out the owner's launchers and quick search", () => {
        (globalThis as any).glob.sliceRootNoteId = "slice-root-note";

        const root = buildRootWidget();

        expect(containsWidgetId(root, "launcher-pane")).toBe(true);
        expect(containsQuickSearch(root)).toBe(false);
        expect(containsReactWidget(root, "SliceLauncherBar")).toBe(true);
        expect(containsReactWidget(root, "LauncherContainer")).toBe(false);
    });
});
