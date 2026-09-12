import becca from "@triliumnext/core/src/becca/becca.js";
import BBranch from "@triliumnext/core/src/becca/entities/bbranch.js";
import BNote from "@triliumnext/core/src/becca/entities/bnote.js";
import { buildNote } from "@triliumnext/core/src/test/becca_easy_mocking.js";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sliceMask } from "./slice_mask.js";

const ROOT = "sliceRoot";
const OUTSIDE = "otherNote";

describe("Slice mask", () => {
    beforeEach(() => {
        becca.reset();

        // The vault's own root, so the notes below hang off something the way real ones do.
        new BNote({ noteId: "root", title: "root", type: "text" });
        buildNote({
            id: ROOT,
            title: "Shared",
            children: [
                { id: "inside", title: "Inside", children: [ { id: "deeper", title: "Deeper" } ] },
                { id: "codeInside", title: "Script", type: "code", mime: "application/javascript" }
            ]
        });
        new BBranch({ branchId: "root_sliceRoot", noteId: ROOT, parentNoteId: "root", notePosition: 10 });
        buildNote({ id: OUTSIDE, title: "Elsewhere" });
        new BBranch({ branchId: "root_otherNote", noteId: OUTSIDE, parentNoteId: "root", notePosition: 20 });
    });

    it("leaves a request without slice headers alone, whatever it asks for", () => {
        for (const [ method, path ] of [ [ "DELETE", "/api/notes/inside" ], [ "GET", "/etapi/app-info" ] ]) {
            expect(run({ method, path, headers: {} })).toBe("passed");
        }
    });

    it("serves a note inside the slice and refuses one outside it", () => {
        expect(run({ path: "/api/notes/inside" })).toBe("passed");
        expect(run({ path: `/api/notes/${ROOT}` })).toBe("passed");
        expect(run({ path: "/api/notes/inside/blob" })).toBe("passed");
        expect(run({ path: `/api/notes/${OUTSIDE}` })).toBe(403);
        expect(run({ path: `/api/notes/${OUTSIDE}/blob` })).toBe(403);
        // A note becca has never heard of is not in the slice either.
        expect(run({ path: "/api/notes/ghost" })).toBe(403);
    });

    it("refuses every route the table does not name, which is how it fails closed", () => {
        for (const path of [ "/api/attribute-names", "/api/note-map/inside/backlinks",
                             "/etapi/app-info", "/share/inside", "/custom/anything", "/mcp" ]) {
            expect(run({ path })).toBe(403);
        }
        for (const path of [ "/api/notes/inside/protect/1", "/api/notes/inside/undelete" ]) {
            expect(run({ method: "PUT", path, write: true })).toBe(403);
        }
        for (const path of [ "/api/delete-notes-preview", "/api/notes/erase-deleted-notes-now",
                             "/api/notes/inside/notes-import" ]) {
            expect(run({ method: "POST", path, write: true })).toBe(403);
        }
    });

    it("admits the searches whose handlers confine themselves to the slice", () => {
        // These rules name no note; each handler reads the same edge headers and searches the slice root.
        expect(run({ path: "/api/autocomplete", query: { query: "anything" } })).toBe("passed");
        expect(run({ path: "/api/quick-search/anything" })).toBe("passed");
        expect(run({ path: "/api/search/anything" })).toBe("passed");
        // The vault's note count is a segment away from the autocomplete rule and stays refused, as do
        // the searches that report across the vault.
        expect(run({ path: "/api/autocomplete/notesCount" })).toBe(403);
        expect(run({ path: "/api/search-templates" })).toBe(403);
        expect(run({ method: "POST", path: "/api/search-related", write: true })).toBe(403);
    });

    it("reads a search note, a map and the recent changes only inside the slice", () => {
        expect(run({ path: "/api/search-note/inside" })).toBe("passed");
        expect(run({ path: `/api/search-note/${OUTSIDE}` })).toBe(403);
        expect(run({ method: "POST", path: "/api/note-map/inside/tree" })).toBe("passed");
        expect(run({ method: "POST", path: `/api/note-map/${ROOT}/link` })).toBe("passed");
        expect(run({ method: "POST", path: `/api/note-map/${OUTSIDE}/tree` })).toBe(403);
        // Backlinks exist to report the notes pointing in from outside, so they stay refused.
        expect(run({ path: "/api/note-map/inside/backlinks" })).toBe(403);
        expect(run({ path: `/api/recent-changes/${ROOT}` })).toBe("passed");
        expect(run({ path: "/api/recent-changes/root" })).toBe(403);
    });

    it("refuses the routes that mint and revoke slices, so a link cannot make another link", () => {
        expect(run({ path: `/api/slices/${ROOT}` })).toBe(403);
        expect(run({ path: "/api/slices/inside" })).toBe(403);
        // Refused for being unnamed rather than for being read-only, so a writable link fares no better.
        expect(run({ method: "POST", path: "/api/slices", body: { noteId: "inside" }, write: true })).toBe(403);
        expect(run({ method: "DELETE", path: "/api/slices/sometoken", write: true })).toBe(403);
    });

    it("asks the tree route for a subtree inside the slice, and nothing else", () => {
        expect(run({ path: "/api/tree", query: { subTreeNoteId: ROOT } })).toBe("passed");
        expect(run({ path: "/api/tree", query: { subTreeNoteId: "inside" } })).toBe("passed");
        expect(run({ path: "/api/tree", query: { subTreeNoteId: OUTSIDE } })).toBe(403);
        // No parameter means the slice's own root, the way the route defaults too.
        expect(run({ path: "/api/tree" })).toBe("passed");
    });

    it("narrows a bulk tree load to the ids inside the slice rather than refusing it", () => {
        // The client asks for whatever it has learnt about, and one stale id would otherwise leave
        // the tree empty.
        const mixed = { noteIds: [ "inside", OUTSIDE, ROOT ] };
        expect(run({ method: "POST", path: "/api/tree/load", body: mixed })).toBe("passed");
        expect(mixed.noteIds).toEqual([ "inside", ROOT ]);

        expect(run({ method: "POST", path: "/api/tree/load", body: {} })).toBe(403);
    });

    it("judges an attachment by the note it hangs off", () => {
        // `becca.getAttachment` reads the database rather than the cache, so the owner is stubbed
        // here: what this test is about is which note the mask then checks.
        const owners: Record<string, string> = { att1: "inside", att2: OUTSIDE };
        vi.spyOn(becca, "getAttachment").mockImplementation(
            (attachmentId: string) => (owners[attachmentId] ? { ownerId: owners[attachmentId] } : null) as never);

        expect(run({ path: "/api/attachments/att1/blob" })).toBe("passed");
        expect(run({ path: "/api/attachments/att1/image/pic.png" })).toBe("passed");
        expect(run({ path: "/api/attachments/att2/blob" })).toBe(403);
        expect(run({ path: "/api/attachments/ghost/blob" })).toBe(403);
    });

    it("lets a writable slice edit a note it holds, and refuses a read-only one the same routes", () => {
        for (const path of [ "/api/notes/inside/data", "/api/notes/inside/title",
                             "/api/notes/inside/type", "/api/notes/inside/sort-children" ]) {
            expect(run({ method: "PUT", path, write: true })).toBe("passed");
            expect(run({ method: "PUT", path })).toBe(403);
        }
        expect(run({ method: "PUT", path: `/api/notes/${OUTSIDE}/data`, write: true })).toBe(403);
        // Deleting every clone of a note reaches wherever else the note lives, so a slice deletes
        // branches instead.
        expect(run({ method: "DELETE", path: "/api/notes/inside", write: true })).toBe(403);
    });

    it("creates a note under a parent inside the slice, and nowhere else", () => {
        expect(run({ method: "POST", path: "/api/notes/inside/children", write: true })).toBe("passed");
        expect(run({ method: "POST", path: "/api/notes/inside/children" })).toBe(403);
        expect(run({ method: "POST", path: `/api/notes/${OUTSIDE}/children`, write: true })).toBe(403);

        // A template, and a relation target, are notes the body names on top of the path.
        expect(run({ method: "POST", path: "/api/notes/inside/children", write: true,
                     body: { templateNoteId: "deeper" } })).toBe("passed");
        expect(run({ method: "POST", path: "/api/notes/inside/children", write: true,
                     body: { templateNoteId: OUTSIDE } })).toBe(403);
        expect(run({ method: "POST", path: "/api/notes/inside/children", write: true,
                     body: { attributes: [ { type: "relation", name: "myLink", value: OUTSIDE } ] } })).toBe(403);

        // `before` and `after` land the new note beside a branch, which has to be inside as well.
        expect(run({ method: "POST", path: "/api/notes/inside/children", write: true,
                     query: { target: "after", targetBranchId: "inside_deeper" } })).toBe("passed");
        expect(run({ method: "POST", path: "/api/notes/inside/children", write: true,
                     query: { target: "after", targetBranchId: "root_otherNote" } })).toBe(403);
    });

    it("judges a branch by both notes it joins, so a move cannot cross the boundary", () => {
        expect(run({ method: "PUT", path: "/api/branches/inside_deeper/set-prefix", write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/branches/inside_deeper/expanded/1", write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/branches/root_otherNote/set-prefix", write: true })).toBe(403);
        // The slice root's own branch hangs off a note outside, so it cannot be moved or deleted.
        expect(run({ method: "PUT", path: "/api/branches/root_sliceRoot/set-prefix", write: true })).toBe(403);
        expect(run({ method: "PUT", path: "/api/branches/ghost/set-prefix", write: true })).toBe(403);

        expect(run({ method: "PUT", path: "/api/branches/inside_deeper/move-to/sliceRoot_codeInside",
                     write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/branches/inside_deeper/move-to/root_otherNote",
                     write: true })).toBe(403);

        expect(run({ method: "PUT", path: "/api/branches/set-prefix-batch", write: true,
                     body: { branchIds: [ "inside_deeper", "sliceRoot_inside" ] } })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/branches/set-prefix-batch", write: true,
                     body: { branchIds: [ "inside_deeper", "root_otherNote" ] } })).toBe(403);
    });

    it("deletes a branch inside the slice, but never erases and never the note the link opens", () => {
        expect(run({ method: "DELETE", path: "/api/branches/inside_deeper", write: true,
                     query: { taskId: "t1" } })).toBe("passed");
        expect(run({ method: "DELETE", path: "/api/branches/inside_deeper", query: { taskId: "t1" } })).toBe(403);
        expect(run({ method: "DELETE", path: "/api/branches/inside_deeper", write: true,
                     query: { taskId: "t1", eraseNotes: "true" } })).toBe(403);
        expect(run({ method: "DELETE", path: "/api/branches/root_sliceRoot", write: true,
                     query: { taskId: "t1" } })).toBe(403);
    });

    it("clones and duplicates only between notes the slice holds", () => {
        expect(run({ method: "PUT", path: "/api/notes/deeper/clone-to-note/codeInside", write: true })).toBe("passed");
        expect(run({ method: "PUT", path: `/api/notes/deeper/clone-to-note/${OUTSIDE}`, write: true })).toBe(403);
        expect(run({ method: "PUT", path: "/api/notes/deeper/clone-to-branch/sliceRoot_codeInside",
                     write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/notes/deeper/clone-to-branch/root_otherNote", write: true })).toBe(403);
        expect(run({ method: "POST", path: "/api/notes/deeper/duplicate/codeInside", write: true })).toBe("passed");
        expect(run({ method: "POST", path: `/api/notes/deeper/duplicate/${OUTSIDE}`, write: true })).toBe(403);
    });

    it("sets an attribute inside the slice, and refuses one that would run code", () => {
        const label = { type: "label", name: "colour", value: "red" };
        for (const path of [ "/api/notes/inside/attributes", "/api/notes/inside/attribute",
                             "/api/notes/inside/set-attribute" ]) {
            expect(run({ method: "PUT", path, body: label, write: true })).toBe("passed");
            expect(run({ method: "PUT", path, body: label })).toBe(403);
        }
        expect(run({ method: "POST", path: "/api/notes/inside/attributes", body: label, write: true })).toBe("passed");
        expect(run({ method: "DELETE", path: "/api/notes/inside/attributes/attr1", write: true })).toBe("passed");

        // A relation may only point at a note the slice holds.
        expect(run({ method: "PUT", path: "/api/notes/inside/attribute", write: true,
                     body: { type: "relation", name: "myLink", value: "deeper" } })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/notes/inside/attribute", write: true,
                     body: { type: "relation", name: "myLink", value: OUTSIDE } })).toBe(403);
        expect(run({ method: "PUT", path: "/api/notes/inside/relations/myLink/to/deeper",
                     write: true })).toBe("passed");
        expect(run({ method: "PUT", path: `/api/notes/inside/relations/myLink/to/${OUTSIDE}`,
                     write: true })).toBe(403);

        // The executable ones, on every shape of body the attribute routes take.
        expect(run({ method: "PUT", path: "/api/notes/inside/attribute", write: true,
                     body: { type: "label", name: "run", value: "frontendStartup" } })).toBe(403);
        expect(run({ method: "PUT", path: "/api/notes/inside/attributes", write: true,
                     body: [ label, { type: "relation", name: "widget", value: "deeper" } ] })).toBe(403);
        expect(run({ method: "PUT", path: "/api/notes/inside/relations/script/to/deeper",
                     write: true })).toBe(403);
        // Taking one off is always allowed: it can only make the vault safer.
        expect(run({ method: "DELETE", path: "/api/notes/inside/relations/script/to/deeper",
                     write: true })).toBe("passed");
    });

    it("judges a revision by the note it belongs to", () => {
        vi.spyOn(becca, "getRevision").mockImplementation(
            (revisionId: string) => (revisionId === "rev1" ? { noteId: "inside" }
                : revisionId === "rev2" ? { noteId: OUTSIDE } : null) as never);

        expect(run({ path: "/api/revisions/rev1" })).toBe("passed");
        expect(run({ path: "/api/revisions/rev2" })).toBe(403);
        expect(run({ path: "/api/notes/inside/revisions" })).toBe("passed");
        expect(run({ method: "POST", path: "/api/revisions/rev1/restore", write: true })).toBe("passed");
        expect(run({ method: "POST", path: "/api/revisions/rev1/restore" })).toBe(403);
        expect(run({ method: "PATCH", path: "/api/revisions/rev1", write: true })).toBe("passed");
        expect(run({ method: "DELETE", path: "/api/revisions/rev2", write: true })).toBe(403);
        // Trimming every note's revisions at once is not one note's business.
        expect(run({ method: "POST", path: "/api/revisions/erase-all-excess-revisions", write: true })).toBe(403);
    });

    it("writes an attachment through the note it hangs off", () => {
        const owners: Record<string, string> = { att1: "inside", att2: OUTSIDE };
        vi.spyOn(becca, "getAttachment").mockImplementation(
            (attachmentId: string) => (owners[attachmentId] ? { ownerId: owners[attachmentId] } : null) as never);

        expect(run({ method: "POST", path: "/api/notes/inside/attachments", write: true })).toBe("passed");
        expect(run({ method: "POST", path: "/api/notes/inside/attachments/upload", write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/attachments/att1/rename", write: true })).toBe("passed");
        expect(run({ method: "DELETE", path: "/api/attachments/att1", write: true })).toBe("passed");
        expect(run({ method: "DELETE", path: "/api/attachments/att1" })).toBe(403);
        expect(run({ method: "DELETE", path: "/api/attachments/att2", write: true })).toBe(403);
    });

    it("lets a writable slice edit a note of any type it holds", () => {
        expect(run({ path: "/api/notes/codeInside" })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/notes/codeInside/data", write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/notes/codeInside/data" })).toBe(403);
    });

    it("passes the application shell through and refuses to be written to around it", () => {
        expect(run({ path: "/" })).toBe("passed");
        expect(run({ path: "/assets/app.js" })).toBe("passed");
        expect(run({ path: "/bootstrap" })).toBe("passed");
        expect(run({ method: "POST", path: "/anything" })).toBe(403);
    });
});

/** Runs the mask and reports what it did: `"passed"` for `next()`, otherwise the refusal status. */
function run({ method = "GET", path, query = {}, body = {}, write = false, headers }: {
    method?: string;
    path: string;
    query?: Record<string, string>;
    body?: object;
    write?: boolean;
    headers?: Record<string, string>;
}) {
    const req = {
        method,
        path,
        query,
        body,
        headers: headers ?? {
            "x-awm-slice-root": ROOT,
            "x-awm-slice-user": "steven",
            "x-awm-slice-write": write ? "1" : "0"
        }
    } as unknown as Request;

    let status: number | undefined;
    const res = {
        status(code: number) {
            status = code;
            return this;
        },
        json: vi.fn()
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;
    sliceMask(req, res, next);
    return status ?? ((next as unknown as { mock: { calls: unknown[] } }).mock.calls.length ? "passed" : "nothing");
}
