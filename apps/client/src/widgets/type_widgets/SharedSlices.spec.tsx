/**
 * The screen listing every slice link the vault has handed out.
 *
 * What is held here is what the screen decides on its own: which rows it shows, how it groups them,
 * and what it says where this Trilium cannot share at all. The links themselves come from awm and
 * are stubbed.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    // Answers the screen's own request and nothing else: everything the app loads on the way past
    // — the keyboard actions among them — expects a list.
    get: vi.fn(async (url: string) => (url === "slices" ? { slices: mocks.slices } : [])),
    slices: [] as unknown[]
}));

vi.mock("../../services/server", () => ({
    default: { get: mocks.get, remove: vi.fn() }
}));
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve()
}));
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath }: { notePath: string }) => <span className="note-link-stub">{notePath}</span>
}));

import SharedSlices from "./SharedSlices.js";

const LIVE = {
    token: "live1", noteId: "n1", title: "Field notes", user: "steven", write: true,
    createdAt: 1700000000, expiresAt: null, revokedAt: null, active: true,
    url: "https://example.invalid/slice/live1/"
};
const SECOND_NOTE = { ...LIVE, token: "live2", noteId: "n2", title: "Recipes",
                      url: "https://example.invalid/slice/live2/" };
const SAME_NOTE = { ...LIVE, token: "live3", url: "https://example.invalid/slice/live3/" };
const REVOKED = { ...LIVE, token: "dead1", active: false, revokedAt: 1700000100,
                  url: "https://example.invalid/slice/dead1/" };

let container: HTMLDivElement;

beforeEach(() => {
    vi.clearAllMocks();
    glob.sliceSharingAvailable = true;
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    glob.sliceSharingAvailable = undefined;
});

async function mount() {
    await act(async () => { render(<SharedSlices />, container); });
}

// The heading also carries the card's actions, so the note's own name is its first child.
const headings = () => [ ...container.querySelectorAll(".tn-card-heading") ]
    .map((heading) => heading.firstChild?.textContent?.trim());
const urls = () => [ ...container.querySelectorAll(".share-slice-url") ]
    .map((url) => url.textContent?.trim());

describe("SharedSlices", () => {
    it("gathers the links of one note into one card, in the order the vault answers", async () => {
        mocks.slices = [ LIVE, SECOND_NOTE, SAME_NOTE ];
        await mount();

        expect(mocks.get).toHaveBeenCalledWith("slices");
        expect(headings()).toEqual([ "Field notes", "Recipes" ]);
        expect(urls()).toEqual([ LIVE.url, SAME_NOTE.url, SECOND_NOTE.url ]);
    });

    it("keeps a revoked link out until the whole audit is asked for", async () => {
        mocks.slices = [ LIVE, REVOKED ];
        await mount();

        expect(urls()).toEqual([ LIVE.url ]);

        await act(async () => {
            container.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
        });

        expect(urls()).toEqual([ LIVE.url, REVOKED.url ]);
        // A link that opens nothing can no longer be revoked, so only the live row keeps both buttons.
        expect([ ...container.querySelectorAll(".share-slice-row") ]
            .map((row) => row.querySelectorAll("button").length)).toEqual([ 2, 1 ]);
    });

    it("says so where this Trilium has no gateway to share through, and asks for nothing", async () => {
        glob.sliceSharingAvailable = undefined;
        mocks.slices = [ LIVE ];
        await mount();

        expect(mocks.get).not.toHaveBeenCalled();
        expect(container.textContent).toContain("shared_slices.unavailable");
    });
});
