import { isAttributeDangerous } from "@triliumnext/commons";

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

/**
 * Both notes a branch joins.
 *
 * A move, a delete, a prefix change and an expand all name a branch and nothing else, and each of them
 * changes the parent as much as the child, so both ends are checked together. A branch becca does not
 * hold yields `null`, which the caller reads as a refusal.
 */
export function noteIdsOfBranch(branchId: string): string[] | null {
    const branch = becca.getBranch(branchId);
    return branch ? [ branch.noteId, branch.parentNoteId ] : null;
}

/** The note a revision belongs to, so a revision is judged by where its note lives. */
export function noteIdOfRevision(revisionId: string): string | null {
    return becca.getRevision(revisionId)?.noteId ?? null;
}

/** An attribute as a write body carries it, before any route has validated it. */
export interface IncomingAttribute {
    type: string;
    name: string;
    value: string;
}

/**
 * Every attribute a write body names, whatever shape the route takes it in.
 *
 * Four shapes between them: a bare attribute, an array of them, an update carrying an `attributeId`
 * alongside, and a create body whose `attributes` array `createNewNote` applies atomically. All four
 * are read the same way here so one guard covers the set.
 */
export function attributesInBody(body: unknown): IncomingAttribute[] {
    const nested = body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).attributes
        : undefined;
    const rows = Array.isArray(body) ? body : [ body, ...(Array.isArray(nested) ? nested : []) ];
    const attributes: IncomingAttribute[] = [];
    for (const row of rows) {
        if (row && typeof row === "object") {
            const { type, name, value } = row as Record<string, unknown>;
            if (typeof type === "string" && typeof name === "string") {
                attributes.push({ type, name, value: typeof value === "string" ? value : "" });
            }
        }
    }
    return attributes;
}

/**
 * Whether an attribute makes a note run code, which a slice visitor must never be able to set.
 *
 * The code runs in the vault owner's browser under the owner's session, so this is the one thing full
 * write inside the boundary does not include. Re-exported rather than reimplemented: `BUILTIN_ATTRIBUTES`
 * is the vault's own list of what executes, and a name marked dangerous there is refused here without
 * anyone editing this module.
 */
export const isDangerousAttribute = isAttributeDangerous;

/**
 * Note ids a write body names beyond the ones in its path: the template a new note copies, and the
 * target of every relation the body carries.
 *
 * A relation's value is always a note id, so a non-blank one is returned for the membership check and a
 * blank one — which is how a relation is cleared — is left alone. A value naming no note at all fails
 * the membership check, which is the fail-closed reading.
 */
export function noteIdsInBody(body: unknown): string[] {
    const noteIds: string[] = [];
    if (body && typeof body === "object" && !Array.isArray(body)) {
        const templateNoteId = (body as Record<string, unknown>).templateNoteId;
        if (typeof templateNoteId === "string" && templateNoteId) {
            noteIds.push(templateNoteId);
        }
    }
    for (const attribute of attributesInBody(body)) {
        if (attribute.type === "relation" && attribute.value.trim()) {
            noteIds.push(attribute.value.trim());
        }
    }
    return noteIds;
}

type IncomingHeaders = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
    const single = Array.isArray(value) ? value[0] : value;
    return single ? single : undefined;
}
