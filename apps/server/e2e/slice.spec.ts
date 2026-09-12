import { expect, test } from "@playwright/test";

import App, { getBaseUrl } from "../../../packages/trilium-e2e/src/support/app";

/**
 * A public slice, driven the way the awm edge drives it: the three headers on every request.
 *
 * The edge's half — resolving a token, admitting the request without a session — has its own tests
 * where it lives. What can only be shown here is what the vault does once those headers arrive: the
 * application boots rooted at one note, everything outside answers 403, and what a visitor writes is
 * signed with their name.
 */
const VISITOR = "steven";

test("a slice shows one subtree, refuses everything outside it, and signs what it writes", async ({ browser, request }) => {
    const { insideNoteId, outsideNoteId } = await pickNotes(request);

    const context = await browser.newContext({
        extraHTTPHeaders: {
            "x-awm-slice-root": insideNoteId,
            "x-awm-slice-user": VISITOR,
            "x-awm-slice-write": "1"
        }
    });
    const page = await context.newPage();
    const app = new App(page, context);

    await app.goto();

    // The application paints rooted at the slice, with the launcher bar a slice gets of its own.
    await expect(app.noteTree).toBeVisible();
    await expect(app.launcherBar.locator("button")).toHaveCount(5);

    // A note outside the slice is refused, so is a route the mask does not name, and so is asking
    // for the tree from the vault root.
    for (const path of [ `/api/notes/${outsideNoteId}`, `/api/attribute-names/?type=label&query=a`,
                         `/api/tree?subTreeNoteId=root` ]) {
        expect(await statusOf(page, path)).toBe(403);
    }
    // Deleting a note deletes every clone of it, wherever in the vault they live.
    expect(await statusOf(page, `/api/notes/${insideNoteId}`, "DELETE")).toBe(403);

    // Its own history a writable link reads.
    expect(await statusOf(page, `/api/notes/${insideNoteId}/revisions`)).toBe(200);

    // A body write arrives sanitised and signed.
    const written = await statusOf(page, `/api/notes/${insideNoteId}/data`, "PUT",
        { content: "<p>written by a visitor</p><script>alert(1)</script>" });
    // The handler returns nothing, which the API's result handler answers with 204.
    expect(written).toBe(204);

    const revisions = await (await request.get(`${getBaseUrl()}/api/notes/${insideNoteId}/revisions`)).json();
    const signed = revisions.filter((revision: { source: string }) => revision.source === "slice");
    expect(signed.map((revision: { description: string }) => revision.description)).toContain(VISITOR);

    const stored = await (await request.get(`${getBaseUrl()}/api/notes/${insideNoteId}/blob`)).json();
    expect(stored.content).toContain("written by a visitor");
    expect(stored.content).not.toContain("<script");

    await context.close();
});

/** A note with children to open, and one outside it to be refused. */
async function pickNotes(request: { get: (url: string) => Promise<{ json: () => Promise<any> }> }) {
    const tree = await (await request.get(`${getBaseUrl()}/api/tree?subTreeNoteId=root`)).json();
    const childrenOf = (parentNoteId: string) =>
        tree.branches.filter((branch: { parentNoteId: string }) => branch.parentNoteId === parentNoteId);

    const topLevel = childrenOf("root").map((branch: { noteId: string }) => branch.noteId);
    const insideNoteId = topLevel.find((noteId: string) => childrenOf(noteId).length > 0);
    const outsideNoteId = topLevel.find((noteId: string) => noteId !== insideNoteId);

    expect(insideNoteId, "the fixture has a top-level note with children").toBeTruthy();
    expect(outsideNoteId, "the fixture has a second top-level note").toBeTruthy();
    return { insideNoteId, outsideNoteId };
}

