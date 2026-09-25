import { expect, type Page, test } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

/**
 * A board whose columns come from its child folders, driven from both sides: every change made on
 * the board lands in the tree, and every change made in the tree shows on the board.
 */
test("a folder board keeps its columns and the tree in step", async ({ page }) => {
    const app = new App(page, page.context());
    await app.goto();
    await app.setOption("newLayout", "true");

    const ids = await buildBoard(page);
    await page.goto(`/#root/${ids.board}`);
    const board = page.locator(".note-split:not(.hidden-ext) .board-view");
    const columns = board.locator(".board-column");
    const column = (title: string) => columns.filter({ has: page.locator("h3 .title", { hasText: title }) });
    const cardsOf = (title: string) => column(title).locator(".board-note .title");

    // Switched to folders from the properties bar, the board shows one column per folder.
    await board.locator(".collection-properties .bx-cog").click();
    await page.locator(".dropdown-item", { hasText: "Columns from" }).hover();
    await page.locator(".dropdown-item:not(.dropdown-submenu)", { hasText: /^\s*Folders\s*$/ }).click();
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Planned", "Active", "Done" ]);
    await expect(cardsOf("Planned")).toHaveText([ "first", "second" ]);
    await expect(cardsOf("Done")).toHaveCount(0);
    await expect.poll(async () => (await readNote(page, ids.board)).columnsFrom).toBe("folders");

    // A card dragged into an empty column moves into that folder.
    await cardsOf("Planned").filter({ hasText: "first" }).dragTo(column("Done").locator(".board-column-content"));
    await expect(cardsOf("Done")).toHaveText([ "first" ]);
    await expect.poll(() => parentsOf(page, ids.first)).toEqual([ ids.done ]);

    // "Move to" moves a card into a populated column.
    await cardsOf("Planned").filter({ hasText: "second" }).click({ button: "right" });
    await page.locator("#context-menu-container .dropdown-item", { hasText: "Move to" }).hover();
    await page.locator("#context-menu-container .dropdown-item:not(.dropdown-submenu)", { hasText: /^\s*Active\s*$/ }).click();
    await expect(cardsOf("Active")).toHaveText([ "third", "second" ]);
    await expect.poll(() => parentsOf(page, ids.second)).toEqual([ ids.active ]);

    // "New item" creates the note inside the column's folder.
    await column("Done").locator(".board-new-item").click();
    await column("Done").locator(".board-new-item input, .board-new-item textarea").fill("made on board");
    await page.keyboard.press("Enter");
    await expect(cardsOf("Done")).toHaveText([ "first", "made on board" ]);
    await expect.poll(() => childTitlesOf(page, ids.done)).toEqual([ "first", "made on board" ]);

    // "Insert above" creates the note in the folder, at that place.
    await cardsOf("Done").filter({ hasText: "first" }).click({ button: "right" });
    await page.locator("#context-menu-container .dropdown-item", { hasText: "Insert above" }).click();
    await column("Done").locator(".board-note.editing input, .board-note.editing textarea").fill("inserted");
    await page.keyboard.press("Enter");
    await expect(cardsOf("Done")).toHaveText([ "inserted", "first", "made on board" ]);
    await expect.poll(() => childTitlesOf(page, ids.done)).toEqual([ "inserted", "first", "made on board" ]);

    // A card dragged within its column reorders the folder's children.
    await cardsOf("Done").filter({ hasText: "made on board" })
        .dragTo(cardsOf("Done").filter({ hasText: "inserted" }), { targetPosition: { x: 5, y: 2 } });
    await expect(cardsOf("Done")).toHaveText([ "made on board", "inserted", "first" ]);
    await expect.poll(() => childTitlesOf(page, ids.done)).toEqual([ "made on board", "inserted", "first" ]);

    // Renaming a column renames its folder.
    await column("Planned").locator("h3 .edit-icon").click();
    await board.locator(".board-column h3 input").fill("Backlog");
    await page.keyboard.press("Enter");
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Active", "Done" ]);
    await expect.poll(() => titleOf(page, ids.planned)).toBe("Backlog");

    // Adding a column adds a folder under the board.
    await board.locator(".board-add-column").click();
    await board.locator(".board-add-column input").fill("Review");
    await page.keyboard.press("Enter");
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Active", "Done", "Review" ]);
    await expect.poll(() => childTitlesOf(page, ids.board)).toEqual([ "Backlog", "Active", "Done", "Review" ]);

    // Dragging a column reorders the folders.
    // The dragged column hides once the drag starts, which leaves Playwright's own drag aiming at a
    // stale point, so the three events are dispatched with a render between each.
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await column("Review").locator("h3").dispatchEvent("dragstart", { dataTransfer });
    const target = await column("Active").boundingBox();
    await column("Active").dispatchEvent("dragover", { dataTransfer, clientX: (target?.x ?? 0) + 2 });
    await board.locator(".column-drop-placeholder").waitFor();
    await board.locator(".board-view-container").dispatchEvent("drop", { dataTransfer });
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Review", "Active", "Done" ]);
    await expect.poll(() => childTitlesOf(page, ids.board)).toEqual([ "Backlog", "Review", "Active", "Done" ]);

    // Deleting a column goes through the delete-notes dialog and deletes the folder.
    await column("Review").locator("h3").click({ button: "right" });
    await page.locator("#context-menu-container .dropdown-item", { hasText: "Delete column" }).click();
    await page.locator(".delete-notes-dialog .btn-primary").click();
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Active", "Done" ]);
    await expect.poll(() => childTitlesOf(page, ids.board)).toEqual([ "Backlog", "Active", "Done" ]);

    // From the tree side: a rename, a move, a new folder and a removed folder all reach the board.
    await api(page, "PUT", `/api/notes/${ids.active}/title`, { title: "Doing" });
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Doing", "Done" ]);

    await api(page, "PUT", `/api/branches/${ids.thirdBranch}/move-to/${ids.plannedBranch}`);
    await expect(cardsOf("Backlog")).toHaveText([ "third" ]);
    await expect(cardsOf("Doing")).toHaveText([ "second" ]);

    const cancelled = await api(page, "POST", `/api/notes/${ids.board}/children?target=into`,
        { title: "Cancelled", type: "book", content: "" }) as { branch: { branchId: string } };
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Doing", "Done", "Cancelled" ]);

    await api(page, "DELETE", `/api/branches/${cancelled.branch.branchId}?taskId=e2e-${Date.now()}&last=true`);
    await expect(board.locator(".board-column h3 .title")).toHaveText([ "Backlog", "Doing", "Done" ]);

    // No status label or definition is written anywhere on the way.
    const statusLabels = await page.evaluate(async (boardNoteId) => {
        const froca = (window as unknown as { glob: { froca: { getNote(id: string): Promise<FrocaNote | null> } } }).glob.froca;
        const names: string[] = [];
        const visit = async (noteId: string) => {
            const note = await froca.getNote(noteId);
            if (!note) return;
            for (const attr of note.getOwnedAttributes()) {
                if (attr.name.includes("status")) names.push(`${note.title}: ${attr.name}`);
            }
            for (const childId of note.getChildNoteIds()) await visit(childId);
        };
        await visit(boardNoteId);
        return names;
    }, ids.board);
    expect(statusLabels).toEqual([]);
});

