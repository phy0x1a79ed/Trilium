import { BulkAction, type DefinitionObject, promotedAttributeDefinitionParser } from "@triliumnext/commons";

import appContext from "../../../components/app_context";
import type FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import { executeBulkActions } from "../../../services/bulk_action";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { BoardColumnData, BoardViewData } from ".";
import { type BoardStatusDefinition, canStoreColumnsInDefinition, DEFAULT_GROUP_BY } from "./columns";
import { ColumnMap } from "./data";

export default class BoardApi {

    private isRelationMode: boolean;
    statusAttribute: string;

    constructor(
        private byColumn: ColumnMap | undefined,
        public columns: string[],
        private parentNote: FNote,
        statusAttribute: string,
        private viewConfig: BoardViewData,
        private saveConfig: (newConfig: BoardViewData) => void,
        private setBranchIdToEdit: (branchId: string | undefined) => void,
        private statusDefinition?: BoardStatusDefinition,
        /** The branch of each column's folder, keyed by the folder's noteId. Set only in folder mode. */
        private folderBranches?: Map<string, FBranch>
    ) {
        this.isRelationMode = statusAttribute.startsWith("~");

        if (statusAttribute.startsWith("~") || statusAttribute.startsWith("#")) {
            statusAttribute = statusAttribute.substring(1);
        }
        this.statusAttribute = statusAttribute;
    };

    /** Whether the columns are the board's child notes rather than the values of a label. */
    get isFolderMode() {
        return this.folderBranches !== undefined;
    }

    /** The text a column is shown by: the folder's title in folder mode, the value itself otherwise. */
    getColumnTitle(column: string) {
        if (!this.isFolderMode) return column;
        return froca.getNoteFromCache(column)?.title ?? column;
    }

    async createNewItem(column: string, title: string) {
        if (this.isFolderMode) {
            await note_create.createNote(column, {
                activate: false,
                title,
                isProtected: this.parentNote.isProtected
            });
            return;
        }

        try {
            // Create a new note as a child of the parent note
            const { note: newNote, branch: newBranch } = await note_create.createNote(this.parentNote.noteId, {
                activate: false,
                title,
                isProtected: this.parentNote.isProtected
            });

            if (newNote && newBranch) {
                await this.changeColumn(newNote.noteId, column);
            }
        } catch (error) {
            console.error("Failed to create new item:", error);
        }
    }

    /**
     * @param branchId the card's branch, which folder mode moves. Looked up by `noteId` when omitted.
     */
    async changeColumn(noteId: string, newColumn: string, branchId?: string) {
        if (this.isFolderMode) {
            const card = this.findCard(noteId, branchId);
            if (!card || card.column === newColumn) return;
            await this.placeInFolder(card.branchId, newColumn, Number.POSITIVE_INFINITY);
            return;
        }

        if (this.isRelationMode) {
            await attributes.setRelation(noteId, this.statusAttribute, newColumn);
        } else {
            await attributes.setLabel(noteId, this.statusAttribute, newColumn);
        }
    }

    async addNewColumn(columnName: string) {
        if (!columnName.trim()) {
            return;
        }

        if (this.isFolderMode) {
            const title = columnName.trim();
            if (this.columns.some(column => this.getColumnTitle(column) === title)) return false;
            await note_create.createNote(this.parentNote.noteId, {
                activate: false,
                title,
                type: "book",
                isProtected: this.parentNote.isProtected
            });
            return true;
        }

        const columns = this.viewConfig?.columns ?? [];

        // Add the new column to persisted data if it doesn't exist
        if (columns.some(col => col.value === columnName)) return false;
        this.storeColumns([ ...columns, { value: columnName } ]);
        return true;
    }

    async removeColumn(column: string) {
        if (this.isFolderMode) {
            const folderBranch = this.folderBranches?.get(column);
            if (folderBranch) {
                await branches.deleteNotes([ folderBranch.branchId ], false, false);
            }
            return;
        }

        if (this.isColumnFixedByDefinition(column)) {
            toast.showError(t("board_view.column-fixed-by-definition"));
            return;
        }

        // Remove the value from the notes.
        const noteIds = this.byColumn?.get(column)?.map(item => item.note.noteId) || [];

        const action: BulkAction = this.isRelationMode
            ? { name: "deleteRelation", relationName: this.statusAttribute }
            : { name: "deleteLabel", labelName: this.statusAttribute };
        await executeBulkActions(noteIds, [ action ]);
        this.storeColumns((this.viewConfig?.columns ?? []).filter(col => col.value !== column));
    }

