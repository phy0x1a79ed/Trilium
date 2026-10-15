import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import type { BoardCard, ColumnMap } from "./data";
import { type BoardChipFilter, filterColumns, hasFilter, matchesFilters, readFilters, toggleFilter } from "./filters";

describe("Board filters", () => {
    buildNote({
        title: "Board",
        children: [
            { id: "chipA", title: "A", "#owner": "tony", "#project": "factorio" },
            { id: "chipB", title: "B", "#owner": "tony", "#project": "altair" },
            { id: "chipC", title: "C", "#owner": "ana" }
        ]
    });
    const owner = (value: string): BoardChipFilter => ({ name: "owner", value });
    const project = (value: string): BoardChipFilter => ({ name: "project", value });

    function note(id: string) {
        const found = froca.getNoteFromCache(id);
        if (!found) throw new Error(`note ${id} is not in froca`);
        return found;
    }

    it("matches a card only when every filter holds", () => {
        expect(matchesFilters(note("chipA"), [])).toBe(true);
        expect(matchesFilters(note("chipA"), [ owner("tony") ])).toBe(true);
        expect(matchesFilters(note("chipC"), [ owner("tony") ])).toBe(false);
        expect(matchesFilters(note("chipA"), [ owner("tony"), project("factorio") ])).toBe(true);
        expect(matchesFilters(note("chipB"), [ owner("tony"), project("factorio") ])).toBe(false);
        expect(matchesFilters(note("chipC"), [ project("factorio") ])).toBe(false);
    });

    it("narrows every column but keeps the ones left empty", () => {
        const card = (id: string): BoardCard => ({
            note: note(id),
            branch: new FBranch(froca, { branchId: `b_${id}`, noteId: id, parentNoteId: "root", notePosition: 10, fromSearchNote: false }),
            path: ""
        });
        const byColumn: ColumnMap = new Map([
            [ "To Do", [ card("chipA"), card("chipC") ] ],
            [ "Done", [ card("chipC") ] ],
            [ "Empty", [] ]
        ]);

        expect(filterColumns(byColumn, [])).toBe(byColumn);

        const filtered = filterColumns(byColumn, [ owner("tony") ]);
        expect([ ...filtered.keys() ]).toEqual([ "To Do", "Done", "Empty" ]);
        expect(filtered.get("To Do")?.map(({ note }) => note.noteId)).toEqual([ "chipA" ]);
        expect(filtered.get("Done")).toEqual([]);
    });

    it("toggles a filter on and off", () => {
        const once = toggleFilter([], "owner", "tony");
        expect(once).toEqual([ owner("tony") ]);
        expect(hasFilter(once, "owner", "tony")).toBe(true);

        const twice = toggleFilter(once, "project", "altair");
        expect(twice).toEqual([ owner("tony"), project("altair") ]);
        expect(toggleFilter(twice, "owner", "tony")).toEqual([ project("altair") ]);
    });

    it("survives a trip through the stored JSON and drops what is not a filter", () => {
        const filters = [ owner("tony/altair/fix agent perms"), project("factorio") ];
        const stored = JSON.parse(JSON.stringify({ columns: [], filters }));
        expect(readFilters(stored)).toEqual(filters);

        expect(readFilters(undefined)).toEqual([]);
        expect(readFilters({})).toEqual([]);
        expect(readFilters({ filters: "owner=tony" })).toEqual([]);
        expect(readFilters({ filters: [ null, 3, { name: "owner" }, { name: "", value: "x" }, owner("tony"), owner("tony") ] })).toEqual([ owner("tony") ]);
    });
});
