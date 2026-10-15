/**
 * The chips on a board's cards: colored per value, and clickable to narrow the board.
 */
import { render } from "preact";
import { useCallback, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import { buildNote } from "../../../test/easy-froca";
import { getChipPaletteIndex } from "../../attribute_widgets/chip_colors";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";
import BoardApi from "./api";

describe("Board chips", () => {
    let container: HTMLElement | undefined;
    const saved: BoardViewData[] = [];

    beforeEach(() => {
        vi.spyOn(BoardApi.prototype, "openNote").mockImplementation(() => undefined);
    });

    afterEach(() => {
        saved.length = 0;
        vi.restoreAllMocks();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    function Harness({ note, noteIds, initialConfig }: { note: ReturnType<typeof buildNote>, noteIds: string[], initialConfig: BoardViewData }) {
        const [ config, setConfig ] = useState(initialConfig);
        const saveConfig = useCallback((newConfig: BoardViewData) => {
            saved.push(newConfig);
            setConfig(newConfig);
        }, []);

        return (
            <BoardView
                note={note}
                notePath={`root/${note.noteId}`}
                noteIds={noteIds}
                highlightedTokens={null}
                viewConfig={config}
                saveConfig={saveConfig}
                media="screen"
                onReady={() => {}}
            />
        );
    }

    /** A board of three cards in two columns, each with an `owner` chip. */
    async function mount(initialConfig: BoardViewData = {}, boardLabels: Record<`#${string}`, string> = {}) {
        const owned = (id: string, title: string, status: string, ownerValue: string) => ({
            id, title, "#status": status, "#owner": ownerValue, "#label:owner": "promoted,single,text"
        } as const);
        const suffix = Math.random().toString(36).slice(2, 8);
        const ids = [ `a${suffix}`, `b${suffix}`, `c${suffix}` ];
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            ...boardLabels,
            children: [
                owned(ids[0], "First", "To Do", "tony"),
                owned(ids[1], "Second", "To Do", "ana"),
                owned(ids[2], "Third", "Done", "tony")
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={ids}
                        initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ], ...initialConfig }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();
        return mountPoint;
    }

    const cardTitles = (root: HTMLElement) => [ ...root.querySelectorAll(".board-note .title") ].map(el => el.textContent);
    const columnTitles = (root: HTMLElement) => [ ...root.querySelectorAll(".board-column h3 .title") ].map(el => el.textContent);

    function chip(root: HTMLElement, cardTitle: string) {
        const card = [ ...root.querySelectorAll(".board-note") ].find(el => el.querySelector(".title")?.textContent === cardTitle);
        const element = card?.querySelector<HTMLElement>(".user-attribute");
        if (!element) throw new Error(`no chip on the card "${cardTitle}"`);
        return element;
    }

    async function click(element: HTMLElement) {
        await act(async () => {
            element.click();
        });
        await settle();
    }

    it("colors a text chip by its value and lets a configured mapping win", async () => {
        const root = await mount();
        expect(chip(root, "First").className).toContain(`chip-palette-${getChipPaletteIndex("owner", "tony")}`);
        expect(chip(root, "Second").className).toContain(`chip-palette-${getChipPaletteIndex("owner", "ana")}`);
        expect(chip(root, "First").className).toBe(chip(root, "Third").className);
        render(null, root);
        root.remove();
        container = undefined;

        const overridden = await mount({}, { "#board:chipColors": "owner:tony=#336699" });
        expect(chip(overridden, "First").className).toContain("chip-custom-color");
        expect(chip(overridden, "First").style.backgroundColor).not.toBe("");
        expect(chip(overridden, "Second").className).toContain("chip-palette-");
    });

    it("filters on a clicked chip without opening the card, keeps empty columns and clears again", async () => {
        const root = await mount();
        expect(cardTitles(root)).toEqual([ "First", "Second", "Third" ]);
        expect(root.querySelector(".board-filter-bar")).toBeNull();

        await click(chip(root, "Second"));

        expect(BoardApi.prototype.openNote).not.toHaveBeenCalled();
        expect(saved.at(-1)?.filters).toEqual([ { name: "owner", value: "ana" } ]);
        expect(cardTitles(root)).toEqual([ "Second" ]);
        expect(columnTitles(root)).toEqual([ "To Do", "Done" ]);
        expect(root.querySelector(".board-filter-bar")?.textContent).toContain("ana");
        expect(chip(root, "Second").className).toContain("active");

        await click(root.querySelector<HTMLElement>(".board-filter-remove") as HTMLElement);
        expect(saved.at(-1)?.filters).toEqual([]);
        expect(cardTitles(root)).toEqual([ "First", "Second", "Third" ]);
        expect(root.querySelector(".board-filter-bar")).toBeNull();

        await click(chip(root, "First"));
        expect(saved.at(-1)?.filters).toEqual([ { name: "owner", value: "tony" } ]);
        expect(cardTitles(root)).toEqual([ "First", "Third" ]);

        await click(root.querySelector<HTMLElement>(".board-filter-clear") as HTMLElement);
        expect(cardTitles(root)).toEqual([ "First", "Second", "Third" ]);
    });

    it("restores the filters from the stored view config", async () => {
        const root = await mount();
        await click(chip(root, "Second"));
        const stored = JSON.parse(JSON.stringify(saved.at(-1)));

        render(null, root);
        root.remove();
        container = undefined;

        const reopened = await mount(stored);
        expect(cardTitles(reopened)).toEqual([ "Second" ]);
        expect(reopened.querySelector(".board-filter-bar")).not.toBeNull();
    });
});

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });
}
