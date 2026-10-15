import type FNote from "../../../entities/fnote";
import type { ColumnMap } from "./data";

/** A chip the board is narrowed to: only cards whose label `name` holds `value` stay visible. */
export interface BoardChipFilter {
    name: string;
    value: string;
}

/**
 * Reads the filters out of a stored view config. The config is JSON from an attachment that other
 * clients and tools can write, so anything that is not a `{ name, value }` pair of non-empty
 * strings is dropped, and a repeated pair is kept once.
 */
export function readFilters(config: { filters?: unknown } | undefined): BoardChipFilter[] {
    if (!Array.isArray(config?.filters)) return [];

    const filters: BoardChipFilter[] = [];
    for (const entry of config.filters) {
        if (typeof entry?.name !== "string" || typeof entry?.value !== "string") continue;
        if (!entry.name || !entry.value || hasFilter(filters, entry.name, entry.value)) continue;
        filters.push({ name: entry.name, value: entry.value });
    }
    return filters;
}

export function hasFilter(filters: readonly BoardChipFilter[], name: string, value: string) {
    return filters.some(filter => filter.name === name && filter.value === value);
}

/** Removes the filter when it is active and appends it otherwise. */
export function toggleFilter(filters: readonly BoardChipFilter[], name: string, value: string): BoardChipFilter[] {
    return hasFilter(filters, name, value)
        ? filters.filter(filter => filter.name !== name || filter.value !== value)
        : [ ...filters, { name, value } ];
}

/** Whether the note satisfies every filter. Two filters on one label name both need a value of that label. */
export function matchesFilters(note: FNote, filters: readonly BoardChipFilter[]) {
    return filters.every(({ name, value }) => note.getLabels(name).some(label => label.value === value));
}

/** Narrows every column to its matching cards. A column left empty stays in the map. */
export function filterColumns(byColumn: ColumnMap, filters: readonly BoardChipFilter[]): ColumnMap {
    if (filters.length === 0) return byColumn;

    const filtered: ColumnMap = new Map();
    for (const [ column, cards ] of byColumn) {
        filtered.set(column, cards.filter(({ note }) => matchesFilters(note, filters)));
    }
    return filtered;
}