    async renameColumn(oldValue: string, newValue: string) {
        if (this.isFolderMode) {
            await server.put(`notes/${oldValue}/title`, { title: newValue.trim() });
            return;
        }

        if (this.isColumnFixedByDefinition(oldValue)) {
            toast.showError(t("board_view.column-fixed-by-definition"));
            return;
        }

        const noteIds = this.byColumn?.get(oldValue)?.map(item => item.note.noteId) || [];

        // Change the value in the notes.
        const action: BulkAction = this.isRelationMode
            ? { name: "updateRelationTarget", relationName: this.statusAttribute, targetNoteId: newValue }
            : { name: "updateLabelValue", labelName: this.statusAttribute, labelValue: newValue };
        await executeBulkActions(noteIds, [ action ]);

        // Rename the column in the persisted data.
        this.storeColumns((this.viewConfig?.columns ?? [])
            .map(col => col.value === oldValue ? { ...col, value: newValue } : col));
    }

    /**
     * Whether a column is named by a definition this board may not rewrite — one owned by an
     * ancestor, or shared through a template with notes that are not on this board.
     *
     * Such a column cannot be removed or renamed from here at all. The definition goes on offering
     * it and the board resolves its columns from the definition first, so the column returns on the
     * next render with the notes' values already stripped. Refusing is the honest answer: the place
     * to change it is the definition, where it lives.
     */
    private isColumnFixedByDefinition(column: string) {
        return !canStoreColumnsInDefinition(this.statusDefinition)
            && !!this.statusDefinition?.options.includes(column);
    }

    reorderColumn(fromIndex: number, toIndex: number) {
        if (!this.columns || fromIndex === toIndex) return;

        const newColumns = [...this.columns];
        const [movedColumn] = newColumns.splice(fromIndex, 1);

        // Adjust toIndex after removing the element
        // When moving forward (right), the removal shifts indices left
        let adjustedToIndex = toIndex;
        if (fromIndex < toIndex) {
            adjustedToIndex = toIndex - 1;
        }

        newColumns.splice(adjustedToIndex, 0, movedColumn);

        if (this.isFolderMode) {
            this.moveFolder(movedColumn, newColumns[adjustedToIndex + 1], newColumns[adjustedToIndex - 1])
                .catch((e) => console.error("Failed to reorder the board's folders:", e));
            return newColumns;
        }

        // `columns` is derived render state and can lag behind the persisted config (it is rebuilt
        // only once the view re-renders), so anything it hasn't caught up with yet is kept at the
        // end instead of being dropped from the config.
        const missingColumns = (this.viewConfig?.columns ?? []).filter(col => !newColumns.includes(col.value));
        this.storeColumns([ ...newColumns.map(value => ({ value })), ...missingColumns ]);

        return newColumns;
    }

    /**
     * Persists a new column list, into the definition the board groups by as well as into the view
     * config — every column change funnels through here, so the two cannot drift apart.
     *
     * The config is always replaced with a fresh object instead of being edited in place: the board
     * re-renders off the identity of the config it was handed, so an in-place edit would be written
     * to disk but stay invisible until the view is re-entered.
     */
    private storeColumns(columns: BoardColumnData[]) {
        if (this.isFolderMode) return;

        this.viewConfig = { ...this.viewConfig, columns };
        this.saveConfig(this.viewConfig);
        // Not awaited — every caller is the tail of a user gesture the board has already rendered —
        // so the failure is caught here rather than left to reject unhandled. The columns are still
        // in the view config, so the board is not wrong, only out of step with the definition.
        this.syncColumnsToDefinition(columns.map(({ value }) => value))
            .catch((e) => {
                console.error("Failed to store the board columns in the attribute definition:", e);
                toast.showError(t("board_view.column-definition-save-error"));
            });
    }

