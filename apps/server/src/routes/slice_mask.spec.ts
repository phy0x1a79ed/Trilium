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
                { id: "inside", title: "Inside" },
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
        for (const path of [ "/api/notes/inside/revisions", "/api/search/anything", "/api/autocomplete",
                             "/api/note-map/inside/backlinks", "/etapi/app-info",
                             "/share/inside", "/custom/anything", "/mcp" ]) {
            expect(run({ path })).toBe(403);
        }
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
        // No parameter means the whole tree from `root`, which is outside every slice.
        expect(run({ path: "/api/tree" })).toBe(403);
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

    it("lets a writable slice edit a body, and nothing else about the note", () => {
        expect(run({ method: "PUT", path: "/api/notes/inside/data", write: true })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/notes/inside/data" })).toBe(403);
        expect(run({ method: "PUT", path: `/api/notes/${OUTSIDE}/data`, write: true })).toBe(403);
        for (const path of [ "/api/notes/inside/title", "/api/notes/inside/type", "/api/notes/inside/attribute" ]) {
            expect(run({ method: "PUT", path, write: true })).toBe(403);
        }
        expect(run({ method: "DELETE", path: "/api/notes/inside", write: true })).toBe(403);
    });

    it("refuses a write to anything that is not prose, even inside the slice", () => {
        expect(run({ path: "/api/notes/codeInside" })).toBe("passed");
        expect(run({ method: "PUT", path: "/api/notes/codeInside/data", write: true })).toBe(403);
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
