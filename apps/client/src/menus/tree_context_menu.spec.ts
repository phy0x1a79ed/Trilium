import { beforeEach, describe, expect, it, vi } from "vitest";

import type FBranch from "../entities/fbranch";
import type FNote from "../entities/fnote";
import { buildTreeContextMenuItems } from "./tree_context_menu";
import type { MenuCommandItem } from "./context_menu";
import type { TreeCommandNames } from "./tree_context_menu";

vi.mock("../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve()
}));

/**
 * What a public slice offers, asserted by equality rather than by absence: an entry added by the
 * next upstream merge must be a deliberate addition here, not something that arrives on its own.
 */
describe("tree context menu inside a slice", () => {
    beforeEach(() => {
        glob.sliceRootNoteId = "sliceRoot1";
    });

    it("offers exactly the four entries that reach nothing refused", async () => {
        const items = await buildTreeContextMenuItems({
            note: { noteId: "inside", type: "text" } as FNote,
            branch: { branchId: "sliceRoot1_inside", parentNoteId: "sliceRoot1" } as FBranch,
            selectedOrActiveNoteIds: [ "inside" ],
            selectedOrActiveBranchIds: [ "sliceRoot1_inside" ],
            notePath: "root/sliceRoot1/inside",
            component: {} as never
        });

        expect(items.map((item) => (item as MenuCommandItem<TreeCommandNames>).command)).toEqual([
            "openInTab", "openNoteInSplit", "openNoteInPopup", "copyNotePathToClipboard"
        ]);
        // The context menu reads the action repository without optional chaining, and a slice binds
        // only a few actions, so no entry here may name one.
        expect(items.some((item) => "keyboardShortcut" in item)).toBe(false);
    });

    it("disables the single-note entries when several notes are selected", async () => {
        const items = await buildTreeContextMenuItems({
            note: { noteId: "inside", type: "text" } as FNote,
            branch: { branchId: "sliceRoot1_inside", parentNoteId: "sliceRoot1" } as FBranch,
            selectedOrActiveNoteIds: [ "inside", "alsoInside" ],
            selectedOrActiveBranchIds: [ "sliceRoot1_inside", "sliceRoot1_alsoInside" ],
            notePath: "root/sliceRoot1/inside",
            component: {} as never
        });

        const enabled = items.map((item) => (item as MenuCommandItem<TreeCommandNames>).enabled);
        expect(enabled).toEqual([ false, false, false, true ]);
    });
});
