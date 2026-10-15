import { expect, type Page, test } from "@playwright/test";

import App from "../../../packages/trilium-e2e/src/support/app";

/**
 * A chat collection shows its children as messages in `msgSeq` order, and its input box adds a
 * plain-text child that stays "sending" until something stamps it with a sequence.
 */
test("a chat collection lists messages in sequence and posts new ones as children", async ({ page }) => {
    const app = new App(page, page.context());
    await app.goto();
    await app.setOption("newLayout", "true");

    const chat = await create(page, "root", `chat ${Date.now()}`, "book");
    await label(page, chat, "viewType", "chat");
    await message(page, chat, 2, "op@beta", "second");
    await message(page, chat, 1, "tony@tony", "first");

    await page.goto(`/#root/${chat}`);
    const view = page.locator(".note-split:not(.hidden-ext) .chat-view");
    const bodies = view.locator(".chat-view-message-body");
    await expect(bodies).toHaveText([ "first", "second" ]);
    await expect(view.locator(".chat-view-message-from")).toHaveText([ "tony@tony", "op@beta" ]);

    // Enter posts the text as a plain-text child note, shown as sending.
    await view.locator(".chat-view-composer textarea").fill("from the GUI");
    await page.keyboard.press("Enter");
    await expect(bodies).toHaveText([ "first", "second", "from the GUI" ]);
    await expect(view.locator(".chat-view-message.sending")).toHaveCount(1);
    await expect(view.locator(".chat-view-composer textarea")).toHaveValue("");
    await expect.poll(async () => (await children(page, chat)).find(c => c.content === "from the GUI"))
        .toMatchObject({ type: "code", mime: "text/plain" });

    // Once sealed with a sequence, it is a message like any other.
    const draft = (await children(page, chat)).find(c => c.content === "from the GUI")!;
    await label(page, draft.noteId, "msgFrom", "tony@tony");
    await label(page, draft.noteId, "msgSeq", "00000003");
    await expect(view.locator(".chat-view-message.sending")).toHaveCount(0);
    await expect(view.locator(".chat-view-message-from")).toHaveText([ "tony@tony", "op@beta", "tony@tony" ]);

    // A message sealed out of tree order still lands in sequence order.
    await message(page, chat, 0, "op@beta", "zeroth");
    await expect(bodies).toHaveText([ "zeroth", "first", "second", "from the GUI" ]);
});

test.afterEach(async ({ page }) => {
    await new App(page, page.context()).setOption("newLayout", "false");
});

async function create(page: Page, parentNoteId: string, title: string, type: string, content = "", mime?: string) {
    const created = await api(page, "POST", `/api/notes/${parentNoteId}/children?target=into`,
        { title, type, content, mime }) as { note: { noteId: string } };
    return created.note.noteId;
}

function label(page: Page, noteId: string, name: string, value: string) {
    return api(page, "POST", `/api/notes/${noteId}/attributes`, { type: "label", name, value });
}

/** A message as the awm board writes it: a plain-text note stamped with its sequence, time and sender. */
async function message(page: Page, chat: string, seq: number, from: string, body: string) {
    const noteId = await create(page, chat, `${seq} · ${from.split("@")[1]}`, "code", body, "text/plain");
    await label(page, noteId, "msgSeq", String(seq).padStart(8, "0"));
    await label(page, noteId, "msgAt", `2026-10-14T12:0${seq}:00Z`);
    await label(page, noteId, "msgFrom", from);
    return noteId;
}

function children(page: Page, noteId: string) {
    return page.evaluate(async (noteId) => {
        const froca = (window as unknown as { glob: { froca: { getNote(id: string): Promise<FrocaNote | null> } } }).glob.froca;
        const note = await froca.getNote(noteId);
        return Promise.all((note?.getChildNoteIds() ?? []).map(async id => {
            const child = await froca.getNote(id);
            return { noteId: id, type: child?.type, mime: child?.mime, content: await child?.getContent() };
        }));
    }, noteId);
}

interface FrocaNote {
    type: string;
    mime: string;
    getChildNoteIds(): string[];
    getContent(): Promise<string | undefined>;
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
