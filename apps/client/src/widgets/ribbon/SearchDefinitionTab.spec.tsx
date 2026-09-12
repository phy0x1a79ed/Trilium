import { beforeEach, describe, expect, it, vi } from "vitest";

import slice from "../../services/slice";
import { offeredSearchOptions } from "./SearchDefinitionTab";
import { SEARCH_OPTIONS } from "./SearchDefinitionOptions";

describe("offeredSearchOptions", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("offers every option outside a slice", () => {
        expect(offeredSearchOptions()).toBe(SEARCH_OPTIONS);
    });

    it("drops the script option in a slice and starts the rest at the note the link opens", () => {
        vi.spyOn(slice, "isSlice").mockReturnValue(true);
        vi.spyOn(slice, "defaultRootNoteId").mockReturnValue("sliceRoot");

        const offered = offeredSearchOptions();

        expect(offered.map((option) => option.attributeName)).not.toContain("searchScript");
        const ancestor = offered.find((option) => option.attributeName === "ancestor");
        expect(ancestor?.defaultValue).toBe("sliceRoot");
        // Every option that names no note keeps the default it has.
        expect(offered.find((option) => option.attributeName === "searchString")?.defaultValue).toBeUndefined();
    });
});
