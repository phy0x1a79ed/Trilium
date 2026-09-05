import type { AttributeRow, BranchRow, NoteRow } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import { ForbiddenError, NotFoundError } from "../../errors.js";
import { getLog } from "../../services/log.js";
import { isNoteInSlice, readSliceContext } from "../../services/slice.js";
import type BNote from "../../becca/entities/bnote.js";

interface CollectOptions {
    /** The note a public slice opens, when this request carries the edge's slice headers. */
    sliceRootNoteId?: string;
}

function getNotesAndBranchesAndAttributes(_noteIds: string[] | Set<string>, { sliceRootNoteId }: CollectOptions = {}) {
    const noteIds = new Set(_noteIds);
    const collectedNoteIds = new Set<string>();
    const collectedAttributeIds = new Set<string>();
    const collectedBranchIds = new Set<string>();
    const membership = new Map<string, boolean>();

    /** Whether the slice holds this note. Always true outside a slice, so the walk is unchanged. */
    function inSlice(noteId: string): boolean {
        if (sliceRootNoteId === undefined) {
            return true;
        }
        let held = membership.get(noteId);
        if (held === undefined) {
            held = isNoteInSlice(noteId, sliceRootNoteId);
            membership.set(noteId, held);
        }
        return held;
    }

    function collectEntityIds(note?: BNote) {
        if (!note || collectedNoteIds.has(note.noteId)) {
            return;
        }

        collectedNoteIds.add(note.noteId);

        // A note outside the slice is reachable only as a `template`/`inherit` target. It keeps its
        // own row and its own attributes so the note pointing at it still renders, but gains no
        // branch and no ancestor, so it can never appear in the tree. The cost is that inheritable
        // attributes owned by an out-of-slice ancestor never reach the visitor.
        const structural = inSlice(note.noteId);

        if (structural) {
            for (const branch of note.getParentBranches()) {
                // Skipping a branch whose parent is outside is what stops the upward walk at the
                // slice root, and what drops the other parent of a note cloned in from elsewhere.
                if (!inSlice(branch.parentNoteId)) {
                    continue;
                }

                if (branch.branchId) {
                    collectedBranchIds.add(branch.branchId);
                }

                collectEntityIds(branch.parentNote);
            }

            for (const childNote of note.children) {
                const childBranch = becca.getBranchFromChildAndParent(childNote.noteId, note.noteId);
                if (childBranch && childBranch.branchId) {
                    collectedBranchIds.add(childBranch.branchId);
                }
            }
        }

        for (const attr of note.ownedAttributes) {
            collectedAttributeIds.add(attr.attributeId);

            if (attr.type === "relation" && ["template", "inherit"].includes(attr.name) && attr.targetNote) {
                collectEntityIds(attr.targetNote);
            }
        }
    }

    for (const noteId of noteIds) {
        const note = becca.notes[noteId];

        if (!note || !inSlice(noteId)) {
            continue;
        }

        collectEntityIds(note);
    }

    // The client's tree is always rooted at `root`, so a slice gets a bare `root` row plus a
    // synthetic branch holding the shared note directly beneath it. The three rows are emitted
    // together: `froca.addResp` drops a cached note's child branches before re-adding the ones the
    // payload carries, so a `root` row arriving without its branch detaches the whole tree.
    const attachSliceRoot = sliceRootNoteId !== undefined
        && sliceRootNoteId !== "root"
        && collectedNoteIds.has(sliceRootNoteId)
        && "root" in becca.notes;

    if (attachSliceRoot) {
        collectedNoteIds.add("root");
    }

    const notes: NoteRow[] = [];

    for (const noteId of collectedNoteIds) {
        const note = becca.notes[noteId];

        notes.push({
            noteId: note.noteId,
            title: note.getTitleOrProtected(),
            isProtected: note.isProtected,
            type: note.type,
            mime: note.mime,
            blobId: note.blobId
        });
    }

    const branches: BranchRow[] = [];

    if (noteIds.has("root") || attachSliceRoot) {
        branches.push({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 0,
            prefix: "",
            isExpanded: true
        });
    }

    for (const branchId of collectedBranchIds) {
        const branch = becca.branches[branchId];

        if (!branch) {
            getLog().error(`Could not find branch for branchId=${branchId}`);
            continue;
        }

        branches.push({
            branchId: branch.branchId,
            noteId: branch.noteId,
            parentNoteId: branch.parentNoteId,
            notePosition: branch.notePosition,
            prefix: branch.prefix,
            isExpanded: branch.isExpanded
        });
    }

    if (attachSliceRoot && sliceRootNoteId) {
        branches.push({
            branchId: `root_${sliceRootNoteId}`,
            noteId: sliceRootNoteId,
            parentNoteId: "root",
            notePosition: 0,
            prefix: null,
            isExpanded: true
        });
    }

    const attributes: AttributeRow[] = [];

    for (const attributeId of collectedAttributeIds) {
        const attribute = becca.attributes[attributeId];

        if (!attribute) {
            getLog().error(`Could not find attribute for attributeId=${attributeId}`);
            continue;
        }

        attributes.push({
            attributeId: attribute.attributeId,
            noteId: attribute.noteId,
            type: attribute.type,
            name: attribute.name,
            value: attribute.value,
            position: attribute.position,
            isInheritable: attribute.isInheritable
        });
    }

    return {
        branches,
        notes,
        attributes
    };
}

