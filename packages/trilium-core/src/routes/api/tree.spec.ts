import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core tree routes through the in-process {@link CoreApiTester}
 * (no Express / HTTP server), so this same spec runs under both the node
 * (better-sqlite3) and standalone (sql.js WASM) suites against the seeded demo DB.
 */
let api: CoreApiTester;

interface TreeResponse {
    notes: { noteId: string }[];
    branches: { branchId: string }[];
    attributes: unknown[];
}

describe("Tree API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns notes, branches and attributes rooted at root", async () => {
        const res = await api.get<TreeResponse>("/api/tree");

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.notes)).toBe(true);
        expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
        // root always gets the synthetic `none_root` branch (parentNoteId "none").
        expect(res.body.branches.some((b) => b.branchId === "none_root")).toBe(true);
    });

    it("scopes the tree to a subtree via subTreeNoteId", async () => {
        const res = await api.get<TreeResponse>("/api/tree", {
            query: { subTreeNoteId: "_hidden" }
        });
        expect(res.status).toBe(200);
        expect(res.body.notes.some((n) => n.noteId === "_hidden")).toBe(true);
    });

    it("404s for an unknown subtree note", async () => {
        const res = await api.get("/api/tree", { query: { subTreeNoteId: "doesNotExist123" } });
        expect(res.status).toBe(404);
    });

    it("loads an explicit set of note ids", async () => {
        const res = await api.post<TreeResponse>("/api/tree/load", {
            body: { noteIds: [ "root" ] }
        });
        expect(res.status).toBe(200);
        expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
    });

    describe("edge cases", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("skips requested note ids that are not in the cache", async () => {
            // Hits the `if (!note) continue` guard while still returning the valid ones.
            const res = await api.post<TreeResponse>("/api/tree/load", {
                body: { noteIds: [ "root", "doesNotExist123" ] }
            });
            expect(res.status).toBe(200);
            expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
            expect(res.body.notes.some((n) => n.noteId === "doesNotExist123")).toBe(false);
        });

        it("skips a collected branch id that is missing from the cache", async () => {
            // Force a dangling branchId into the collection (via the child-branch
            // lookup in collectEntityIds) so the `becca.branches[branchId]` lookup
            // misses and the guard runs. Use `load` so getTree's own collect()
            // recursion (which needs a real childNote) isn't affected.
            const original = becca.getBranchFromChildAndParent.bind(becca);
            vi.spyOn(becca, "getBranchFromChildAndParent").mockImplementation((childNoteId, parentNoteId) => {
                const branch = original(childNoteId, parentNoteId);
                if (branch) {
                    Object.defineProperty(branch, "branchId", { value: "ghostBranch123", configurable: true });
                }
                return branch;
            });

            const res = await api.post<TreeResponse>("/api/tree/load", { body: { noteIds: [ "root" ] } });
            expect(res.status).toBe(200);
            expect(res.body.branches.some((b) => b.branchId === "ghostBranch123")).toBe(false);
        });

        it("skips a collected attribute id that is missing from the cache", async () => {
            const { noteId } = await createTextNote(api, { title: "Note with ghost attribute" });
            const note = becca.notes[noteId];
            // Replace the note's owned attributes with one whose id is absent from becca.attributes.
            vi.spyOn(note, "ownedAttributes", "get").mockReturnValue([
                { attributeId: "ghostAttr123", type: "label", name: "x", targetNote: undefined } as never
            ]);

            const res = await api.post<TreeResponse>("/api/tree/load", { body: { noteIds: [ noteId ] } });
            expect(res.status).toBe(200);
            const attrs = res.body.attributes as { attributeId?: string }[];
            expect(attrs.some((a) => a.attributeId === "ghostAttr123")).toBe(false);
        });
    });

    describe("inside a public slice", () => {
        it("sends the shared subtree, a bare root to hang it from, and nothing else", async () => {
            const shape = await buildNestedShape();
            const res = await api.get<TreeResponse>("/api/tree", {
                query: { subTreeNoteId: shape.sliceRoot },
                headers: { "x-awm-slice-root": shape.sliceRoot }
            });

            expect(res.status).toBe(200);

            const noteIds = res.body.notes.map((note) => note.noteId).sort();
            expect(noteIds).toEqual([ "root", shape.child, shape.clonedChild, shape.sliceRoot ].sort());

            // `root` is there only to hang the shared note from, so the branch that does it must
            // arrive with it: `froca.addResp` drops a cached note's child branches before re-adding.
            const branches = res.body.branches as BranchRowLike[];
            expect(branches.some((branch) => branch.branchId === "none_root")).toBe(true);
            const synthetic = branches.find((branch) => branch.noteId === shape.sliceRoot);
            expect(synthetic).toMatchObject({ parentNoteId: "root", isExpanded: true });

            // No branch names a parent the slice does not hold, so the clone's other parent is gone.
            const parents = new Set(branches.map((branch) => branch.parentNoteId));
            expect(parents).toEqual(new Set([ "none", "root", shape.sliceRoot ]));
        });

        it("refuses a subtree outside the slice and drops an outside id from a bulk load", async () => {
            const shape = await buildNestedShape();

            const refused = await api.get("/api/tree", {
                query: { subTreeNoteId: shape.outer },
                headers: { "x-awm-slice-root": shape.sliceRoot }
            });
            expect(refused.status).toBe(403);

            const loaded = await api.post<TreeResponse>("/api/tree/load", {
                body: { noteIds: [ shape.child, shape.elsewhere, "root" ] },
                headers: { "x-awm-slice-root": shape.sliceRoot }
            });
            expect(loaded.status).toBe(200);
            const noteIds = loaded.body.notes.map((note) => note.noteId);
            expect(noteIds).toContain(shape.child);
            expect(noteIds).not.toContain(shape.elsewhere);
            expect(noteIds).not.toContain(shape.outer);
        });
    });
});

interface BranchRowLike {
    branchId: string;
    noteId: string;
    parentNoteId: string;
    isExpanded?: boolean;
}

/**
 * `root > outer > middle > sliceRoot`, with `sliceRoot` and one of its two children each cloned
 * under `elsewhere` — the shape the tree route used to answer with the whole vault.
 */
async function buildNestedShape() {
    const outer = (await createTextNote(api, { title: "slice outer" })).noteId;
    const middle = (await createTextNote(api, { parentNoteId: outer, title: "slice middle" })).noteId;
    const sliceRoot = (await createTextNote(api, { parentNoteId: middle, title: "slice root" })).noteId;
    const child = (await createTextNote(api, { parentNoteId: sliceRoot, title: "slice child" })).noteId;
    const clonedChild = (await createTextNote(api, { parentNoteId: sliceRoot, title: "slice cloned child" })).noteId;
    const elsewhere = (await createTextNote(api, { title: "slice elsewhere" })).noteId;

    await api.put(`/api/notes/${sliceRoot}/clone-to-note/${elsewhere}`, { body: {} });
    await api.put(`/api/notes/${clonedChild}/clone-to-note/${elsewhere}`, { body: {} });

    return { outer, middle, sliceRoot, child, clonedChild, elsewhere };
}
