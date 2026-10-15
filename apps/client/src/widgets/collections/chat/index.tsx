import "./index.css";

import { TargetedKeyboardEvent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import { isIMEComposing } from "../../../services/shortcuts";
import toast from "../../../services/toast";
import CollectionProperties from "../../note_bars/CollectionProperties";
import Button from "../../react/Button";
import { useTriliumEvent } from "../../react/hooks";
import NoItems from "../../react/NoItems";
import { ViewModeProps } from "../interface";
import { chatEntries,ChatEntry } from "./entries";

type Message = ChatEntry & { body: string };

/**
 * A collection whose children are the messages of one conversation, oldest first.
 *
 * The view never edits a message. A message typed into it becomes a new plain-text child note, and
 * whatever owns the conversation seals it by stamping `msgSeq`, `msgAt` and `msgFrom`.
 */
export default function ChatView({ note, noteIds, notePath }: ViewModeProps<object>) {
    const messages = useMessages(noteIds);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [ messages?.length ]);

    return (
        <div className="chat-view">
            <CollectionProperties note={note} />
            <div className="chat-view-messages" ref={listRef}>
                {messages?.length === 0 && <NoItems icon="bx bx-conversation" text={t("chat_view.empty")} />}
                {messages?.map(message => <ChatBubble key={message.noteId} message={message} />)}
            </div>
            <ChatComposer notePath={notePath} />
        </div>
    );
}

function ChatBubble({ message }: { message: Message }) {
    const sending = message.seq === null;
    return (
        <div className={`chat-view-message ${sending ? "sending" : ""}`} data-note-id={message.noteId}>
            <div className="chat-view-message-header">
                {sending
                    ? <span className="chat-view-message-status">{t("chat_view.sending")}</span>
                    : <>
                        <span className="chat-view-message-from">{message.from}</span>
                        <span className="chat-view-message-at" title={message.at ?? ""}>{formatTime(message.at)}</span>
                    </>}
            </div>
            <div className="chat-view-message-body">{message.body}</div>
        </div>
    );
}

function ChatComposer({ notePath }: { notePath: string }) {
    const [ text, setText ] = useState("");
    const [ posting, setPosting ] = useState(false);

    const send = useCallback(async () => {
        const body = text.trim();
        if (!body || posting) return;
        setPosting(true);
        try {
            await note_create.createNote(notePath, {
                title: t("chat_view.unsent_title"),
                content: body,
                type: "code",
                mime: "text/plain",
                activate: false
            });
            setText("");
        } catch (e) {
            toast.showError(t("chat_view.send_failed", { message: (e as Error).message }));
        } finally {
            setPosting(false);
        }
    }, [ text, posting, notePath ]);

    const onKeyDown = useCallback((e: TargetedKeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey && !isIMEComposing(e)) {
            e.preventDefault();
            void send();
        }
    }, [ send ]);

    return (
        <div className="chat-view-composer">
            <textarea
                className="form-control"
                rows={2}
                value={text}
                placeholder={t("chat_view.placeholder")}
                disabled={posting}
                onInput={e => setText(e.currentTarget.value)}
                onKeyDown={onKeyDown}
            />
            <Button text={t("chat_view.send")} icon="bx bx-send" kind="primary" disabled={posting || !text.trim()} onClick={() => void send()} />
        </div>
    );
}

/** The messages with their bodies, reloaded whenever a message note, its labels or its body change. */
function useMessages(noteIds: string[]) {
    const [ messages, setMessages ] = useState<Message[]>();
    const refreshSeq = useRef(0);

    const refresh = useCallback(async () => {
        const seq = ++refreshSeq.current;
        const notes = await froca.getNotes(noteIds, true);
        const bodies = new Map(await Promise.all(notes.map(async note => [ note.noteId, await note.getContent() ] as const)));
        if (seq !== refreshSeq.current) return;
        setMessages(chatEntries(notes).map(entry => ({ ...entry, body: String(bodies.get(entry.noteId) ?? "") })));
    }, [ noteIds ]);

    useEffect(() => { void refresh(); }, [ refresh ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (noteIds.some(noteId => loadResults.isNoteReloaded(noteId) || loadResults.isNoteContentReloaded(noteId))
            || loadResults.getAttributeRows().some(attr => attr.noteId && noteIds.includes(attr.noteId))) {
            void refresh();
        }
    });

    return messages;
}

function formatTime(at: string | null) {
    const date = at ? new Date(at) : null;
    return date && !Number.isNaN(date.getTime())
        ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "";
}
