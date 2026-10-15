import type FNote from "../../../entities/fnote";

/**
 * One message of a chat collection, as its note's labels describe it.
 *
 * A message is sealed once something outside the client (the awm board) stamps it with `msgSeq`,
 * `msgAt` and `msgFrom`. Until then it is a note this client created, shown as still sending.
 */
export interface ChatEntry {
    noteId: string;
    seq: number | null;
    at: string | null;
    from: string | null;
}

/** The chat's messages in sequence order, with the unsealed ones after them in tree order. */
export function chatEntries(notes: FNote[]): ChatEntry[] {
    const entries = notes.map((note): ChatEntry => {
        const seq = Number.parseInt(note.getLabelValue("msgSeq") ?? "", 10);
        return {
            noteId: note.noteId,
            seq: Number.isFinite(seq) ? seq : null,
            at: note.getLabelValue("msgAt"),
            from: note.getLabelValue("msgFrom")
        };
    });
    const sealed = entries.filter(entry => entry.seq !== null).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return [ ...sealed, ...entries.filter(entry => entry.seq === null) ];
}
