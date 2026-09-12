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
        glob.sliceCanWrite = false;
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

    it("offers the tree edits a writable link admits, and nothing that leaves the slice", async () => {
        glob.sliceCanWrite = true;

        const items = await buildTreeContextMenuItems({
            note: { noteId: "inside", type: "text", isArchived: false } as FNote,
            branch: { branchId: "sliceRoot1_inside", parentNoteId: "sliceRoot1" } as FBranch,
            selectedOrActiveNoteIds: [ "inside" ],
            selectedOrActiveBranchIds: [ "sliceRoot1_inside" ],
            notePath: "root/sliceRoot1/inside",
            component: {} as never
        });

        expect(items.map((item) => "title" in item ? item.title : "separator")).toEqual([
            "tree-context-menu.open-in-a-new-tab",
            "tree-context-menu.open-in-a-new-split",
            "tree-context-menu.open-in-popup",
            "tree-context-menu.copy-note-path-to-clipboard",
            "separator",
            "tree-context-menu.insert-note-after",
            "tree-context-menu.insert-child-note",
            "separator",
            "tree-context-menu.cut",
            "tree-context-menu.copy-clone",
            "tree-context-menu.paste-into",
            "tree-context-menu.paste-after",
            "tree-context-menu.move-to",
            "tree-context-menu.clone-to",
            "tree-context-menu.duplicate",
            "separator",
            "tree-context-menu.archive",
            "tree-context-menu.delete",
            "separator",
            "tree-context-menu.advanced"
        ]);
    });

    it("disables what would name a note outside the slice when the target is the slice root", async () => {
        glob.sliceCanWrite = true;

        const items = await buildTreeContextMenuItems({
            note: { noteId: "sliceRoot1", type: "text", isArchived: false } as FNote,
            branch: { branchId: "root_sliceRoot1", parentNoteId: "root" } as FBranch,
            selectedOrActiveNoteIds: [ "sliceRoot1" ],
            selectedOrActiveBranchIds: [ "root_sliceRoot1" ],
            notePath: "root/sliceRoot1",
            component: {} as never
        });

        const enabledByCommand = new Map(items
            .filter((item): item is MenuCommandItem<TreeCommandNames> => "command" in item && !!item.command)
            .map((item) => [ item.command, item.enabled ]));
        for (const command of [ "insertNoteAfter", "cutNotesToClipboard", "moveNotesTo", "cloneNotesTo", "duplicateSubtree", "deleteNotes" ]) {
            expect(enabledByCommand.get(command as TreeCommandNames)).toBe(false);
        }
        expect(enabledByCommand.get("insertChildNote")).toBe(true);
    });
});