/** The status the browser itself gets for a request, so the slice headers are the page's own. */
function statusOf(page: import("@playwright/test").Page, path: string, method = "GET", body?: object) {
    return page.evaluate(async ({ path, method, body }) => {
        const csrfToken = (window as unknown as { glob?: { csrfToken?: string } }).glob?.csrfToken;
        const headers: Record<string, string> = {};
        if (body) {
            headers["Content-Type"] = "application/json";
        }
        if (csrfToken) {
            headers["x-csrf-token"] = csrfToken;
        }
        const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        return response.status;
    }, { path, method, body });
}

/**
 * The shape the first slice shipped blind to: the shared note nested three deep and cloned, with a
 * cloned child of its own. A slice whose note is a direct child of `root` renders correctly whatever
 * the tree route sends, which is why a leak of the whole vault went unseen.
 */
test("a nested, cloned slice does the work of a small vault and nothing outside itself", async ({ browser, page: ownerPage }) => {
    const shape = await buildNestedSlice(ownerPage);

    const context = await browser.newContext({
        extraHTTPHeaders: {
            "x-awm-slice-root": shape.sliceRootNoteId,
            "x-awm-slice-user": VISITOR,
            "x-awm-slice-write": "1"
        }
    });
    const page = await context.newPage();
    const app = new App(page, context);

    // Nothing a slice reaches is refused, which is the whole of the philosophy in one assertion. The
    // deliberate probes at the end of this test are made after it is asserted.
    const refusals: string[] = [];
    page.on("response", (response) => {
        if (response.status() === 403 && new URL(response.url()).origin === new URL(getBaseUrl()).origin) {
            refusals.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
        }
    });

    await app.goto();
    await expect(app.noteTree).toBeVisible();

    // The shared note is the only row at the top, and no ancestor of it is on screen.
    const visibleTitles = page.locator(".tree-wrapper span.fancytree-node:visible .fancytree-title");
    await expect(visibleTitles.first()).toHaveText(shape.titles.sliceRoot);
    for (const absent of [ shape.titles.outer, shape.titles.middle, shape.titles.elsewhere, "Hidden Notes" ]) {
        await expect(page.locator(".tree-wrapper .fancytree-title", { hasText: absent })).toHaveCount(0);
    }

    // The five launchers a slice carries, and none of the owner's.
    for (const icon of [ "bx-file-blank", "bx-search", "bx-send", "bxs-network-chart", "bx-history" ]) {
        await expect(app.launcherBar.locator(`.${icon}`)).toHaveCount(1);
    }
    for (const icon of [ "bx-cog", "bx-link", "bx-calendar", "bx-bookmark" ]) {
        await expect(app.launcherBar.locator(`.${icon}`)).toHaveCount(0);
    }

    // Hoisting is what a slice still offers nothing for: unhoisting would put the vault on screen.
    for (const selector of [ ".unhoist-button", ".enter-workspace-button", ".tree-settings-button" ]) {
        await expect(page.locator(selector)).toHaveCount(0);
    }

    // Both children open, the cloned one included.
    for (const title of [ shape.titles.child, shape.titles.clonedChild ]) {
        await page.locator(".tree-wrapper .fancytree-title", { hasText: title }).first().click();
        await expect(app.currentNoteSplitTitle).toHaveValue(title);
    }

    // The tree context menu a writable link gets: the edits it can make, and nothing that would name
    // a note outside the slice or reach a route the mask refuses.
    await page.locator(".tree-wrapper .fancytree-title", { hasText: shape.titles.child })
        .first().click({ button: "right" });
    const menuItems = page.locator("#context-menu-container .dropdown-item");
    for (const offered of [ "Insert child note", "Cut", "Move to...", "Delete" ]) {
        await expect(menuItems.filter({ hasText: offered })).toHaveCount(1);
    }
    for (const absent of [ "Import into note", "Export", "Protect subtree" ]) {
        await expect(menuItems.filter({ hasText: absent })).toHaveCount(0);
    }
    await page.keyboard.press("Escape");

    // Creating, naming and deleting, driven the way a visitor drives them.
    await page.locator(".tree-wrapper .fancytree-title", { hasText: shape.titles.sliceRoot }).first().click();
    await app.launcherBar.locator(".bx-file-blank").click();
    // The note the launcher just created, which the split switches to, is what gets the name below.
    await expect(app.currentNoteSplitTitle).toHaveValue("New note");
    await app.currentNoteSplitTitle.fill(shape.titles.created);
    await app.currentNoteSplitTitle.blur();
    const createdRow = page.locator(".tree-wrapper .fancytree-title", { hasText: shape.titles.created });
    await expect(createdRow).toHaveCount(1);
    // The address bar names the note path of whatever is open, which the note just made now is, with
    // the tab and the hoisted note after it as query parameters.
    const createdNoteId = page.url().split("/").pop()?.split("?")[0] ?? "";

    await createdRow.first().click({ button: "right" });
    await menuItems.filter({ hasText: "Delete" }).click();
    await page.locator(".modal.delete-notes-dialog .btn-primary").click();
    await expect(createdRow).toHaveCount(0);

    // A new tab searches the slice. Every title carries the same stamp, so one query reaches the
    // whole fixture and only the boundary decides what comes back: the slice root and its two
    // children, with the row that creates a note at the head of them.
    await app.addNewTab();
    const searchBox = app.currentNoteSplit.locator(".note-autocomplete");
    await searchBox.click();
    await searchBox.pressSequentially(shape.stamp);

    const suggestions = app.currentNoteSplit.locator(".note-detail-empty-results .aa-suggestion");
    await expect(suggestions.filter({ hasText: shape.titles.child })).toHaveCount(1);
    for (const absent of [ shape.titles.outer, shape.titles.middle, shape.titles.elsewhere ]) {
        await expect(suggestions.filter({ hasText: absent })).toHaveCount(0);
    }

    // The workspace switcher searches the whole vault, so the empty tab leaves it out.
    await expect(page.locator(".workspace-notes .workspace-note")).toHaveCount(0);

    // A note that has just been deleted is outside every slice, so a request the browser had already
    // started for it is refused on its way back. Nothing an affordance leads to may be.
    expect(refusals.filter((refusal) => !refusal.includes(createdNoteId)),
        "a slice offers nothing that is refused").toEqual([]);

    // What the boundary refuses, asked for the way the client would ask. Every one of these is a
    // write the client offers nowhere, which is why they are probed rather than clicked.
    const outside = shape.elsewhereNoteId;
    expect(await statusOf(page, `/api/notes/${shape.childNoteId}`, "DELETE")).toBe(403);
    expect(await statusOf(page, "/api/delete-notes-preview", "POST",
        { branchIdsToDelete: [ shape.childBranchId ] })).toBe(403);
    expect(await statusOf(page, `/api/branches/${shape.childBranchId}?eraseNotes=true`, "DELETE")).toBe(403);
    expect(await statusOf(page,
        `/api/branches/${shape.childBranchId}/move-to/${shape.elsewhereBranchId}`, "PUT")).toBe(403);
    expect(await statusOf(page, `/api/notes/${shape.childNoteId}/clone-to-note/${outside}`, "PUT")).toBe(403);
    expect(await statusOf(page, `/api/notes/${shape.sliceRootNoteId}/children?target=into`, "POST",
        { title: "from a template outside", content: "", type: "text", templateNoteId: outside })).toBe(403);
    expect(await statusOf(page, `/api/notes/${shape.childNoteId}/attributes`, "POST",
        { type: "relation", name: "runOnNoteChange", value: shape.childNoteId })).toBe(403);

    await context.close();
});

