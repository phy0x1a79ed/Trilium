import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { resolveBoardColumns } from "./columns";
import { BoardViewData } from "./index";

export interface BoardCard {
    branch: FBranch;
    note: FNote;
    /**
     * Where the card sits under the board: the titles of its ancestors below the board, joined by
     * `/`, empty for a direct child.
     *
     * Accumulated on the way down rather than rebuilt in the card, because a note cloned to two
     * places under one board has one path per branch and only the walk knows which branch this card
     * was reached by. Joined here so that a memoized card compares it as one string.
     */
    path: string;
}

export type ColumnMap = Map<string, BoardCard[]>;

/**
 * @param definitionOptions the choices the board's group-by definition offers, empty when it has no
 *                          select definition of its own to lead the column order.
 * @param droppedColumns the columns this board has deleted or renamed away and whose removal is
 *                       still in flight — see `resolveBoardColumns`.
 */
export async function getBoardData(
    parentNote: FNote,
    groupByColumn: string,
    persistedData: BoardViewData,
    includeArchived: boolean,
    definitionOptions: string[] = [],
    droppedColumns: ReadonlySet<string> = new Set()
) {
    const byColumn: ColumnMap = new Map();

    // First, scan all notes to find what columns actually exist
    await recursiveGroupBy(parentNote.getChildBranches(), byColumn, groupByColumn, includeArchived, new Set<string>(), "");

    const persistedColumns = (persistedData.columns ?? []).map(c => c.value);
    const columns = resolveBoardColumns(definitionOptions, persistedColumns, [ ...byColumn.keys() ], droppedColumns);

    // A column the notes have nothing in is still a column, so every resolved one gets an entry.
    for (const column of columns) {
        if (!byColumn.has(column)) {
            byColumn.set(column, []);
        }
    }

    // The attachment mirrors the resolved list, so a board whose columns now come from its definition
    // stays readable by anything still reading the attachment. Written only when it actually differs,
    // or every refresh would save.
    const hasChanges = persistedColumns.length !== columns.length
        || persistedColumns.some((value, index) => columns[index] !== value);

    return {
        byColumn,
        columns,
        newPersistedData: hasChanges
            ? { ...persistedData, columns: columns.map(value => ({ value })) }
            : undefined,
        isInRelationMode: groupByColumn.startsWith("~")
    };
}

async function recursiveGroupBy(branches: FBranch[], byColumn: ColumnMap, groupByColumn: string, includeArchived: boolean, seenNoteIds: Set<string>, path: string) {
    for (const branch of branches) {
        const note = await branch.getNote();
        if (!note || (!includeArchived && note.isArchived)) continue;

        if (note.type !== "search" && note.hasChildren()) {
            const childPath = path ? `${path}/${note.title}` : note.title;
            await recursiveGroupBy(note.getChildBranches(), byColumn, groupByColumn, includeArchived, seenNoteIds, childPath);
        }

        const group = note.getLabelOrRelation(groupByColumn);
        if (!group || seenNoteIds.has(note.noteId)) {
            continue;
        }

        if (!byColumn.has(group)) {
            byColumn.set(group, []);
        }

        byColumn.get(group)!.push({
            branch,
            note,
            path
        });
        seenNoteIds.add(note.noteId);
    }
}
