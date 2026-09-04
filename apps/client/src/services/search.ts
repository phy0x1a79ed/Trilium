import server from "./server.js";
import froca from "./froca.js";
import slice from "./slice.js";

async function searchForNoteIds(searchString: string) {
    // Search is not a route a slice may call, and several widgets look for notes across the whole
    // vault as they load. Answering nothing is what they already handle.
    if (slice.isSlice()) {
        return [];
    }

    return await server.get<string[]>(`search/${encodeURIComponent(searchString)}`);
}

async function searchForNotes(searchString: string) {
    const noteIds = await searchForNoteIds(searchString);

    return await froca.getNotes(noteIds);
}

export default {
    searchForNoteIds,
    searchForNotes
};