/**
 * The same slice under the new layout, which this fork's own vault runs.
 *
 * The new layout draws the ribbon as a right pane and the floating buttons as a status bar, and
 * mounts both from components the old layout never renders. Nothing a slice reaches may be refused
 * there either, so the surfaces that exist only in this layout are opened one by one.
 */
test("a slice offers nothing refused under the new layout", async ({ browser, page: ownerPage }) => {
    // Two vaults' worth of booting: the owner's, to build the fixture and switch the layout, and the
    // visitor's, which then opens every tab of the right pane one at a time.
    test.slow();
    const shape = await buildNestedSlice(ownerPage);
    await setNewLayout(ownerPage, true);

    const context = await browser.newContext({
        // Wide enough that the right pane's tab strip is not clipped by the pane's own actions.
        viewport: { width: 1920, height: 1080 },
        extraHTTPHeaders: {
            "x-awm-slice-root": shape.sliceRootNoteId,
            "x-awm-slice-user": VISITOR,
            "x-awm-slice-write": "1"
        }
    });
    const page = await context.newPage();
    const app = new App(page, context);

    const refusals: string[] = [];
    page.on("response", (response) => {
        if (response.status() === 403 && new URL(response.url()).origin === new URL(getBaseUrl()).origin) {
            refusals.push(`${response.request().method()} ${new URL(response.url()).pathname}`);
        }
    });

    try {
        await app.goto();
        await expect(app.noteTree).toBeVisible();
        // The status bar and the right pane are what this layout puts in place of the floating buttons
        // and the ribbon.
        await expect(page.locator(".status-bar")).toBeVisible();

        // The pane follows the note being read and carries nothing without one.
        await page.locator(".tree-wrapper .fancytree-title", { hasText: shape.titles.child }).first().click();
        await expect(app.currentNoteSplitTitle).toHaveValue(shape.titles.child);

        // Every tab in turn, since a tab's widgets are mounted when it is first shown and never before.
        // The pane boots open, as it does for an owner who left it that way.
        const tabs = page.locator("#right-pane .tab-strip-tab");
        const tabCount = await tabs.count();
        expect(tabCount).toBeGreaterThan(1);
        for (let index = 0; index < tabCount; index++) {
            await tabs.nth(index).click();
            await expect(tabs.nth(index)).toHaveClass(/active/);
        }

        // The attributes card is the write affordance the ribbon's owned-attributes tab used to be.
        await tabs.filter({ has: page.locator(".bx-hash") }).click();
        const attributeCard = page.locator("#right-pane #attributes");
        await expect(attributeCard).toBeVisible();
        await expect(attributeCard.locator(".bx-plus").first()).toBeVisible();

        // Setting a label, which is what that card is for. A plain label is created in the row itself,
        // and the press that ends the editing is what saves it.
        await attributeCard.locator(".attribute-add-row").click();
        const creationEditor = attributeCard.locator(".attribute-creation-editor");
        await expect(creationEditor).toBeVisible();
        await creationEditor.locator(".attribute-creation-name input").fill("verified");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        await expect(attributeCard.getByText("verified")).toBeVisible();
        // Read back from the vault rather than from the card, so the row is proof of a write.
        const stored = await page.evaluate(async (noteId) =>
            (await (await fetch(`/api/notes/${noteId}/attributes`)).json()) as { name: string }[],
        shape.childNoteId);
        expect(stored.map((attribute) => attribute.name)).toContain("verified");

        // The status bar's badges, each of which reads something about the note behind a dropdown.
        const badges = page.locator(".status-bar .actions-row .status-bar-dropdown-button");
        for (let index = 0; index < await badges.count(); index++) {
            await badges.nth(index).click();
            await page.keyboard.press("Escape");
        }

        // The search launcher makes a search note inside the slice. Its parameters panel is where this
        // layout puts the ribbon's search tab, and two of the things that panel offers are refused: a
        // search script runs code, and executing a search's actions writes across the vault.
        await app.launcherBar.locator(".bx-search").click();
        const searchPanel = app.currentNoteSplit.locator(".search-definition-widget");
        await expect(searchPanel).toBeVisible();
        await expect(searchPanel.locator(".bxs-zap")).toHaveCount(0);
        await expect(searchPanel.locator(".add-search-option .bx-code")).toHaveCount(0);

        await searchPanel.locator(".search-string").fill(shape.stamp);
        await page.keyboard.press("Enter");
        const results = app.currentNoteSplit.locator(".search-results .note-book-title");
        await expect(results.filter({ hasText: shape.titles.child })).toHaveCount(1);
        for (const absent of [ shape.titles.outer, shape.titles.middle, shape.titles.elsewhere ]) {
            await expect(results.filter({ hasText: absent })).toHaveCount(0);
        }

        // An empty note offers the note-type switcher, which reads the vault's own templates.
        await page.locator(".tree-wrapper .fancytree-title", { hasText: shape.titles.sliceRoot }).first().click();
        await app.launcherBar.locator(".bx-file-blank").click();
        await expect(app.currentNoteSplitTitle).toHaveValue("New note");
        await expect(app.currentNoteSplit.locator(".note-type-switcher")).toBeVisible();
        const createdNoteId = page.url().split("/").pop()?.split("?")[0] ?? "";

        expect(refusals.filter((refusal) => !refusal.includes(createdNoteId)),
            "the new layout offers nothing that is refused").toEqual([]);
    } finally {
        await setNewLayout(ownerPage, false);
        await context.close();
    }
});

