import becca from "@triliumnext/core/src/becca/becca.js";
// The subpath, not the barrel: this module loads with the router, and the barrel would pull every
// core export in behind it before core is initialised.
import * as slice from "@triliumnext/core/src/services/slice.js";
import type { NextFunction, Request, Response } from "express";

/**
 * What a public slice may ask the internal API for.
 *
 * Sits ahead of the router rather than inside each handler, so a route added by the next upstream
 * merge is covered without anyone remembering to cover it: a request carrying the edge's slice
 * headers reaches only the routes named below, and every one of those is checked against the slice
 * before it runs. Anything unnamed is refused — the rule that keeps this from becoming a list
 * nobody can keep correct.
 *
 * Reads are the whole of it bar one route. A slice may edit note bodies and nothing else, so
 * exactly one route mutates, and only when the link permits writing.
 *
 * A request without the headers is ordinary traffic and passes untouched, which is every request a
 * signed-in person makes.
 */
export function sliceMask(req: Request, res: Response, next: NextFunction) {
    const context = slice.readSliceContext(req.headers);
    if (!context) {
        return next();
    }
    if (!isGoverned(req.path)) {
        // The application shell and its assets. Nothing here names a note, and a slice that could
        // not load them would be a blank page.
        return req.method === "GET" ? next() : refuse(res, "a slice may only read");
    }
    const rule = findRule(req.method, req.path);
    if (!rule) {
        return refuse(res, "this route is not part of a slice");
    }
    if (rule.mutates && !context.canWrite) {
        return refuse(res, "this slice is read-only");
    }
    const noteIds = rule.locate(rule.params, req, context);
    if (noteIds === null) {
        return refuse(res, "this request names nothing a slice can check");
    }
    for (const noteId of noteIds) {
        if (!slice.isNoteInSlice(noteId, context.rootNoteId)) {
            return refuse(res, "this note is outside the slice");
        }
    }
    if (rule.mutates && !noteIds.every(isProse)) {
        return refuse(res, "a slice may only edit text notes");
    }
    return next();
}

/**
 * Whether the note holds prose.
 *
 * A slice edits bodies, and only a text note's body is prose. Every other type holds content the
 * vault parses or renders in its own way -- a code note whose HTML a render note displays, a canvas
 * or mind map's JSON -- and none of it should be a stranger's to write.
 */
function isProse(noteId: string): boolean {
    return becca.notes[noteId]?.type === "text";
}

/** The ids a route names, or `null` when it names something this cannot resolve. */
type Locator = (params: Record<string, string>, req: Request, context: slice.SliceContext) => string[] | null;

interface Rule {
    method: string;
    pattern: string;
    mutates: boolean;
    locate: Locator;
    params: Record<string, string>;
}

/** Named in the path, which is how nearly every route names a note. */
const byNoteId: Locator = (params) => [ params.noteId ];

/** Named through its owner, so an attachment is judged by where the note it hangs off lives. */
const byAttachmentOwner: Locator = (params) => {
    const noteId = slice.noteIdOfAttachment(params.attachmentId);
    return noteId ? [ noteId ] : null;
};

/** Names no note at all: application-wide data a visitor needs to render anything. */
const namesNothing: Locator = () => [];

/**
 * The subtree the caller asked for, defaulting to what the route itself defaults to. A slice must
 * ask for a subtree inside itself, so the ordinary membership check answers the whole question and
 * a request for the tree from `root` is refused like any other note outside the slice.
 */
const bySubTreeQuery: Locator = (_params, req) =>
    [ typeof req.query.subTreeNoteId === "string" ? req.query.subTreeNoteId : "root" ];

/**
 * The ids in the body, narrowed to the ones inside the slice.
 *
 * Scoped rather than refused, because the client asks for whatever it has learnt about — a note it
 * remembers from a link, a hoisted note it no longer has — and one such id would otherwise refuse
 * the whole load and leave the tree empty. What comes back is what the slice may see.
 */
