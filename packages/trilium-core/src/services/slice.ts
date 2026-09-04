import becca from "../becca/becca.js";

/**
 * The boundary around a public slice: one note, everything under it, and nothing else.
 *
 * A slice is a link the awm edge admits without an awm session. The edge resolves the link's token,
 * then states what it resolved to in three headers on every forwarded request. Trilium trusts them
 * exactly as much as it trusts loopback, which is total: the vault binds loopback and the edge is
 * its only route in, and the edge overwrites all three so a browser cannot state them for itself.
 *
 * The membership test is computed per request rather than materialised, so a note moved into the
 * slice belongs to it without anyone re-issuing a link.
 */

/** Express lower-cases the header names it parses, so these match what `req.headers` holds. */
export const SLICE_ROOT_HEADER = "x-awm-slice-root";
export const SLICE_USER_HEADER = "x-awm-slice-user";
export const SLICE_WRITE_HEADER = "x-awm-slice-write";

export interface SliceContext {
    /** The note the link opens. The slice is this note together with its descendants. */
    rootNoteId: string;
    /** Who the edge says is visiting, or `null` for an open link nobody has named yet. */
    user: string | null;
    /** Whether this link may edit note bodies. Nothing else is writable through a slice. */
    canWrite: boolean;
}

/**
 * Who a slice edit is attributed to when the link is an open one nobody has named yet. The history
 * should say an outsider wrote this even where it cannot say which one.
 */
export const ANONYMOUS_VISITOR = "anonymous";

/** The slice this request belongs to, or `null` for ordinary traffic, which is left untouched. */
export function readSliceContext(headers: IncomingHeaders): SliceContext | null {
    const rootNoteId = firstValue(headers[SLICE_ROOT_HEADER]);
    if (!rootNoteId) {
        return null;
    }
    return {
        rootNoteId,
        user: firstValue(headers[SLICE_USER_HEADER]) ?? null,
        canWrite: firstValue(headers[SLICE_WRITE_HEADER]) === "1"
    };
}

/** Whether `noteId` is the slice's root or lives under it. A note becca does not hold is not. */
export function isNoteInSlice(noteId: string, rootNoteId: string): boolean {
    if (noteId === rootNoteId) {
        return true;
    }
    const note = becca.notes[noteId];
    return note ? note.hasAncestor(rootNoteId) : false;
}

/** The note an attachment hangs off, so an attachment is judged by where its owner lives. */
export function noteIdOfAttachment(attachmentId: string): string | null {
    return becca.getAttachment(attachmentId)?.ownerId ?? null;
}

type IncomingHeaders = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
    const single = Array.isArray(value) ? value[0] : value;
    return single ? single : undefined;
}