/**
 * Turns the new layout on or off for the whole vault, the way its settings pane does, with the right
 * pane open so a visitor arrives on the surface this test is about.
 */
function setNewLayout(page: import("@playwright/test").Page, enabled: boolean) {
    return page.evaluate(async (enabled) => {
        const csrfToken = (window as unknown as { glob?: { csrfToken?: string } }).glob?.csrfToken ?? "";
        await fetch("/api/options", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
            body: JSON.stringify({ newLayout: String(enabled), rightPaneVisible: String(enabled) })
        });
    }, enabled);
}

/**
 * `root > outer > middle > sliceRoot`, with `sliceRoot` cloned under `elsewhere` and one of its two
 * children cloned there too — a note the slice holds by one branch and the vault by another.
 */
async function buildNestedSlice(page: import("@playwright/test").Page) {
    const app = new App(page, page.context());
    await app.goto();

    const stamp = Date.now();
    const titles = {
        outer: `slice outer ${stamp}`,
        middle: `slice middle ${stamp}`,
        sliceRoot: `slice root ${stamp}`,
        child: `slice child ${stamp}`,
        clonedChild: `slice cloned child ${stamp}`,
        elsewhere: `slice elsewhere ${stamp}`,
        created: `slice made ${stamp}`
    };

    const ids = await page.evaluate(async (titles) => {
        const csrfToken = (window as unknown as { glob?: { csrfToken?: string } }).glob?.csrfToken ?? "";
        const headers = { "Content-Type": "application/json", "x-csrf-token": csrfToken };
        const create = async (parentNoteId: string, title: string, type = "text") => {
            const created = await (await fetch(`/api/notes/${parentNoteId}/children?target=into`, {
                method: "POST", headers, body: JSON.stringify({ title, type, content: "<p>body</p>" })
            })).json();
            return { noteId: created.note.noteId as string, branchId: created.branch.branchId as string };
        };
        const cloneTo = (noteId: string, parentNoteId: string) =>
            fetch(`/api/notes/${noteId}/clone-to-note/${parentNoteId}`, {
                method: "PUT", headers, body: "{}"
            });

        const outer = await create("root", titles.outer);
        const middle = await create(outer.noteId, titles.middle);
        const sliceRoot = await create(middle.noteId, titles.sliceRoot);
        const child = await create(sliceRoot.noteId, titles.child);
        // A code note, to pin that a writable slice is not limited to prose.
        const clonedChild = await create(sliceRoot.noteId, titles.clonedChild, "code");
        const elsewhere = await create("root", titles.elsewhere);

        await cloneTo(sliceRoot.noteId, elsewhere.noteId);
        await cloneTo(clonedChild.noteId, elsewhere.noteId);

        return {
            sliceRootNoteId: sliceRoot.noteId,
            childNoteId: child.noteId,
            childBranchId: child.branchId,
            elsewhereNoteId: elsewhere.noteId,
            elsewhereBranchId: elsewhere.branchId
        };
    }, titles);

    return { ...ids, titles, stamp: String(stamp) };
}