const byBodyNoteIds: Locator = (_params, req, context) => {
    const noteIds = (req.body as { noteIds?: unknown })?.noteIds;
    if (!Array.isArray(noteIds) || !noteIds.every(id => typeof id === "string")) {
        return null;
    }
    (req.body as { noteIds: string[] }).noteIds =
        (noteIds as string[]).filter(noteId => slice.isNoteInSlice(noteId, context.rootNoteId));
    return [];
};

const RULES: Omit<Rule, "params">[] = [
    reads("/bootstrap", namesNothing),
    reads("/api/app-info", namesNothing),
    reads("/api/options", namesNothing),
    reads("/api/fonts", namesNothing),
    reads("/api/keyboard-actions", namesNothing),

    reads("/api/tree", bySubTreeQuery),
    { method: "POST", pattern: "/api/tree/load", mutates: false, locate: byBodyNoteIds },

    reads("/api/notes/:noteId", byNoteId),
    reads("/api/notes/:noteId/blob", byNoteId),
    reads("/api/notes/:noteId/metadata", byNoteId),
    reads("/api/notes/:noteId/attributes", byNoteId),
    reads("/api/notes/:noteId/attachments", byNoteId),
    reads("/api/notes/:noteId/download", byNoteId),
    reads("/api/notes/:noteId/open", byNoteId),
    reads("/api/notes/:noteId/open-partial", byNoteId),
    reads("/api/notes/:noteId/office-preview", byNoteId),
    reads("/api/notes/:noteId/image-info", byNoteId),
    reads("/api/notes/download/:noteId", byNoteId),
    reads("/api/images/:noteId/:filename", byNoteId),

    reads("/api/attachments/:attachmentId", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/blob", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/all", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/download", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/image-info", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/image/:filename", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/office-preview", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/open", byAttachmentOwner),
    reads("/api/attachments/:attachmentId/open-partial", byAttachmentOwner),
    reads("/api/attachments/download/:attachmentId", byAttachmentOwner),

    // The one route a slice may write through. Bodies only: a title, an attribute, a branch or an
    // attachment all reach the vault through routes that are simply not here.
    { method: "PUT", pattern: "/api/notes/:noteId/data", mutates: true, locate: byNoteId }
];

/**
 * Whether the mask decides this path at all.
 *
 * The internal API, plus the surfaces the edge already refuses a slice — named again here because a
 * second gate should not depend on the first one being correct.
 */
function isGoverned(path: string): boolean {
    return GOVERNED_PREFIXES.some(prefix =>
        prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix || path.startsWith(prefix + "/"));
}

const GOVERNED_PREFIXES = [ "/api/", "/etapi/", "/custom/", "/mcp", "/share/", "/login", "/logout",
                            "/setup", "/set-password", "/bootstrap" ];

function reads(pattern: string, locate: Locator): Omit<Rule, "params"> {
    return { method: "GET", pattern, mutates: false, locate };
}

function findRule(method: string, path: string): Rule | null {
    for (const rule of RULES) {
        if (rule.method !== method) {
            continue;
        }
        const params = matchPattern(rule.pattern, path);
        if (params) {
            return { ...rule, params };
        }
    }
    return null;
}

/** Segment-wise match of an Express-style pattern, done here because routing has not run yet. */
function matchPattern(pattern: string, path: string): Record<string, string> | null {
    const patternParts = pattern.split("/");
    const pathParts = path.split("/");
    if (patternParts.length !== pathParts.length) {
        return null;
    }
    const params: Record<string, string> = {};
    for (const [ index, patternPart ] of patternParts.entries()) {
        const pathPart = pathParts[index];
        if (patternPart.startsWith(":")) {
            if (!pathPart) {
                return null;
            }
            params[patternPart.slice(1)] = decodeURIComponent(pathPart);
        } else if (patternPart !== pathPart) {
            return null;
        }
    }
    return params;
}

function refuse(res: Response, message: string) {
    res.status(403).json({ message });
}
