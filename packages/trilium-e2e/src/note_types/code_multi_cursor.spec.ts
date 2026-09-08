import { expect, Page, test } from "@playwright/test";
import App from "../support/app";

/**
 * Creates a throwaway backend-script note and opens it, so a case can rewrite the content without
 * disturbing the fixture notes the rest of the suite asserts on.
 */
async function openWith(app: App, text: string) {
    await app.goto();
    await app.closeAllTabs();

    const noteId = await app.page.evaluate(async (content: string) => {
        const response = await fetch("/api/notes/root/children?target=into", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-csrf-token": (window as any).glob.csrfToken
            },
            body: JSON.stringify({
                title: `Multi-cursor scratch ${Date.now()}`,
                type: "code",
                mime: "application/javascript;env=backend",
                content
            })
        });
        const { note } = await response.json();
        return note.noteId as string;
    }, text);

    await app.page.evaluate((id: string) => { window.location.hash = `#root/${id}`; }, noteId);

    const editor = app.currentNoteSplit.locator(".cm-editor");
    await expect(editor.locator(".cm-content")).toBeVisible();
    // Wait on the editor's own document rather than the rendered lines: the split still shows the
    // previous note for a frame or two after the hash changes.
    await expect.poll(() => documentText(app.page)).toBe(text);
    await editor.locator(".cm-content").click();
    await expect(editor).toHaveClass(/cm-focused/);
    await app.page.keyboard.press("ControlOrMeta+Home");
    return editor;
}

/** Records every command the app dispatches, so a shortcut can be checked at its destination. */
function recordCommands(page: Page) {
    return page.evaluate(() => {
        const appContext = (window as any).glob.appContext;
        const trigger = appContext.triggerCommand.bind(appContext);
        (window as any).__commands = [];
        appContext.triggerCommand = (name: string, data: unknown) => {
            (window as any).__commands.push(name);
            return trigger(name, data);
        };
    });
}

function commands(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as any).__commands);
}

function documentText(page: Page) {
    return page.evaluate(async () => {
        const context = (window as any).glob.appContext.tabManager.getActiveContext();
        const editor = await context.getCodeEditor();
        return editor.getText();
    });
}

/** Reads the live selection out of the editor, which is the contract the drawn carets stand for. */
function selectionRanges(page: Page) {
    return page.evaluate(async () => {
        const context = (window as any).glob.appContext.tabManager.getActiveContext();
        const editor = await context.getCodeEditor();
        type Range = { from: number, to: number };
        return editor.state.selection.ranges.map(({ from, to }: Range) => [ from, to ]);
    });
}

/** The painted color of the drawn selection layer, which replaces the browser's own. */
function selectionColor(page: Page) {
    return page.evaluate(() => {
        const split = ".note-split:not(.hidden-ext)";
        const layer = document.querySelector(`${split} .cm-selectionBackground`);
        return layer && getComputedStyle(layer).backgroundColor;
    });
}

test("Places several cursors and edits at each of them", async ({ page, context }) => {
    const app = new App(page, context);
    const editor = await openWith(app, "alpha\nalpha\nalpha");

    // Ctrl+Alt+Down is bound by CodeMirror's defaultKeymap; the caret it adds only survives the
    // transaction with allowMultipleSelections on, and is only drawn by drawSelection.
    await page.keyboard.press("Control+Alt+ArrowDown");
    expect(await selectionRanges(page)).toHaveLength(2);
    await expect(editor.locator(".cm-cursor-secondary")).toHaveCount(1);

    await page.keyboard.press("Escape");
    expect(await selectionRanges(page)).toHaveLength(1);
});

test("Types at every caret at once", async ({ page, context }) => {
    const app = new App(page, context);
    const editor = await openWith(app, "alpha\nalpha\nalpha");

    await page.keyboard.press("Control+Alt+ArrowDown");
    await page.keyboard.type("X");
    await expect(editor.locator(".cm-content")).toHaveText(/XalphaXalphaalpha/);
});

