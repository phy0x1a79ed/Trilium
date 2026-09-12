import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import type BRevision from "../becca/entities/brevision.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import {
    attributesInBody,
    isDangerousAttribute,
    isNoteInSlice,
    noteIdOfRevision,
    noteIdsInBody,
    noteIdsOfBranch,
    readSliceContext
} from "./slice.js";

const ROOT = "sliceRoot";
const OUTSIDE = "otherNote";

describe("Slice boundary", () => {
    beforeEach(() => {
        becca.reset();

        new BNote({ noteId: "root", title: "root", type: "text" });
        buildNote({ id: ROOT, title: "Shared", children: [ { id: "inside", title: "Inside" } ] });
        new BBranch({ branchId: "root_sliceRoot", noteId: ROOT, parentNoteId: "root", notePosition: 10 });
        buildNote({ id: OUTSIDE, title: "Elsewhere" });
        new BBranch({ branchId: "root_otherNote", noteId: OUTSIDE, parentNoteId: "root", notePosition: 20 });
    });

    it("reads the edge's headers, and reports ordinary traffic as no slice at all", () => {
        expect(readSliceContext({ "x-awm-slice-root": ROOT, "x-awm-slice-user": "steven", "x-awm-slice-write": "1" }))
            .toEqual({ rootNoteId: ROOT, user: "steven", canWrite: true });
        expect(readSliceContext({ "x-awm-slice-root": ROOT })).toEqual({ rootNoteId: ROOT, user: null, canWrite: false });
        expect(readSliceContext({})).toBe(null);
    });

    it("places the root, its descendants, and nothing else", () => {
        expect(isNoteInSlice(ROOT, ROOT)).toBe(true);
        expect(isNoteInSlice("inside", ROOT)).toBe(true);
        expect(isNoteInSlice(OUTSIDE, ROOT)).toBe(false);
        expect(isNoteInSlice("ghost", ROOT)).toBe(false);
    });

    it("resolves a branch to both notes it joins, and an unknown branch to nothing", () => {
        expect(noteIdsOfBranch(`${ROOT}_inside`)).toEqual([ "inside", ROOT ]);
        expect(noteIdsOfBranch("root_sliceRoot")).toEqual([ ROOT, "root" ]);
        expect(noteIdsOfBranch("ghost_branch")).toBe(null);
    });

    it("resolves a revision to the note it belongs to, and an unknown revision to nothing", () => {
        vi.spyOn(becca, "getRevision").mockImplementation(
            (revisionId) => revisionId === "rev1" ? ({ noteId: "inside" } as BRevision) : null);

        expect(noteIdOfRevision("rev1")).toBe("inside");
        expect(noteIdOfRevision("rev2")).toBe(null);
    });

    it("reads attributes out of a bare body and out of an array alike", () => {
        expect(attributesInBody({ type: "label", name: "colour", value: "red" }))
            .toEqual([ { type: "label", name: "colour", value: "red" } ]);
        expect(attributesInBody([ { type: "label", name: "a" }, { type: "relation", name: "b", value: OUTSIDE } ]))
            .toEqual([ { type: "label", name: "a", value: "" }, { type: "relation", name: "b", value: OUTSIDE } ]);
        expect(attributesInBody({ content: "no attribute here" })).toEqual([]);
        expect(attributesInBody(null)).toEqual([]);
    });

    it("reads the attributes a create body sets atomically alongside the new note", () => {
        expect(attributesInBody({ title: "New", attributes: [ { type: "label", name: "run", value: "frontendStartup" } ] }))
            .toEqual([ { type: "label", name: "run", value: "frontendStartup" } ]);
        expect(noteIdsInBody({ title: "New", attributes: [ { type: "relation", name: "template", value: OUTSIDE } ] }))
            .toEqual([ OUTSIDE ]);
    });

    it("names an attribute that would run code in the owner's browser", () => {
        expect(isDangerousAttribute("label", "run")).toBe(true);
        expect(isDangerousAttribute("label", "  WiDgEt ")).toBe(true);
        expect(isDangerousAttribute("relation", "script")).toBe(true);
        expect(isDangerousAttribute("label", "colour")).toBe(false);
        expect(isDangerousAttribute("relation", "template")).toBe(false);
    });

    it("collects the notes a write body names beyond its path", () => {
        expect(noteIdsInBody({ title: "New", templateNoteId: OUTSIDE })).toEqual([ OUTSIDE ]);
        expect(noteIdsInBody({ type: "relation", name: "myLink", value: "inside" })).toEqual([ "inside" ]);
        expect(noteIdsInBody({ type: "relation", name: "myLink", value: "  " })).toEqual([]);
        expect(noteIdsInBody({ type: "label", name: "colour", value: "red" })).toEqual([]);
        expect(noteIdsInBody({ title: "New" })).toEqual([]);
    });
});
