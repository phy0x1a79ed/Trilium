import type { Request } from "express";

import becca from "../../becca/becca.js";
import * as cls from "../../services/context.js";
import { getLog } from "../../services/log.js";
import searchService from "../../services/search/services/search.js";
import { getSql } from "../../services/sql/index.js";
import { isNoteInSlice, readSliceContext } from "../../services/slice.js";
import { escapeHtml } from "../../services/utils/index.js";
import { ValidationError } from "../../errors.js";
import becca_service from "../../becca/becca_service.js";

/**
 * The note titles a caller may be offered.
 *
 * A public slice searches its own subtree and nothing else. The scope is derived here from the
 * edge's headers — the same source the slice mask reads — rather than taken from a query parameter
 * or from the hoisted note, both of which the client states for itself.
 */
function getAutocomplete(req: Request) {
    if (typeof req.query.query !== "string") {
        throw new ValidationError("Invalid query data type.");
    }
    const query = (req.query.query || "").trim();
    const fastSearch = String(req.query.fastSearch).toLowerCase() !== "false";

    const activeNoteId = req.query.activeNoteId || "none";
    const sliceRootNoteId = readSliceContext(req.headers)?.rootNoteId;

    let results;

    const timestampStarted = Date.now();

    if (query.length === 0 && typeof activeNoteId === "string") {
        results = getRecentNotes(activeNoteId, sliceRootNoteId);
    } else {
        results = searchService.searchNotesForAutocomplete(query, fastSearch, sliceRootNoteId);
    }

    const msTaken = Date.now() - timestampStarted;

    if (msTaken >= 100) {
        getLog().info(`Slow autocomplete took ${msTaken}ms`);
    }

    return results;
}

/**
 * The rows an empty query answers with: where the owner of the vault has been.
 *
 * `sliceRootNoteId` both narrows the SQL and decides each row afterwards, because the `LIKE` is a
 * substring test over the path and a boundary cannot rest on one.
 */
function getRecentNotes(activeNoteId: string, sliceRootNoteId?: string) {
    let extraCondition = "";
    const params = [activeNoteId];

    const ancestorNoteId = sliceRootNoteId ?? cls.getHoistedNoteId();
    if (ancestorNoteId !== "root") {
        extraCondition = `AND recent_notes.notePath LIKE ?`;
        params.push(`%${ancestorNoteId}%`);
    }

    const recentNotes = becca.getRecentNotesFromQuery(
        `
    SELECT
        recent_notes.*
    FROM
        recent_notes
        JOIN notes USING(noteId)
    WHERE
        notes.isDeleted = 0
        AND notes.noteId != ?
        ${extraCondition}
    ORDER BY
        utcDateCreated DESC
    LIMIT 200`,
        params
    );

    const visible = sliceRootNoteId
        ? recentNotes.filter((rn) => isPathInSlice(rn.notePath, sliceRootNoteId))
        : recentNotes;

    return visible.map((rn) => {
        const notePathArray = rn.notePath.split("/");

        const { title, icon } = becca_service.getNoteTitleAndIcon(notePathArray[notePathArray.length - 1]);
        const notePathTitle = becca_service.getNoteTitleForPath(notePathArray);

        return {
            notePath: rn.notePath,
            noteTitle: title,
            notePathTitle,
            highlightedNotePathTitle: escapeHtml(notePathTitle || title),
            icon: icon ?? "bx bx-note"
        };
    });
}

/**
 * Whether a recorded note path is one a slice can both reach and render: it passes through the
 * slice root, and the note it ends at is inside the slice.
 */
function isPathInSlice(notePath: string, rootNoteId: string): boolean {
    const notePathArray = notePath.split("/");
    const leafNoteId = notePathArray[notePathArray.length - 1];
    return notePathArray.includes(rootNoteId) && isNoteInSlice(leafNoteId, rootNoteId);
}

// Get the total number of notes
function getNotesCount(req: Request) {
    const notesCount = getSql().getRow(
        /*sql*/`SELECT COUNT(*) AS count FROM notes WHERE isDeleted = 0;`,
    ) as { count: number };
    return notesCount.count;
}

export default {
    getAutocomplete,
    getNotesCount
};