test("Adds and removes a caret with Alt+Click", async ({ page, context }) => {
    const app = new App(page, context);
    const editor = await openWith(app, "alpha\nbeta\ngamma");

    await editor.locator(".cm-line").nth(2).click({ modifiers: [ "Alt" ] });
    expect(await selectionRanges(page)).toHaveLength(2);

    await editor.locator(".cm-line").nth(2).click({ modifiers: [ "Alt" ] });
    expect(await selectionRanges(page)).toHaveLength(1);
});

test("Grows the selection onto the next occurrence with Ctrl+D", async ({ page, context }) => {
    const app = new App(page, context);
    await openWith(app, "alpha\nalpha\nalpha");

    await page.keyboard.press("Shift+End");
    await page.keyboard.press("ControlOrMeta+d");
    expect(await selectionRanges(page)).toEqual([ [ 0, 5 ], [ 6, 11 ] ]);

    await page.keyboard.press("ControlOrMeta+d");
    expect(await selectionRanges(page)).toHaveLength(3);
});

test("Selects every occurrence at once with Ctrl+Shift+L", async ({ page, context }) => {
    const app = new App(page, context);
    await openWith(app, "alpha\nalpha\nalpha");

    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Shift+ControlOrMeta+l");
    expect(await selectionRanges(page)).toHaveLength(3);
});

test("Folds the block at the cursor with Ctrl+Shift+[", async ({ page, context }) => {
    const app = new App(page, context);
    const editor = await openWith(app, "function f() {\n    return 1;\n}");

    await page.keyboard.press("Control+Shift+BracketLeft");
    await expect(editor.locator(".cm-foldPlaceholder")).toHaveCount(1);

    await page.keyboard.press("Control+Shift+BracketRight");
    await expect(editor.locator(".cm-foldPlaceholder")).toHaveCount(0);
});

test("Leaves the app's own Alt chords to the app", async ({ page, context }) => {
    const app = new App(page, context);
    await openWith(app, "alpha\nbeta\ngamma");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const before = await selectionRanges(page);
    await recordCommands(page);

    // CodeMirror's stock keymaps claim all four for cursorSyntaxLeft/Right, selectLine and
    // redoSelection; each one sits on a documented Trilium shortcut, so the editor has to let go.
    for (const [ chord, command ] of [
        [ "Alt+ArrowLeft", "backInNoteHistory" ],
        [ "Alt+ArrowRight", "forwardInNoteHistory" ],
        [ "Alt+l", "addNewLabel" ],
        [ "Alt+u", "unhoist" ]
    ]) {
        await page.keyboard.press(chord);
        await expect.poll(() => commands(page)).toContain(command);
        expect(await selectionRanges(page)).toEqual(before);
    }
});

test("Paints the drawn selection in the app's palette and a theme's", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.setOption("codeNoteThemeMatchesApp", "false");
    try {
        // drawSelection replaces the browser's painting of the selection, which takes the app's
        // `::selection` rule out of play — so the drawn layer needs a color of its own.
        await app.setOption("codeNoteTheme", "default:default");
        await openWith(app, "alpha\nalpha");
        await page.keyboard.press("Shift+End");
        expect(await selectionColor(page)).not.toBe("rgba(0, 0, 0, 0)");

        await app.setOption("codeNoteTheme", "default:vs-code-dark");
        await openWith(app, "alpha\nalpha");
        await page.keyboard.press("Shift+End");
        expect(await selectionColor(page)).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
        await app.setOption("codeNoteThemeMatchesApp", "true");
    }
});

test("Drops back to a single caret when the option is off", async ({ page, context }) => {
    const app = new App(page, context);
    await app.goto();
    await app.setOption("codeNoteMultiCursorEnabled", "false");
    try {
        const editor = await openWith(app, "alpha\nalpha");

        await page.keyboard.press("Control+Alt+ArrowDown");
        expect(await selectionRanges(page)).toHaveLength(1);
        // With drawSelection gone the browser paints the selection again, so no caret is drawn.
        await expect(editor.locator(".cm-cursor-secondary")).toHaveCount(0);
    } finally {
        await app.setOption("codeNoteMultiCursorEnabled", "true");
    }
});
