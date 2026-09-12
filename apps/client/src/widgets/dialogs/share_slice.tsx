import "./share_slice.css";

import type { CreateSliceRequest, SliceInfo, SlicesResponse } from "@triliumnext/commons";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { copyTextWithToast } from "../../services/clipboard_ext";
import dialogService from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import FormCheckbox from "../react/FormCheckbox";
import FormGroup from "../react/FormGroup";
import FormSelect from "../react/FormSelect";
import FormTextBox from "../react/FormTextBox";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";

/**
 * Opens the dialog that shares a note and its subtree as an awm slice: a link somebody with no
 * account can follow, optionally to edit note bodies.
 *
 * Mounted on demand into a host of its own, as the image compression dialog is — a dialog reached
 * from a context menu has no place sitting in the page that merely *could* open it.
 *
 * Unrelated to `showShareSubtree` and the `shared` label, which publish a note read-only under
 * `/share/` and involve no token and no visitor.
 */
export function showShareSliceDialog(noteId: string, noteTitle: string) {
    const host = document.body.appendChild(document.createElement("div"));

    render(
        <ShareSliceDialog noteId={noteId} noteTitle={noteTitle} onClosed={() => {
            render(null, host);
            host.remove();
        }} />,
        host
    );
}

function ShareSliceDialog({ noteId, noteTitle, onClosed }: {
    noteId: string;
    noteTitle: string;
    onClosed: () => void;
}) {
    const [ shown, setShown ] = useState(true);
    const [ slices, setSlices ] = useState<SliceInfo[] | null>(null);
    const [ user, setUser ] = useState("");
    const [ write, setWrite ] = useState(false);
    const [ expiry, setExpiry ] = useState("");
    const [ minting, setMinting ] = useState(false);

    async function reload() {
        const response = await server.get<SlicesResponse>(`slices/${noteId}`);
        setSlices(response.slices.filter((slice) => slice.active));
    }

    useEffect(() => { void reload(); }, [ noteId ]);

    async function mint() {
        setMinting(true);
        try {
            const request: CreateSliceRequest = {
                noteId,
                user: user.trim() || undefined,
                write,
                expiresInHours: expiry ? Number(expiry) : undefined
            };
            const slice = await server.post<SliceInfo>("slices", request);
            setSlices((existing) => [ slice, ...(existing ?? []) ]);
            copyTextWithToast(slice.url);
        } catch {
            // Already surfaced as a toast by server.ts.
        } finally {
            setMinting(false);
        }
    }

    return (
        <Modal
            className="share-slice-dialog"
            title={t("share_slice.title", { title: noteTitle })}
            show={shown}
            onHidden={() => { setShown(false); onClosed(); }}
            onSubmit={() => void mint()}
            size="lg"
            scrollable
            footer={
                <Button
                    icon={minting ? "bx-loader-alt bx-spin" : "bx-link"}
                    text={t("share_slice.create")}
                    kind="primary"
                    disabled={minting}
                />
            }
        >
            <p className="share-slice-explanation">{t("share_slice.explanation")}</p>

            <FormGroup
                name="slice-user"
                label={t("share_slice.visitor")}
                description={t("share_slice.visitor_description")}
            >
                <FormTextBox
                    currentValue={user}
                    onChange={setUser}
                    placeholder={t("share_slice.visitor_placeholder")}
                    autoFocus
                />
            </FormGroup>

            <FormGroup name="slice-expiry" label={t("share_slice.expiry")}>
                <FormSelect
                    values={expiryOptions()}
                    keyProperty="value" titleProperty="label"
                    currentValue={expiry}
                    onChange={setExpiry}
                />
            </FormGroup>

            <FormCheckbox
                label={t("share_slice.allow_editing")}
                hint={t("share_slice.allow_editing_hint")}
                currentValue={write}
                onChange={setWrite}
            />

            <h5 className="share-slice-list-heading">{t("share_slice.existing")}</h5>
            {slices === null
                ? <NoItems icon="bx bx-loader-alt bx-spin"
                    text={t("share_slice.loading")} size="small" />
                : slices.length === 0
                    ? <NoItems icon="bx bx-link" text={t("share_slice.none")} size="small" />
                    : <ul className="share-slice-list">
                        {slices.map((slice) => (
                            <SliceLinkRow
                                key={slice.token}
                                slice={slice}
                                onRevoked={() => void reload()}
                            />
                        ))}
                    </ul>}
        </Modal>
    );
}

/** How long a fresh link lasts, in hours. The empty value mints one that does not expire. */
function expiryOptions() {
    return [
        { value: "", label: t("share_slice.expiry_never") },
        { value: "24", label: t("share_slice.expiry_day") },
        { value: "168", label: t("share_slice.expiry_week") },
        { value: "720", label: t("share_slice.expiry_month") }
    ];
}

/**
 * One link as its owner sees it: the address, what it permits, and the two things to do with it.
 *
 * Shared with the shared-slices screen, which lists the same rows across the whole vault, so a link
 * reads and revokes the same way wherever it is shown. The row is an `<li>`, so a host puts it in a
 * `share-slice-list`.
 */
export function SliceLinkRow({ slice, onRevoked }: {
    slice: SliceInfo;
    /** Called once the link is gone, for the host to read its list again. */
    onRevoked: () => void;
}) {
    return (
        <li className="share-slice-row">
            <div className="share-slice-url">{slice.url}</div>
            <div className="share-slice-terms">{describeSliceTerms(slice)}</div>
            <ActionButton
                icon="bx bx-copy" text={t("info.copy_to_clipboard")}
                onClick={() => copyTextWithToast(slice.url)}
            />
            {slice.active && <ActionButton
                icon="bx bx-trash" text={t("share_slice.revoke")}
                onClick={() => void revokeAndReport(slice, onRevoked)}
            />}
        </li>
    );
}

/** Who a link is for, what it permits, when it was handed out, and when it stopped resolving. */
export function describeSliceTerms(slice: SliceInfo): string {
    const parts = [
        slice.user
            ? t("share_slice.bound_to", { user: slice.user })
            : t("share_slice.open_to_anyone"),
        slice.write ? t("share_slice.can_edit") : t("share_slice.read_only"),
        t("share_slice.created_on", { date: formatSliceDate(slice.createdAt) })
    ];
    if (slice.revokedAt) {
        parts.push(t("share_slice.revoked_on", { date: formatSliceDate(slice.revokedAt) }));
    } else if (slice.expiresAt) {
        const expiry = slice.active ? "share_slice.expires_on" : "share_slice.expired_on";
        parts.push(t(expiry, { date: formatSliceDate(slice.expiresAt) }));
    }
    return parts.join(" · ");
}

async function revokeAndReport(slice: SliceInfo, onRevoked: () => void) {
    if (!await dialogService.confirm(t("share_slice.revoke_confirm"))) {
        return;
    }
    await server.remove(`slices/${slice.token}`);
    toast.showMessage(t("share_slice.revoked"));
    onRevoked();
}

/** awm keeps its timestamps in seconds, which `Date` reads in milliseconds. */
function formatSliceDate(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString();
}
