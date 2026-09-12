import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import SliceLauncherBar from "./SliceLauncherBar.js";

vi.mock("../../services/resizer", () => ({
    default: { setupLeftPaneResizer: vi.fn() }
}));

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    glob.sliceRootNoteId = undefined;
    glob.sliceCanWrite = undefined;
});

/**
 * What a public slice offers, asserted by equality rather than by absence: a launcher added by the
 * next upstream merge must be a deliberate addition here, not something that arrives on its own.
 */
function mountBar() {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(<SliceLauncherBar isHorizontalLayout={false} />, container));

    // The icon is each launcher's stable identity here: the label travels in a Bootstrap tooltip that
    // is created on hover rather than as an attribute of the button.
    return Array.from(container.querySelectorAll("button"))
        .map((button) => Array.from(button.classList).find((name) => name.startsWith("bx-") || name.startsWith("bxs-")));
}

describe("SliceLauncherBar", () => {
    it("offers a writable link the five ways around its subtree", () => {
        glob.sliceRootNoteId = "sliceRoot";
        glob.sliceCanWrite = true;

        expect(mountBar()).toEqual([ "bx-file-blank", "bx-search", "bx-send", "bxs-network-chart", "bx-history" ]);
    });

    it("leaves out the two launchers that create a note when the link only reads", () => {
        glob.sliceRootNoteId = "sliceRoot";

        expect(mountBar()).toEqual([ "bx-send", "bxs-network-chart", "bx-history" ]);
    });
});
