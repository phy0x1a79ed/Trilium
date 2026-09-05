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

    // The application paints rooted at the slice, with the affordances that would 403 gone.
    await expect(app.noteTree).toBeVisible();
    await expect(app.launcherBar).toBeHidden();

    // A note outside the slice is refused, and so is a route the mask does not name.
    for (const path of [ `/api/notes/${outsideNoteId}`, `/api/notes/${insideNoteId}/revisions`,
                         `/api/tree?subTreeNoteId=root` ]) {
        expect(await statusOf(page, path)).toBe(403);
    }
    expect(await statusOf(page, `/api/notes/${insideNoteId}/title`, "PUT")).toBe(403);

    // A body write is the one thing a slice may do, and it arrives sanitised and signed.
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
test("a nested, cloned slice shows its own subtree and offers nothing it cannot do", async ({ browser, page: ownerPage }) => {
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

    // Nothing a slice reaches is refused, which is the whole of the philosophy in one assertion.
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

    // Every affordance a slice cannot act on is absent rather than disabled.
    for (const selector of [ ".add-note-button", ".unhoist-button", ".enter-workspace-button",
                             ".tree-settings-button", ".ribbon-button-container" ]) {
        await expect(page.locator(selector)).toHaveCount(0);
    }

    // Both children open, the cloned one included.
    for (const title of [ shape.titles.child, shape.titles.clonedChild ]) {
        await page.locator(".tree-wrapper .fancytree-title", { hasText: title }).first().click();
        await expect(app.currentNoteSplitTitle).toHaveValue(title);
    }

    // Four entries, by equality: open in new tab, open in new split, open in popup, copy note path.
    await page.locator(".tree-wrapper .fancytree-title", { hasText: shape.titles.child })
        .first().click({ button: "right" });
    await expect(page.locator("#context-menu-container .dropdown-item")).toHaveCount(4);

    expect(refusals, "a slice offers nothing that is refused").toEqual([]);

    await context.close();
});

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
        elsewhere: `slice elsewhere ${stamp}`
    };

    const sliceRootNoteId = await page.evaluate(async (titles) => {
        const csrfToken = (window as unknown as { glob?: { csrfToken?: string } }).glob?.csrfToken ?? "";
        const headers = { "Content-Type": "application/json", "x-csrf-token": csrfToken };
        const create = async (parentNoteId: string, title: string, type = "text") => {
            const created = await (await fetch(`/api/notes/${parentNoteId}/children?target=into`, {
                method: "POST", headers, body: JSON.stringify({ title, type, content: "<p>body</p>" })
            })).json();
            return created.note.noteId as string;
        };
        const cloneTo = (noteId: string, parentNoteId: string) =>
            fetch(`/api/notes/${noteId}/clone-to-note/${parentNoteId}`, {
                method: "PUT", headers, body: "{}"
            });

        const outer = await create("root", titles.outer);
        const middle = await create(outer, titles.middle);
        const sliceRoot = await create(middle, titles.sliceRoot);
        await create(sliceRoot, titles.child);
        // A code note, to pin that a writable slice is not limited to prose.
        const clonedChild = await create(sliceRoot, titles.clonedChild, "code");
        const elsewhere = await create("root", titles.elsewhere);

        await cloneTo(sliceRoot, elsewhere);
        await cloneTo(clonedChild, elsewhere);

        return sliceRoot;
    }, titles);

    return { sliceRootNoteId, titles };
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
