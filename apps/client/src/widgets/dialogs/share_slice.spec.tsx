/**
 * The dialog that shares a note as an awm slice.
 *
 * What is held here is the whole of what the dialog owns: it lists only the links that still open
 * something, it mints on the terms the form is showing, and it puts a fresh link on the clipboard
 * without waiting to be asked. awm's own behaviour is the server's business, and is stubbed.
 */
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    slices: [] as unknown[],
    // Answers the dialog's own request and nothing else: everything the app loads on the way past
    // — the keyboard actions and the options among them — expects a list.
    get: vi.fn(async (url: string) => (url.startsWith("slices/") ? { slices: mocks.slices } : [])),
    post: vi.fn<(url: string, body?: object) => Promise<unknown>>(),
    remove: vi.fn<(url: string) => Promise<unknown>>(),
    copyTextWithToast: vi.fn<(text: string) => void>(),
    confirm: vi.fn<() => Promise<boolean>>(async () => true)
}));

vi.mock("../../services/server", () => ({
    default: { get: mocks.get, post: mocks.post, remove: mocks.remove }
}));
vi.mock("../../services/clipboard_ext", () => ({ copyTextWithToast: mocks.copyTextWithToast }));
vi.mock("../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));
vi.mock("../../services/toast", () => ({ default: { showMessage: vi.fn() } }));
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve()
}));

// The real modal reports its close once the animation is done; the stub reports it as soon as it is
// told to hide, and renders the footer where the submit button can be found.
vi.mock("../react/Modal", () => ({
    default: function ModalStub({ children, footer, show, onHidden, onSubmit }: {
        children: ComponentChildren, footer: ComponentChildren, show: boolean,
        onHidden: () => void, onSubmit?: () => void
    }) {
        useEffect(() => {
            if (!show) {
                onHidden();
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [ show ]);

        return show
            ? <form
                className="modal-stub"
                onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}
            >
                {children}<div className="footer-stub">{footer}</div>
            </form>
            : null;
    }
}));

import { showShareSliceDialog } from "./share_slice";

const LIVE = {
    token: "live1", noteId: "n1", user: "steven", write: true,
    createdAt: 1700000000, expiresAt: null, revokedAt: null, active: true,
    url: "https://example.invalid/slice/live1/#root/n1"
};
const REVOKED = { ...LIVE, token: "dead1", active: false, revokedAt: 1700000100,
                  url: "https://example.invalid/slice/dead1/#root/n1" };

async function open() {
    await act(async () => {
        showShareSliceDialog("n1", "Shared folder");
    });
}

const urls = () => [ ...document.body.querySelectorAll(".share-slice-url") ]
    .map((row) => row.textContent?.trim());

describe("ShareSliceDialog", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        mocks.confirm.mockResolvedValue(true);
    });

    it("lists only the links that still open something", async () => {
        mocks.slices = [ LIVE, REVOKED ];
        await open();

        expect(mocks.get).toHaveBeenCalledWith("slices/n1");
        expect(urls()).toEqual([ LIVE.url ]);
    });

    it("mints on the terms the form is showing, and copies what comes back", async () => {
        mocks.slices = [];
        const minted = { ...LIVE, token: "fresh", user: "alice",
                         url: "https://example.invalid/slice/fresh/#root/n1" };
        mocks.post.mockResolvedValue(minted);
        await open();

        await act(async () => {
            const visitor = document.body
                .querySelector<HTMLInputElement>(".modal-stub input[type=text]");
            if (visitor) {
                visitor.value = "alice";
                visitor.dispatchEvent(new Event("input", { bubbles: true }));
            }
            document.body
                .querySelector<HTMLInputElement>(".modal-stub input[type=checkbox]")?.click();
        });
        await act(async () => {
            document.body.querySelector<HTMLFormElement>(".modal-stub")
                ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });

        expect(mocks.post).toHaveBeenCalledWith("slices", {
            noteId: "n1", user: "alice", write: true, expiresInHours: undefined
        });
        expect(mocks.copyTextWithToast).toHaveBeenCalledWith(minted.url);
        expect(urls()).toEqual([ minted.url ]);
    });

    it("asks before revoking, and leaves the link alone when the answer is no", async () => {
        mocks.slices = [ LIVE ];
        await open();

        mocks.confirm.mockResolvedValue(false);
        await act(async () => {
            revokeButton()?.click();
        });
        expect(mocks.remove).not.toHaveBeenCalled();

        mocks.confirm.mockResolvedValue(true);
        mocks.slices = [];
        await act(async () => {
            revokeButton()?.click();
        });
        // The press starts a chain the click handler does not await: confirm, revoke, re-read.
        await flush();
        expect(mocks.remove).toHaveBeenCalledWith("slices/live1");
        expect(urls()).toEqual([]);
    });
});

/** Lets a chain the press did not await run to its last `setState`. */
function flush() {
    return act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function revokeButton() {
    return [ ...document.body
        .querySelectorAll<HTMLButtonElement>(".share-slice-list button") ].at(-1);
}
