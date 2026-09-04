import { afterEach, describe, expect, it } from "vitest";

import slice from "./slice.js";

afterEach(() => {
    (globalThis as any).glob.sliceRootNoteId = undefined;
    (globalThis as any).glob.sliceCanWrite = undefined;
});

describe("slice", () => {
    it("reports no slice when the bootstrap payload named none", () => {
        expect(slice.getSliceRootNoteId()).toBeNull();
        expect(slice.isSlice()).toBe(false);
        expect(slice.defaultRootNoteId()).toBe("root");
    });

    it("reports the slice named by the bootstrap payload", () => {
        (globalThis as any).glob.sliceRootNoteId = "sliceRoot1";

        expect(slice.getSliceRootNoteId()).toBe("sliceRoot1");
        expect(slice.isSlice()).toBe(true);
        expect(slice.defaultRootNoteId()).toBe("sliceRoot1");
    });

    it("treats a link that may not write as read-only, and says nothing is read-only outside a slice", () => {
        (globalThis as any).glob.sliceRootNoteId = "sliceRoot1";
        expect(slice.canWrite()).toBe(false);
        expect(slice.isReadOnly()).toBe(true);

        (globalThis as any).glob.sliceCanWrite = true;
        expect(slice.canWrite()).toBe(true);
        expect(slice.isReadOnly()).toBe(false);

        // Outside a slice the flag means nothing: an ordinary session is not a read-only slice.
        (globalThis as any).glob.sliceRootNoteId = undefined;
        expect(slice.canWrite()).toBe(false);
        expect(slice.isReadOnly()).toBe(false);
    });
});