test.afterEach(async ({ page }) => {
    await new App(page, page.context()).setOption("newLayout", "false");
});

/** A board in label mode with three folders: `Planned` holds two cards, `Active` one, `Done` none. */
async function buildBoard(page: Page) {
    const stamp = Date.now();
    const create = async (parentNoteId: string, title: string, type = "text") => {
        const created = await api(page, "POST", `/api/notes/${parentNoteId}/children?target=into`,
            { title, type, content: "" }) as { note: { noteId: string }, branch: { branchId: string } };
        return { noteId: created.note.noteId, branchId: created.branch.branchId };
    };

    const board = await create("root", `folder board ${stamp}`, "book");
    await api(page, "POST", `/api/notes/${board.noteId}/attributes`, { type: "label", name: "viewType", value: "board" });
    const planned = await create(board.noteId, "Planned", "book");
    const active = await create(board.noteId, "Active", "book");
    const done = await create(board.noteId, "Done", "book");
    const first = await create(planned.noteId, "first");
    const second = await create(planned.noteId, "second");
    const third = await create(active.noteId, "third");

    return {
        board: board.noteId,
        planned: planned.noteId,
        plannedBranch: planned.branchId,
        active: active.noteId,
        done: done.noteId,
        first: first.noteId,
        second: second.noteId,
        third: third.noteId,
        thirdBranch: third.branchId
    };
}

function api(page: Page, method: string, path: string, body?: object) {
    return page.evaluate(async ({ method, path, body }) => {
        const csrfToken = (window as unknown as { glob?: { csrfToken?: string } }).glob?.csrfToken ?? "";
        const response = await fetch(path, {
            method,
            headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await response.text();
        return text ? JSON.parse(text) as unknown : null;
    }, { method, path, body });
}

/** Reads a note as the client's froca holds it, which is what the board draws from. */
function readNote(page: Page, noteId: string) {
    return page.evaluate(async (noteId) => {
        const froca = (window as unknown as { glob: { froca: { getNote(id: string): Promise<FrocaNote | null> } } }).glob.froca;
        const note = await froca.getNote(noteId);
        const children = await Promise.all((note?.getChildNoteIds() ?? []).map(id => froca.getNote(id)));
        return {
            title: note?.title,
            parentNoteIds: note?.getParentNoteIds() ?? [],
            childTitles: children.map(child => child?.title),
            columnsFrom: note?.getOwnedLabelValue("board:columnsFrom")
        };
    }, noteId);
}

interface FrocaNote {
    title: string;
    getParentNoteIds(): string[];
    getChildNoteIds(): string[];
    getOwnedLabelValue(name: string): string | null;
    getOwnedAttributes(): { name: string }[];
}

async function parentsOf(page: Page, noteId: string) {
    return (await readNote(page, noteId)).parentNoteIds;
}

async function childTitlesOf(page: Page, noteId: string) {
    return (await readNote(page, noteId)).childTitles;
}

async function titleOf(page: Page, noteId: string) {
    return (await readNote(page, noteId)).title;
}
