/**
 * The client's read of the awm public slice a visitor is viewing.
 *
 * `glob.sliceRootNoteId` reaches the client only through the bootstrap payload the server built
 * from the edge's `x-awm-slice-root` header (see `slice.ts` in trilium-core) — nothing the client
 * itself sends can set it. Everything here is display: which note the app hoists to by default and
 * which affordances it hides because the slice mask would refuse them anyway. The boundary itself
 * is enforced server-side, independently of anything read here.
 */

function getSliceRootNoteId(): string | null {
    return glob.sliceRootNoteId ?? null;
}

function isSlice(): boolean {
    return getSliceRootNoteId() !== null;
}

/** Whether this slice link may edit note bodies. False outside a slice, where nothing is a slice. */
function canWrite(): boolean {
    return isSlice() && glob.sliceCanWrite === true;
}

/** A slice whose link only reads, which the editor and the tree show the way a read-only database is shown. */
function isReadOnly(): boolean {
    return isSlice() && !canWrite();
}

/** The note that stands in for "root" when nothing else specifies a hoisted note or a note path. */
function defaultRootNoteId(): string {
    return getSliceRootNoteId() ?? "root";
}

export default {
    getSliceRootNoteId,
    isSlice,
    canWrite,
    isReadOnly,
    defaultRootNoteId
};
