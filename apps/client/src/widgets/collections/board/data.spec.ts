import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { getBoardData } from "./data";

describe("Board data", () => {
    it("deduplicates cloned notes", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "note1", title: "First note", "#status": "To Do" },
                { id: "note2", title: "Second note", "#status": "In progress" },
                { id: "note3", title: "Third note", "#status": "Done" }
            ]
        });
        const branch = new FBranch(froca, {
            branchId: "note1_note2",
            notePosition: 10,
            fromSearchNote: false,
            noteId: "note2",
            parentNoteId: "note1"
        });
        froca.branches["note1_note2"] = branch;
        froca.getNoteFromCache("note1")!.addChild("note2", "note1_note2", false);
        const data = await getBoardData(parentNote, "status", {}, false);
        const noteIds = [...data.byColumn.values()].flat().map(item => item.note.noteId);
        expect(noteIds.length).toBe(3);
    });

    it("gives each card its path from the board, and a direct child none", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "Top", "#status": "To Do" },
                {
                    title: "Metasmith",
                    children: [
                        { title: "Outline", "#status": "To Do" },
                        { title: "Notes", children: [ { title: "Deep", "#status": "To Do" } ] }
                    ]
                }
            ]
        });

        const data = await getBoardData(parentNote, "status", {}, false);
        const paths = Object.fromEntries(
            [ ...data.byColumn.values() ].flat().map(item => [ item.note.title, item.path ]));

        expect(paths).toEqual({
            "Top": "",
            "Outline": "Metasmith",
            "Deep": "Metasmith/Notes"
        });
    });

    it("resolves columns from the definition, the attachment and the notes together", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [ { title: "One", "#status": "Blocked" } ]
        });

        const data = await getBoardData(
            parentNote,
            "status",
            { columns: [ { value: "To Do" } ] },
            false,
            [ "To Do", "Done" ]);

        expect(data.columns).toEqual([ "To Do", "Done", "Blocked" ]);
        // byColumn is filled in two passes -- the notes scan first, so "Blocked" (the one column a
        // note actually carries) is the first key, and the columns nothing carries follow in the
        // order resolveBoardColumns settled on.
        expect([ ...data.byColumn.keys() ]).toEqual([ "Blocked", "To Do", "Done" ]);
    });
});