/**
 * The board defect the slice work sits beside: a render used to persist the columns it had just
 * resolved, so a second client with the same board open wrote its own view back over a change.
 *
 * What this pins is the cause rather than the symptom — after two browsers have drawn the same
 * board, nothing about it has been written. A column deletion sticking is what that buys.
 */
test("drawing a board writes nothing, however many browsers draw it", async ({ browser, page }) => {
    const boardNoteId = await createBoard(page);

    // The first draw of a board that has no definition seeds one — the one write a render still
    // makes, and what a board created after migration 0240 ran depends on.
    await page.goto(`/#root/${boardNoteId}`);
    await page.waitForTimeout(2000);
    const seeded = await boardState(page, boardNoteId);
    expect(seeded.definition).toEqual([
        "label:status=promoted,alias=Status,single,select,options=To Do;Doing;Done"
    ]);

    // Every draw after it writes nothing, in this browser or any other.
    const second = await browser.newContext();
    const secondPage = await second.newPage();
    for (const target of [ page, secondPage ]) {
        await target.goto(`/#root/${boardNoteId}`);
        await target.waitForTimeout(2000);
        await target.reload();
        await target.waitForTimeout(2000);
    }

    expect(await boardState(page, boardNoteId)).toEqual(seeded);
    await second.close();
});

