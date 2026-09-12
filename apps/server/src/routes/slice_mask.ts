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
 * A link that permits writing may do inside its own subtree what its owner may do in the whole vault:
 * create, rename, move, clone, annotate, attach and delete. Every such route names its entities in the
 * path or the body, and each of those is placed inside the slice before the route runs. A note inside
 * the slice is writable whatever its type: what the link opens, the link opens.
 *
 * Three things a write cannot do, refused here rather than left to a handler. It cannot set an
 * attribute that makes a note run code, because that code would run in the vault owner's browser under
 * the owner's session. It cannot erase, because erasing destroys every clone of a note wherever in the
 * vault it lives. It cannot reach a route that reports on the vault as a whole, such as the delete
 * preview or the attribute-name autocomplete.
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
    const refusal = rule.guard?.(rule.params, req, context);
    if (refusal) {
        return refuse(res, refusal);
    }
    return next();
}

/** The ids a route names, or `null` when it names something this cannot resolve. */
type Locator = (params: Record<string, string>, req: Request, context: slice.SliceContext) => string[] | null;

/**
 * A reason to refuse a request whose entities are all inside the slice, or `null` to let it through.
 * Runs after the membership check, so it can assume every id the locator returned is in the slice.
 */
type Guard = (params: Record<string, string>, req: Request, context: slice.SliceContext) => string | null;

