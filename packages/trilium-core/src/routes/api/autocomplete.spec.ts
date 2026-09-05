import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as cls from "../../services/context";
import hoistedNoteService from "../../services/hoisted_note";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core autocomplete routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface AutocompleteResult {
    notePath: string;
    noteTitle: string;
    notePathTitle: string;
    highlightedNotePathTitle: string;
    icon: string;
}

describe("Autocomplete API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("getAutocomplete", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("returns matching notes for a search query", async () => {
            const title = `Autocomplete target ${Date.now()}`;
            await createTextNote(api, { title });

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: title }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);

            const match = res.body.find((r) => r.noteTitle === title);
            expect(match).toBeTruthy();
            expect(match?.notePath).toBeTruthy();
            expect(typeof match?.highlightedNotePathTitle).toBe("string");
            expect(match?.icon).toBeTruthy();
        });

        it("returns recent notes for an empty query", async () => {
            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("filters recent notes by the hoisted note path when not hoisted to root", async () => {
            // Exercises the `hoistedNoteId !== "root"` branch (extra LIKE condition).
            const { noteId } = await createTextNote(api, { title: "Hoisted recent" });
            await api.post("/api/recent-notes", { body: { noteId, notePath: `root/${noteId}` } });
            vi.spyOn(cls, "getHoistedNoteId").mockReturnValue(noteId);

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("logs a warning when the search is slow", async () => {
            // Force the elapsed-time threshold so the slow-autocomplete log branch runs.
            let calls = 0;
            vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? 0 : 1000));

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "root" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("honours the fastSearch flag", async () => {
            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "root", fastSearch: "false" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("400s when the query param is missing", async () => {
            const res = await api.get("/api/autocomplete");
            expect(res.status).toBe(400);
        });
    });

    describe("inside a public slice", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("offers the slice's own subtree and nothing else, whatever the client claims to hoist", async () => {
            const shape = await buildNestedSlice(api);
            const headers = sliceHeaders(shape.sliceRootNoteId);

            // The hoisted note reaches the vault through a client header, so a slice cannot take
            // its scope from it: the whole vault is claimed here and the answer is unchanged.
            vi.spyOn(hoistedNoteService, "getHoistedNoteId").mockReturnValue("root");

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: shape.stamp }, headers
            });
            expect(res.status).toBe(200);

            const offered = res.body.map((r) => r.noteTitle);
            expect(offered).toEqual(expect.arrayContaining([ shape.titles.sliceRoot, shape.titles.child,
                                                             shape.titles.clonedChild ]));
            for (const absent of [ shape.titles.outer, shape.titles.middle, shape.titles.elsewhere ]) {
                expect(offered).not.toContain(absent);
            }

            // A note cloned outside the slice has a shorter path through the clone. What is offered
            // is the path inside the slice, which is the only one the visitor can open.
            for (const result of res.body) {
                expect(result.notePath.split("/")).toContain(shape.sliceRootNoteId);
            }
        });

        it("searches the whole vault for a request that carries no slice headers", async () => {
            const shape = await buildNestedSlice(api);

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: shape.stamp }
            });
            expect(res.status).toBe(200);
            expect(res.body.map((r) => r.noteTitle)).toContain(shape.titles.outer);
        });

        it("searches the slice's content when the client asks for a slow search", async () => {
            const shape = await buildNestedSlice(api);

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: shape.stamp, fastSearch: "false" },
                headers: sliceHeaders(shape.sliceRootNoteId)
            });
            expect(res.status).toBe(200);
            expect(res.body.map((r) => r.noteTitle)).toContain(shape.titles.child);
            expect(res.body.map((r) => r.noteTitle)).not.toContain(shape.titles.elsewhere);
        });

        it("answers an empty query with the recent notes that lie inside the slice", async () => {
            const shape = await buildNestedSlice(api);
            for (const [ noteId, notePath ] of [
                [ shape.childNoteId, `root/${shape.outerNoteId}/${shape.middleNoteId}/${shape.sliceRootNoteId}/${shape.childNoteId}` ],
                [ shape.elsewhereNoteId, `root/${shape.elsewhereNoteId}` ]
            ]) {
                await api.post("/api/recent-notes", { body: { noteId, notePath } });
            }

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "" }, headers: sliceHeaders(shape.sliceRootNoteId)
            });
            expect(res.status).toBe(200);

            const paths = res.body.map((r) => r.notePath);
            expect(paths.some((path) => path.endsWith(shape.childNoteId))).toBe(true);
            expect(paths.some((path) => path.endsWith(shape.elsewhereNoteId))).toBe(false);
        });
    });

    describe("getNotesCount", () => {
        it("returns the count of non-deleted notes as a number", async () => {
            const before = await api.get<number>("/api/autocomplete/notesCount");
            expect(before.status).toBe(200);
            expect(typeof before.body).toBe("number");
            expect(before.body).toBeGreaterThan(0);

            await createTextNote(api, { title: "Counts towards total" });

            const after = await api.get<number>("/api/autocomplete/notesCount");
            expect(after.status).toBe(200);
            expect(after.body).toBeGreaterThan(before.body);
        });
    });
});

/** The headers the awm edge puts on every request it forwards for a slice link. */
function sliceHeaders(rootNoteId: string) {
    return {
        "x-awm-slice-root": rootNoteId,
        "x-awm-slice-user": "steven",
        "x-awm-slice-write": "1"
    };
}

/**
 * `root > outer > middle > sliceRoot`, with `sliceRoot` and one of its children also cloned under
 * `elsewhere` — a subtree the slice holds by one branch and the vault by another. Every title
 * carries the same stamp, so one query matches all six and only the boundary decides what returns.
 */
async function buildNestedSlice(api: CoreApiTester) {
    const stamp = `slicesearch${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const titles = {
        outer: `${stamp} outer`,
        middle: `${stamp} middle`,
        sliceRoot: `${stamp} shared`,
        child: `${stamp} child`,
        clonedChild: `${stamp} cloned child`,
        elsewhere: `${stamp} elsewhere`
    };

    const outer = await createTextNote(api, { title: titles.outer });
    const middle = await createTextNote(api, { parentNoteId: outer.noteId, title: titles.middle });
    const sliceRoot = await createTextNote(api, { parentNoteId: middle.noteId, title: titles.sliceRoot });
    const child = await createTextNote(api, { parentNoteId: sliceRoot.noteId, title: titles.child });
    const clonedChild = await createTextNote(api, { parentNoteId: sliceRoot.noteId, title: titles.clonedChild });
    const elsewhere = await createTextNote(api, { title: titles.elsewhere });

    for (const noteId of [ sliceRoot.noteId, clonedChild.noteId ]) {
        await api.put(`/api/notes/${noteId}/clone-to-note/${elsewhere.noteId}`, { body: {} });
    }

    return {
        stamp,
        titles,
        outerNoteId: outer.noteId,
        middleNoteId: middle.noteId,
        sliceRootNoteId: sliceRoot.noteId,
        childNoteId: child.noteId,
        elsewhereNoteId: elsewhere.noteId
    };
}
