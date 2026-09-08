import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { multipleSelections, toMultiCursorModifier } from "./multi_cursor.js";

describe("toMultiCursorModifier", () => {
    it("keeps ctrl and falls back to alt for anything else", () => {
        expect(toMultiCursorModifier("ctrl")).toBe("ctrl");
        expect(toMultiCursorModifier("alt")).toBe("alt");
        // Options are stored as free-form text, so an unknown value has to land somewhere.
        expect(toMultiCursorModifier("")).toBe("alt");
        expect(toMultiCursorModifier("meta")).toBe("alt");
    });
});

describe("multipleSelections", () => {
    it("lets the state keep more than the main selection range", () => {
        const state = EditorState.create({
            doc: "one\ntwo",
            extensions: [ multipleSelections("alt") ]
        });
        expect(state.facet(EditorState.allowMultipleSelections)).toBe(true);
    });

    it("adds a caret on Alt+click but not on Ctrl+click", () => {
        const [ addsRange ] = facetOf("alt");
        expect(addsRange(mouseEvent({ altKey: true }))).toBe(true);
        expect(addsRange(mouseEvent({ ctrlKey: true }))).toBe(false);
        expect(addsRange(mouseEvent({}))).toBe(false);
    });

    it("adds a caret on Ctrl+click, or Cmd+click, when configured for ctrl", () => {
        const [ addsRange ] = facetOf("ctrl");
        expect(addsRange(mouseEvent({ ctrlKey: true }))).toBe(true);
        expect(addsRange(mouseEvent({ metaKey: true }))).toBe(true);
        expect(addsRange(mouseEvent({ altKey: true }))).toBe(false);
    });
});

describe("rectangular selection", () => {
    it("starts a column selection on Shift+modifier+drag only", () => {
        const view = new EditorView({ doc: "one\ntwo", extensions: [ multipleSelections("alt") ] });
        try {
            const [ mouseStyle ] = view.state.facet(EditorView.mouseSelectionStyle);
            expect(mouseStyle(view, mouseEvent({}))).toBeNull();
            expect(mouseStyle(view, mouseEvent({ shiftKey: true }))).toBeNull();
            expect(mouseStyle(view, mouseEvent({ altKey: true }))).toBeNull();
            expect(mouseStyle(view, mouseEvent({ shiftKey: true, altKey: true }))).not.toBeNull();
        } finally {
            view.destroy();
        }
    });
});

function facetOf(modifier: "alt" | "ctrl") {
    const state = EditorState.create({ extensions: [ multipleSelections(modifier) ] });
    return state.facet(EditorView.clickAddsSelectionRange);
}

type Modifiers = Partial<Pick<MouseEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">>;

function mouseEvent(modifiers: Modifiers) {
    return new MouseEvent("mousedown", modifiers);
}