interface Rule {
    method: string;
    pattern: string;
    mutates: boolean;
    locate: Locator;
    guard?: Guard;
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
 * The subtree the caller asked for, defaulting to the slice's own root the way the route does. A
 * slice must ask for a subtree inside itself, so the ordinary membership check answers the whole
 * question and a request for the tree from `root` is refused like any other note outside it.
 */
const bySubTreeQuery: Locator = (_params, req, context) =>
    [ typeof req.query.subTreeNoteId === "string" ? req.query.subTreeNoteId : context.rootNoteId ];

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

/** Both notes a branch joins, so a move, a delete or a prefix change is judged by child and parent. */
const byBranchId: Locator = (params) => slice.noteIdsOfBranch(params.branchId);

/** A branch named alongside the one in `branchId`: a move states where it comes from and where it goes. */
function byBranchPair(otherParam: string): Locator {
    return (params) => concat(slice.noteIdsOfBranch(params.branchId), slice.noteIdsOfBranch(params[otherParam]));
}

/** A note named in the path under a name of its own, such as the ancestor recent changes is asked for. */
function byPathNote(param: string): Locator {
    return (params) => [ params[param] ];
}

/** A note and a second note named in the same path: a clone target, a duplicate parent, a relation target. */
function byNotePair(otherParam: string): Locator {
    return (params) => [ params.noteId, params[otherParam] ];
}

/** A note and the branch it is being cloned onto or after. */
function byNoteAndBranch(branchParam: string): Locator {
    return (params) => concat([ params.noteId ], slice.noteIdsOfBranch(params[branchParam]));
}

/** The note a revision belongs to, so a revision is judged by where its note lives. */
const byRevisionNote: Locator = (params) => {
    const noteId = slice.noteIdOfRevision(params.revisionId);
    return noteId ? [ noteId ] : null;
};

/**
 * The note a write acts on together with everything its body names: a template to copy, and the target
 * of every relation. Out-of-slice ids refuse the request rather than being dropped, because a create
 * that silently lost its template would produce a note the visitor did not ask for.
 */
const byNoteAndBody: Locator = (params, req) => [ params.noteId, ...slice.noteIdsInBody(req.body) ];

/** Where a new note lands: the parent, the branch a `before`/`after` target names, and the body's ids. */
const byCreateTarget: Locator = (params, req) => {
    const noteIds = [ params.parentNoteId, ...slice.noteIdsInBody(req.body) ];
    const targetBranchId = req.query.targetBranchId;
    if (typeof targetBranchId !== "string" || !targetBranchId || targetBranchId === "undefined") {
        return noteIds;
    }
    return concat(noteIds, slice.noteIdsOfBranch(targetBranchId));
};

/** Every branch a prefix batch names, each judged by both of the notes it joins. */
const byBodyBranchIds: Locator = (_params, req) => {
    const branchIds = (req.body as { branchIds?: unknown })?.branchIds;
    if (!Array.isArray(branchIds) || !branchIds.every(id => typeof id === "string")) {
        return null;
    }
    let noteIds: string[] | null = [];
    for (const branchId of branchIds as string[]) {
        noteIds = concat(noteIds, slice.noteIdsOfBranch(branchId));
    }
    return noteIds;
};

/**
 * Refuses an attribute that makes a note execute. The code would run in the vault owner's browser under
 * the owner's session, so this is the one thing full write inside the boundary does not include.
 */
const noExecutableAttribute: Guard = (_params, req) => {
    for (const attribute of slice.attributesInBody(req.body)) {
        if (slice.isDangerousAttribute(attribute.type, attribute.name)) {
            return `'${attribute.name}' makes a note run code and cannot be set through a slice`;
        }
    }
    return null;
};

/** The same refusal for the two routes that name the relation in the path rather than the body. */
const noExecutableRelation: Guard = (params) =>
    slice.isDangerousAttribute("relation", params.name)
        ? `'${params.name}' makes a note run code and cannot be set through a slice`
        : null;

/**
 * What a slice may not do while deleting a branch.
 *
 * Erasing destroys every clone of the note wherever in the vault it lives, and the flag arrives on the
 * query string, so it is refused here rather than trusted to be absent. Deleting the note the link
 * opens would leave the link pointing at nothing; the branch's parent is outside the slice in every
 * ordinary shape, so the membership check refuses it first, but the boundary should not rest on that.
 */
const deleteStaysInsideTheSlice: Guard = (params, req, context) => {
    if (req.query.eraseNotes === "true") {
        return "a slice cannot erase a note";
    }
    const noteIds = slice.noteIdsOfBranch(params.branchId);
    return noteIds?.[0] === context.rootNoteId ? "a slice cannot delete the note it opens" : null;
};

/** Joins two resolutions, refusing when either one failed to resolve. */
function concat(first: string[] | null, second: string[] | null): string[] | null {
    return first && second ? [ ...first, ...second ] : null;
}

const RULES: Omit<Rule, "params">[] = [
    reads("/bootstrap", namesNothing),
    reads("/api/app-info", namesNothing),
    reads("/api/options", namesNothing),
    reads("/api/fonts", namesNothing),
    reads("/api/keyboard-actions", namesNothing),

    // The one route whose boundary the handler draws rather than the locator: the path names no
    // note, and `getAutocomplete` confines the search to the slice root by reading the same edge
    // headers this mask reads. `matchPattern` counts segments, so `/api/autocomplete/notesCount`
    // is not this rule and stays refused, as does every `/api/search` and `/api/quick-search` path.
    reads("/api/autocomplete", namesNothing),

    // The search routes draw their own boundary the same way: both read the edge headers and confine
    // the search to the slice root, so the path's search string names no note to check here.
    reads("/api/search/:searchString", namesNothing),
    reads("/api/quick-search/:searchString", namesNothing),
    // A search note states its own `~ancestor`, which the handler clamps to the slice root.
    reads("/api/search-note/:noteId", byNoteId),

    // Read-only despite the method: both maps are asked for with a POST because the filter travels in
    // the body. The handler drops any note outside the slice, which a link map's relation hops and a
    // resolved search note can both reach.
    { method: "POST", pattern: "/api/note-map/:noteId/tree", mutates: false, locate: byNoteId },
    { method: "POST", pattern: "/api/note-map/:noteId/link", mutates: false, locate: byNoteId },

    // The route already filters its rows by the ancestor it is given, and a deleted note has left
    // becca, so a visitor sees the slice's own changes and no deleted rows at all.
    reads("/api/recent-changes/:ancestorNoteId", byPathNote("ancestorNoteId")),

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

    reads("/api/notes/:noteId/revisions", byNoteId),
    reads("/api/revisions/:revisionId", byRevisionNote),
    reads("/api/revisions/:revisionId/blob", byRevisionNote),
    reads("/api/revisions/:revisionId/download", byRevisionNote),
    reads("/api/revisions/:revisionId/image/:filename", byRevisionNote),

    // The note itself. Content, title, type and child order are all one note's own business, so the
    // path names everything that has to be checked.
    writes("PUT", "/api/notes/:noteId/data", byNoteId),
    writes("PUT", "/api/notes/:noteId/title", byNoteId),
    writes("PUT", "/api/notes/:noteId/type", byNoteId),
    writes("PUT", "/api/notes/:noteId/sort-children", byNoteId),
    writes("PUT", "/api/notes/:noteId/file", byNoteId),
    writes("POST", "/api/notes/:noteId/revision", byNoteId),
    writes("DELETE", "/api/notes/:noteId/revisions", byNoteId),

    // Creating, duplicating and cloning, each judged by where the new note lands as well as where it
    // comes from.
    writes("POST", "/api/notes/:parentNoteId/children", byCreateTarget, noExecutableAttribute),
    writes("POST", "/api/notes/:noteId/duplicate/:parentNoteId", byNotePair("parentNoteId")),
    writes("PUT", "/api/notes/:noteId/clone-to-note/:parentNoteId", byNotePair("parentNoteId")),
    writes("PUT", "/api/notes/:noteId/toggle-in-parent/:parentNoteId/:present", byNotePair("parentNoteId")),
    writes("PUT", "/api/notes/:noteId/clone-to-branch/:parentBranchId", byNoteAndBranch("parentBranchId")),
    writes("PUT", "/api/notes/:noteId/clone-after/:afterBranchId", byNoteAndBranch("afterBranchId")),

    // Branches. A branch is a note's placement, so both of the notes it joins are checked, which is
    // what keeps a move from carrying a note out of the slice or dropping one in from outside.
    writes("DELETE", "/api/branches/:branchId", byBranchId, deleteStaysInsideTheSlice),
    writes("PUT", "/api/branches/:branchId/set-prefix", byBranchId),
    writes("PUT", "/api/branches/:branchId/expanded/:expanded", byBranchId),
    writes("PUT", "/api/branches/:branchId/expanded-subtree/:expanded", byBranchId),
    writes("PUT", "/api/branches/:branchId/move-to/:parentBranchId", byBranchPair("parentBranchId")),
    writes("PUT", "/api/branches/:branchId/move-before/:beforeBranchId", byBranchPair("beforeBranchId")),
    writes("PUT", "/api/branches/:branchId/move-after/:afterBranchId", byBranchPair("afterBranchId")),
    writes("PUT", "/api/branches/set-prefix-batch", byBodyBranchIds),

    // Attributes. The body can name a relation target and a create can name a template, so the body is
    // read for note ids as well as for names that would make the note execute.
    writes("POST", "/api/notes/:noteId/attributes", byNoteAndBody, noExecutableAttribute),
    writes("PUT", "/api/notes/:noteId/attributes", byNoteAndBody, noExecutableAttribute),
    writes("PUT", "/api/notes/:noteId/attribute", byNoteAndBody, noExecutableAttribute),
    writes("PUT", "/api/notes/:noteId/set-attribute", byNoteAndBody, noExecutableAttribute),
    writes("DELETE", "/api/notes/:noteId/attributes/:attributeId", byNoteId),
    writes("PUT", "/api/notes/:noteId/relations/:name/to/:targetNoteId", byNotePair("targetNoteId"), noExecutableRelation),
    // Removing a relation is allowed whatever it is named: taking an executable attribute off a note
    // makes the vault safer, never less safe.
    writes("DELETE", "/api/notes/:noteId/relations/:name/to/:targetNoteId", byNotePair("targetNoteId")),

    // Attachments, every one judged by the note it hangs off.
    writes("POST", "/api/notes/:noteId/attachments", byNoteId),
    writes("POST", "/api/notes/:noteId/attachments/upload", byNoteId),
    writes("DELETE", "/api/attachments/:attachmentId", byAttachmentOwner),
    writes("PUT", "/api/attachments/:attachmentId/rename", byAttachmentOwner),
    writes("PUT", "/api/attachments/:attachmentId/file", byAttachmentOwner),
    writes("POST", "/api/attachments/:attachmentId/convert-to-note", byAttachmentOwner),

    // Revisions of a note the slice holds.
    writes("DELETE", "/api/revisions/:revisionId", byRevisionNote),
    writes("PATCH", "/api/revisions/:revisionId", byRevisionNote),
    writes("POST", "/api/revisions/:revisionId/restore", byRevisionNote)
];

// Routes a reader might expect above, each left out on purpose. `DELETE /api/notes/:noteId` deletes
// every clone of a note, and a note the slice holds by one branch can be held elsewhere by another, so
// a slice deletes branches instead. `POST /api/delete-notes-preview` reports relations broken across the
// whole vault, and `PUT /api/notes/:noteId/protect/:isProtected` needs a vault-wide protected session.
// `GET /api/attribute-names` and `GET /api/attribute-values/:attributeName` enumerate the vault's
// vocabulary. The import routes accept an archive that names its own parents. The three erase routes act
// on the whole vault at once. Options, special notes, scripts, sync, backup, the database and the slice
// API itself are unchanged and stay out.

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

/** A route only a link that permits writing reaches, refused outright on a read-only one. */
function writes(method: string, pattern: string, locate: Locator, guard?: Guard): Omit<Rule, "params"> {
    return { method, pattern, mutates: true, locate, guard };
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