    /**
     * Brings the board's own definition in line with the columns it shows, so that the same list is
     * what the promoted field offers, what the table view's dropdown offers, and what the board shows.
     *
     * Called when the user changes a column, and once by the view to seed a board that has no
     * definition at all — migration 0240 only ever saw the boards that existed when it ran. A render
     * otherwise writes nothing, so a column that appears from outside the board's own UI shows here
     * but reaches the definition only on the next column gesture, which stores the whole list.
     */
    async syncColumnsToDefinition(columns: string[]) {
        if (this.isFolderMode || this.isRelationMode || !canStoreColumnsInDefinition(this.statusDefinition)) {
            return;
        }

        // A board showing nothing has no column list to describe and must not gain an empty
        // definition; one that already owns one is still emptied, since that is its last column going.
        if (!columns.length && !this.statusDefinition?.isOwned) {
            return;
        }

        const current = this.statusDefinition?.options ?? [];
        const isUpToDate = this.statusDefinition?.definition.labelType === "select"
            && current.length === columns.length
            && current.every((option, index) => option === columns[index]);
        if (isUpToDate) {
            return;
        }

        // What a board with no definition of its own is given. Promoted, because the column a card
        // sits in is the point of the board, and a field that is not promoted is one the card never
        // shows — the status would be reachable only by dragging the card. Named only where the name
        // is ours to give: a board grouping by anything else is named by its own label.
        const created: DefinitionObject = {
            isPromoted: true,
            promotedAlias: this.statusAttribute === DEFAULT_GROUP_BY ? t("board_view.status-alias") : undefined
        };

        // An existing definition is updated as it stands, so a board deliberately left unpromoted —
        // by the user, or by migration 0240 where it had no field to begin with — does not gain one.
        const definition = {
            ...(this.statusDefinition?.definition ?? created),
            labelType: "select" as const,
            selectOptions: columns
        };

        // Written by name rather than by attribute id, so that two syncs which overlap — a column
        // edit landing mid-refresh, or one refresh starting before the previous write is back —
        // converge on one row instead of each creating one. Addressing it by id cannot: both would
        // have read the same "no definition yet" state and both would ask for a new attribute. Only
        // the board's own attributes are matched, so a definition it merely inherits is still copied
        // into one of its own rather than edited where it lives.
        await attributes.setLabel(
            this.parentNote.noteId,
            `label:${this.statusAttribute}`,
            promotedAttributeDefinitionParser.serialize(definition, "label"),
            // A definition that is not inheritable would not reach the notes on the board at all.
            this.statusDefinition?.attribute.isInheritable ?? true
        );
    }

    async insertRowAtPosition(
        column: string,
        relativeToBranchId: string,
        direction: "before" | "after") {
        const parentNoteId = this.isFolderMode ? column : this.parentNote.noteId;
        const { note, branch } = await note_create.createNote(parentNoteId, {
            activate: false,
            targetBranchId: relativeToBranchId,
            target: direction,
            title: t("board_view.new-item")
        });

        if (!note || !branch) {
            throw new Error("Failed to create note");
        }

        if (!this.isFolderMode) {
            await this.changeColumn(note.noteId, column);
        }
        this.startEditing(branch.branchId);

        return note;
    }

