import { EditorState, type Extension } from "@codemirror/state";
import { crosshairCursor, drawSelection, EditorView, rectangularSelection } from "@codemirror/view";

/** The modifier held to add a caret by clicking, or with Shift to drag a rectangular selection. */
export type MultiCursorModifier = "alt" | "ctrl";

/**
 * Enables VS Code's multiple-cursor gestures.
 *
 * `defaultKeymap` already binds `addCursorAbove` and `addCursorBelow` to Ctrl+Alt+Up/Down, but
 * the extra ranges only survive a transaction once `EditorState.allowMultipleSelections` is on,
 * and they are only visible once `drawSelection` takes over painting — the native browser
 * selection renders a single caret.
 */
export function multipleSelections(modifier: MultiCursorModifier): Extension {
    const heldDown = isModifierHeld(modifier);

    return [
        EditorState.allowMultipleSelections.of(true),
        drawSelection(),
        EditorView.clickAddsSelectionRange.of(heldDown),
        rectangularSelection({ eventFilter: (event) => event.shiftKey && heldDown(event) }),
        crosshairCursor({ key: modifier === "ctrl" ? "Control" : "Alt" })
    ];
}

/**
 * Colors the drawn selection and carets from Trilium's own palette, so an editor with no
 * CodeMirror theme loaded still matches the app. `drawSelection` stops the browser painting the
 * selection, which takes the app's `::selection` rule out of play. A base theme, sitting after
 * `themeCompartment` in the extension list, so a loaded CodeMirror theme wins every tie.
 */
export const drawnSelectionTheme = EditorView.baseTheme({
    "&light .cm-selectionBackground, &dark .cm-selectionBackground": {
        background: "var(--selection-background-color)"
    },
    // CodeMirror gives the focused editor its own, more specific rule; match it or it wins.
    "&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        background: "var(--selection-background-color)"
    },
    "&dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        background: "var(--selection-background-color)"
    },
    "&light .cm-cursor, &dark .cm-cursor, &light .cm-dropCursor, &dark .cm-dropCursor": {
        borderLeftColor: "var(--main-text-color)"
    }
});

/** Narrows a stored option value, which is free-form text, onto VS Code's Alt as the fallback. */
export function toMultiCursorModifier(value: string): MultiCursorModifier {
    return value === "ctrl" ? "ctrl" : "alt";
}

function isModifierHeld(modifier: MultiCursorModifier) {
    // Cmd stands in for Ctrl on macOS, matching how CodeMirror's own `Mod-` bindings resolve.
    return modifier === "ctrl"
        ? (event: MouseEvent) => event.ctrlKey || event.metaKey
        : (event: MouseEvent) => event.altKey;
}
