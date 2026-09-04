/**
 * Regression test for #10689: a newly added board column is persisted but not rendered until the
 * view is re-entered, and a subsequent column reorder then deletes it again.
 */
import { render } from "preact";
import { useCallback, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";

/** Drains the async chain inside `refresh()` (getBoardData → setByColumn/setColumns). */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve));
}

const saved: BoardViewData[] = [];

/**
 * Mirrors how `useViewModeConfig` feeds the board: `saveConfig` publishes a *new wrapper* around the
 * config it was handed, so the `viewConfig` prop only changes identity if the caller passed a new
 * object. That is exactly the condition the board's refresh effect depends on.
 */
function Harness({ note, noteIds, initialConfig }: { note: ReturnType<typeof buildNote>, noteIds: string[], initialConfig: BoardViewData }) {
    const [ state, setState ] = useState<{ config: BoardViewData }>({ config: initialConfig });
    const saveConfig = useCallback((config: BoardViewData) => {
        saved.push(config);
        setState({ config });
    }, []);

    return (
        <BoardView
            note={note}
            notePath={`root/${note.noteId}`}
            noteIds={noteIds}
            highlightedTokens={null}
            viewConfig={state.config}
            saveConfig={saveConfig}
            media="screen"
            onReady={() => {}}
        />
    );
}

function columnTitles(container: HTMLElement) {
    return [ ...container.querySelectorAll(".board-column h3 .title") ].map(el => el.textContent);
}

describe("Board column creation", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function setup() {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "card1", title: "First", "#status": "To Do" },
                { id: "card2", title: "Second", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness note={note} noteIds={[ "card1", "card2" ]} initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }} />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => {
            await flush();
        });

        return { note, container: mountPoint };
    }

    /** Clicks "Add column", types a name and blurs the editor, as the user would. */
    async function addColumn(container: HTMLElement, name: string) {
        await act(async () => {
            container.querySelector<HTMLElement>(".board-add-column")?.click();
            await flush();
        });

        const input = container.querySelector<HTMLInputElement>(".board-add-column input");
        if (!input) throw new Error("expected an inline editor for the new column");

        await act(async () => {
            input.focus();
            input.value = name;
            input.blur();
            await flush();
        });

        // The save re-publishes the config, which re-runs the (async) board refresh; that lands in a
        // later tick than the one `act` flushed above.
        await act(async () => {
            await flush();
        });
    }

    it("renders a newly added column without leaving the view", async () => {
        const { container } = await setup();
        expect(columnTitles(container)).toEqual([ "To Do", "Done" ]);

        await addColumn(container, "In Progress");

        expect(saved.at(-1)?.columns?.map(c => c.value)).toEqual([ "To Do", "Done", "In Progress" ]);
        expect(columnTitles(container)).toEqual([ "To Do", "Done", "In Progress" ]);
    });
});

/**
 * Wraps `Harness` with its own `noteIds` state, so a test can force a second render (a new
 * `noteIds` array is one of `refresh()`'s effect dependencies) without going through a column
 * gesture.
 */
function NoteIdsHarness({ note, initialNoteIds, initialConfig }: {
    note: ReturnType<typeof buildNote>;
    initialNoteIds: string[];
    initialConfig: BoardViewData;
}) {
    const [ noteIds, setNoteIds ] = useState(initialNoteIds);
    rerenderWithNoteIds = setNoteIds;
    return <Harness note={note} noteIds={noteIds} initialConfig={initialConfig} />;
}

/** Set by `NoteIdsHarness` on every render, so a test can trigger a second one from the outside. */
let rerenderWithNoteIds: ((noteIds: string[]) => void) | undefined;

describe("Board render", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        rerenderWithNoteIds = undefined;
        vi.restoreAllMocks();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /**
     * A board's render only ever reads: no `board.json` save, no definition write. The one
     * exception -- seeding a brand-new board's definition -- does not apply here, since this board
     * already owns one.
     */
    it("writes nothing on a plain refresh, even when a column appears from outside the board", async () => {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status": "promoted,single,select,options=To Do;Done",
            children: [
                { id: "card1", title: "First", "#status": "To Do" },
                { id: "card2", title: "Second", "#status": "Done" }
            ]
        });

        const put = vi.spyOn(server, "put");

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <NoteIdsHarness
                        note={note}
                        initialNoteIds={[ "card1", "card2" ]}
                        initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => {
            await flush();
        });

        expect(columnTitles(mountPoint)).toEqual([ "To Do", "Done" ]);
        expect(saved).toHaveLength(0);
        expect(put).not.toHaveBeenCalled();

        // An external tool gives a note a value the board has never shown as a column -- the notes
        // are one of the sources a column can come from, no column gesture involved.
        const card3 = buildNote({ id: "card3", title: "Third", "#status": "Blocked" });
        const branch = new FBranch(froca, {
            branchId: "board_card3",
            notePosition: 30,
            fromSearchNote: false,
            noteId: card3.noteId,
            parentNoteId: note.noteId
        });
        froca.branches[branch.branchId] = branch;
        note.addChild(card3.noteId, branch.branchId, false);

        await act(async () => {
            rerenderWithNoteIds?.([ "card1", "card2", "card3" ]);
        });
        await act(async () => {
            await flush();
        });

        expect(columnTitles(mountPoint)).toEqual([ "To Do", "Done", "Blocked" ]);
        expect(saved).toHaveLength(0);
        expect(put).not.toHaveBeenCalled();
    });
});