    openNote(noteId: string) {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: noteId });
    }

    startEditing(branchId: string) {
        this.setBranchIdToEdit(branchId);
    }

    dismissEditingTitle() {
        this.setBranchIdToEdit(undefined);
    }

    renameCard(noteId: string, newTitle: string) {
        return server.put(`notes/${noteId}/title`, { title: newTitle.trim() });
    }

    removeFromBoard(noteId: string) {
        if (this.isFolderMode) return;
        const note = froca.getNoteFromCache(noteId);
        if (!note) return;
        if (this.isRelationMode) {
            return attributes.removeOwnedRelationByName(note, this.statusAttribute);
        }
        return attributes.removeOwnedLabelByName(note, this.statusAttribute);
    }

    async moveWithinBoard(noteId: string, sourceBranchId: string, sourceIndex: number, targetIndex: number, sourceColumn: string, targetColumn: string) {
        if (this.isFolderMode) {
            if (sourceColumn === targetColumn && sourceIndex === targetIndex) return;
            await this.placeInFolder(sourceBranchId, targetColumn, targetIndex);
            return;
        }

        const targetItems = this.byColumn?.get(targetColumn) ?? [];

        const note = froca.getNoteFromCache(noteId);
        if (!note) return;

        if (sourceColumn !== targetColumn) {
            // Moving to a different column
            await this.changeColumn(noteId, targetColumn);

            // If there are items in the target column, reorder
            if (targetItems.length > 0 && targetIndex < targetItems.length) {
                const targetBranch = targetItems[targetIndex].branch;
                await branches.moveBeforeBranch([ sourceBranchId ], targetBranch.branchId);
            }
        } else if (sourceIndex !== targetIndex) {
            // Reordering within the same column
            let targetBranchId: string | null = null;

            if (targetIndex < targetItems.length) {
                // Moving before an existing item
                const adjustedIndex = sourceIndex < targetIndex ? targetIndex : targetIndex;
                if (adjustedIndex < targetItems.length) {
                    targetBranchId = targetItems[adjustedIndex].branch.branchId;
                    if (targetBranchId) {
                        await branches.moveBeforeBranch([ sourceBranchId ], targetBranchId);
                    }
                }
            } else if (targetIndex > 0) {
                // Moving to the end - place after the last item
                const lastItem = targetItems[targetItems.length - 1];
                await branches.moveAfterBranch([ sourceBranchId ], lastItem.branch.branchId);
            }
        }
    }

    /**
     * Places a note dragged from the note tree into a folder column at `targetIndex`. A note that
     * already has a card on the board is moved there. Any other note is cloned into the folder, so
     * its place elsewhere in the tree stays.
     */
    async dropFromTree(noteId: string, column: string, targetIndex: number) {
        const card = this.findCard(noteId);
        if (card) {
            await this.placeInFolder(card.branchId, column, targetIndex);
            return;
        }

        const targetItems = this.byColumn?.get(column) ?? [];
        if (targetIndex > 0 && targetItems.length) {
            const afterItem = targetItems[Math.min(targetIndex, targetItems.length) - 1];
            await branches.cloneNoteAfter(noteId, afterItem.branch.branchId);
        } else {
            await branches.cloneNoteToParentNote(noteId, column);
        }
    }

    /**
     * Moves a card's branch into the folder of `column`, before the card now at `targetIndex`, or
     * last when `targetIndex` is past the end. A move to another folder replaces the branch, so
     * `branchId` must not be used again afterwards.
     */
    private async placeInFolder(branchId: string, column: string, targetIndex: number) {
        const targetItems = this.byColumn?.get(column) ?? [];

        if (targetIndex < targetItems.length) {
            const beforeBranchId = targetItems[targetIndex].branch.branchId;
            if (beforeBranchId !== branchId) {
                await branches.moveBeforeBranch([ branchId ], beforeBranchId);
            }
        } else if (targetItems.length) {
            const afterBranchId = targetItems[targetItems.length - 1].branch.branchId;
            if (afterBranchId !== branchId) {
                await branches.moveAfterBranch([ branchId ], afterBranchId);
            }
        } else {
            const folderBranch = this.folderBranches?.get(column);
            if (folderBranch) {
                await branches.moveToParentNote([ branchId ], folderBranch.branchId);
            }
        }
    }

    /** Moves a column's folder branch between its new neighbours in the board's child list. */
    private async moveFolder(column: string, nextColumn: string | undefined, previousColumn: string | undefined) {
        const branchId = this.folderBranches?.get(column)?.branchId;
        if (!branchId) return;

        const nextBranchId = nextColumn ? this.folderBranches?.get(nextColumn)?.branchId : undefined;
        const previousBranchId = previousColumn ? this.folderBranches?.get(previousColumn)?.branchId : undefined;
        if (nextBranchId) {
            await branches.moveBeforeBranch([ branchId ], nextBranchId);
        } else if (previousBranchId) {
            await branches.moveAfterBranch([ branchId ], previousBranchId);
        }
    }

    /** Finds a card and the column it sits in, by its branch when given, by its note otherwise. */
    private findCard(noteId: string, branchId?: string) {
        for (const [ column, cards ] of this.byColumn ?? []) {
            for (const card of cards) {
                if (branchId ? card.branch.branchId === branchId : card.note.noteId === noteId) {
                    return { column, branchId: card.branch.branchId };
                }
            }
        }
        return undefined;
    }

}

