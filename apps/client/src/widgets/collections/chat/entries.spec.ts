import { describe, expect, it } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import { chatEntries } from "./entries";

describe("Chat entries", () => {
    it("orders sealed messages by sequence and keeps unsealed ones last", async () => {
        const chat = buildNote({
            title: "Chat",
            "#viewType": "chat",
            children: [
                { id: "draft", title: "unsent" },
                { id: "m10", title: "10 · beta", "#msgSeq": "00000010", "#msgAt": "2026-10-14T12:10:00Z", "#msgFrom": "op@beta" },
                { id: "m2", title: "2 · tony", "#msgSeq": "00000002", "#msgAt": "2026-10-14T12:02:00Z", "#msgFrom": "tony@tony" }
            ]
        });
        const entries = chatEntries(await chat.getChildNotes());
        expect(entries.map(entry => entry.noteId)).toEqual([ "m2", "m10", "draft" ]);
        expect(entries[0]).toEqual({ noteId: "m2", seq: 2, at: "2026-10-14T12:02:00Z", from: "tony@tony" });
        expect(entries[2]).toEqual({ noteId: "draft", seq: null, at: null, from: null });
    });
});
