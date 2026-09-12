import { type CreateChildrenResponse, dayjs } from "@triliumnext/commons";

import type { FNoteRow } from "../entities/fnote.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import server from "./server.js";
import slice from "./slice.js";
import ws from "./ws.js";

async function getInboxNote() {
    const note = await server.get<FNoteRow>(`special-notes/inbox/${dayjs().format("YYYY-MM-DD")}`, "date-note");

    return await froca.getNote(note.noteId);
}

async function getTodayNote() {
    return await getDayNote(dayjs().format("YYYY-MM-DD"));
}

async function getDayNote(date: string, calendarRootId?: string) {
    let url = `special-notes/days/${date}`;
    if (calendarRootId) {
        url += `?calendarRootId=${calendarRootId}`;
    }

    const note = await server.get<FNoteRow>(url, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getWeekFirstDayNote(date: string) {
    const note = await server.get<FNoteRow>(`special-notes/week-first-day/${date}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getWeekNote(week: string) {
    const note = await server.get<FNoteRow>(`special-notes/weeks/${week}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note?.noteId);
}

async function getMonthNote(month: string) {
    const note = await server.get<FNoteRow>(`special-notes/months/${month}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getQuarterNote(quarter: string) {
    const note = await server.get<FNoteRow>(`special-notes/quarters/${quarter}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getYearNote(year: string) {
    const note = await server.get<FNoteRow>(`special-notes/years/${year}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function createSqlConsole() {
    const note = await server.post<FNoteRow>("special-notes/sql-console");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function createSearchNote(opts: SearchNoteOpts = {}) {
    if (slice.isSlice()) {
        return await createSliceSearchNote(opts);
    }

    const note = await server.post<FNoteRow>("special-notes/search-note", opts);

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

export interface SearchNoteOpts {
    searchString?: string | null;
    ancestorNoteId?: string | null;
}

/**
 * A search note inside a public slice, created through the ordinary create route.
 *
 * `/api/special-notes/search-note` files it under `_search` in the hidden subtree, outside every
 * slice. It lands as a child of the note the link opens instead, where the visitor can see it and
 * delete it, and its `~ancestor` is what bounds the search the server runs.
 */
async function createSliceSearchNote({ searchString, ancestorNoteId }: SearchNoteOpts) {
    const parentNoteId = slice.defaultRootNoteId();
    const { note } = await server.post<CreateChildrenResponse>(`notes/${parentNoteId}/children?target=into`, {
        title: t("slice_launcher.search_note_title", { searchString: searchString ?? "" }),
        content: "",
        type: "search",
        mime: "application/json",
        attributes: [
            { type: "label", name: "searchString", value: searchString ?? "" },
            { type: "label", name: "keepCurrentHoisting", value: "" },
            { type: "relation", name: "ancestor", value: ancestorNoteId || parentNoteId }
        ]
    });

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function createLlmChat() {
    const note = await server.post<FNoteRow>("special-notes/llm-chat");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

/**
 * Gets the most recently modified LLM chat.
 * Returns null if no chat exists.
 */
async function getMostRecentLlmChat() {
    const note = await server.get<FNoteRow | null>("special-notes/most-recent-llm-chat");

    if (!note) {
        return null;
    }

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

/**
 * Gets the most recent LLM chat, or creates a new one if none exists.
 * Used by sidebar chat for persistent conversations across page refreshes.
 */
async function getOrCreateLlmChat() {
    const note = await server.get<FNoteRow>("special-notes/get-or-create-llm-chat");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

export interface RecentLlmChat {
    noteId: string;
    title: string;
    dateModified: string;
}

/**
 * Gets a list of recent LLM chats for the history popup.
 */
async function getRecentLlmChats(limit: number = 10): Promise<RecentLlmChat[]> {
    return await server.get<RecentLlmChat[]>(`special-notes/recent-llm-chats?limit=${limit}`);
}

export default {
    getInboxNote,
    getTodayNote,
    getDayNote,
    getWeekFirstDayNote,
    getWeekNote,
    getQuarterNote,
    getMonthNote,
    getYearNote,
    createSqlConsole,
    createSearchNote,
    createLlmChat,
    getMostRecentLlmChat,
    getOrCreateLlmChat,
    getRecentLlmChats
};