/** A board with three columns, built the way a person building one leaves it. */
async function createBoard(page: import("@playwright/test").Page) {
    const app = new App(page, page.context());
    await app.goto();

    return page.evaluate(async () => {
        const csrfToken = (window as unknown as { glob?: { csrfToken?: string } }).glob?.csrfToken ?? "";
        const headers = { "Content-Type": "application/json", "x-csrf-token": csrfToken };
        const post = async (path: string, body: object) =>
            (await fetch(path, { method: "POST", headers, body: JSON.stringify(body) })).json();

        const board = await post("/api/notes/root/children?target=into", {
            title: "e2e board", type: "book", content: ""
        });
        const boardNoteId = board.note.noteId;
        await fetch(`/api/notes/${boardNoteId}/attributes`, {
            method: "POST", headers,
            body: JSON.stringify({ type: "label", name: "viewType", value: "board" })
        });

        for (const status of [ "To Do", "Doing", "Done" ]) {
            const card = await post(`/api/notes/${boardNoteId}/children?target=into`, {
                title: `card ${status}`, type: "text", content: ""
            });
            await fetch(`/api/notes/${card.note.noteId}/attributes`, {
                method: "POST", headers,
                body: JSON.stringify({ type: "label", name: "status", value: status })
            });
        }
        return boardNoteId as string;
    });
}

/** Everything a render used to overwrite: the group-by definition and the config attachment. */
async function boardState(page: import("@playwright/test").Page, noteId: string) {
    return page.evaluate(async (noteId) => {
        const attributes = await (await fetch(`/api/notes/${noteId}/attributes`)).json();
        const attachments = await (await fetch(`/api/notes/${noteId}/attachments`)).json();
        return {
            definition: attributes
                .filter((attribute: { name: string }) => attribute.name.startsWith("label:"))
                .map((attribute: { name: string; value: string }) => `${attribute.name}=${attribute.value}`)
                .sort(),
            attachments: attachments
                .map((attachment: { title: string; blobId: string }) => `${attachment.title}:${attachment.blobId}`)
                .sort()
        };
    }, noteId);
}