/**
 * @swagger
 * /api/tree:
 *   get:
 *     summary: Retrieve tree data
 *     operationId: tree
 *     externalDocs:
 *       description: Server implementation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/routes/api/tree.ts
 *     parameters:
 *       - in: query
 *         name: subTreeNoteId
 *         required: false
 *         schema:
 *           type: string
 *         description: Limit tree data to this note and descendants
 *     responses:
 *       '200':
 *         description: Notes, branches and attributes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 branches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Branch'
 *                 notes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Note'
 *                 attributes:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Attribute'
 *     security:
 *       - session: []
 *     tags: ["data"]
 */
function getTree(req: Request) {
    const sliceRootNoteId = readSliceContext(req.headers ?? {})?.rootNoteId;
    const defaultSubTreeNoteId = sliceRootNoteId ?? "root";
    const subTreeNoteId = typeof req.query.subTreeNoteId === "string" ? req.query.subTreeNoteId : defaultSubTreeNoteId;
    const collectedNoteIds = new Set<string>([subTreeNoteId]);

    function collect(parentNote: BNote) {
        /* v8 ignore next 3 -- defensive guard: collect() is only ever called with a cache-verified note */
        if (!parentNote) {
            console.trace(parentNote);
        }

        for (const childNote of parentNote.children) {
            collectedNoteIds.add(childNote.noteId);

            const childBranch = becca.getBranchFromChildAndParent(childNote.noteId, parentNote.noteId);

            if (childBranch?.isExpanded) {
                collect(childBranch.childNote);
            }
        }
    }

    if (!(subTreeNoteId in becca.notes)) {
        throw new NotFoundError(`Note '${subTreeNoteId}' not found in the cache`);
    }

    // Stated here as well as in the slice mask, so the rule holds wherever this handler is mounted.
    if (sliceRootNoteId !== undefined && !isNoteInSlice(subTreeNoteId, sliceRootNoteId)) {
        throw new ForbiddenError(`Note '${subTreeNoteId}' is outside the slice`);
    }

    collect(becca.notes[subTreeNoteId]);

    return getNotesAndBranchesAndAttributes(collectedNoteIds, { sliceRootNoteId });
}

function load(req: Request) {
    const sliceRootNoteId = readSliceContext(req.headers ?? {})?.rootNoteId;

    return getNotesAndBranchesAndAttributes(req.body.noteIds, { sliceRootNoteId });
}

export default {
    getTree,
    load
};
