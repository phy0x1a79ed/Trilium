import type { EntityChange, WebSocketMessage } from "@triliumnext/commons";
import { getLog, shouldLogMessage, slice, type ClientMessageHandler, type MessagingProvider } from "@triliumnext/core";
import type { IncomingMessage, Server as HttpServer } from "http";
import type express from "express";
import { WebSocket, WebSocketServer } from "ws";

import config from "./config.js";
import { randomString } from "./utils.js";

type SessionParser = (req: IncomingMessage, params: {}, cb: () => void) => void;

/**
 * A live connection tagged with the slice it belongs to. `sliceContext` is `null` for every
 * signed-in person's connection, which is ordinary traffic and passes through untouched.
 */
type ConnectedSocket = WebSocket & { id: string; sliceContext: slice.SliceContext | null };

/**
 * A messaging provider that serves clients over the TCP HTTP listener and so
 * needs the `http.Server` (and session parser for auth) handed to it once www.ts
 * has built them. www.ts detects this capability via the type guard below rather
 * than a concrete `instanceof`, so a desktop composite that wraps a WS provider
 * qualifies too.
 */
export interface HttpAttachableMessagingProvider extends MessagingProvider {
    attachToHttpServer(httpServer: HttpServer, sessionParser: express.RequestHandler): void;
}

export function isHttpAttachableMessagingProvider(provider: MessagingProvider): provider is HttpAttachableMessagingProvider {
    return typeof (provider as Partial<HttpAttachableMessagingProvider>).attachToHttpServer === "function";
}

/**
 * WebSocket-based implementation of MessagingProvider.
 *
 * Handles the raw WebSocket transport: server setup, connection management,
 * message serialization, and client tracking.
 *
 * Used directly by the server build, and by the Electron desktop build only when
 * the user has opted into LAN/network access — there it's wrapped in a composite
 * alongside the IPC provider so browser clients get live updates while the trusted
 * renderer keeps talking over IPC. Without that opt-in the desktop binds no WS
 * endpoint. See `apps/desktop/src/composite_messaging_provider.ts`.
 */
export default class WebSocketMessagingProvider implements HttpAttachableMessagingProvider {
    private webSocketServer!: WebSocketServer;
    private clientMap = new Map<string, WebSocket>();
    private clientMessageHandler?: ClientMessageHandler;

    attachToHttpServer(httpServer: HttpServer, sessionParser: express.RequestHandler) {
        this.webSocketServer = new WebSocketServer({
            verifyClient: (info, done) => {
                sessionParser(info.req as express.Request, {} as express.Response, () => {
                    const allowed = (info.req as any).session.loggedIn || (config.General && config.General.noAuthentication);

                    if (!allowed) {
                        getLog().error("WebSocket connection not allowed: session is not logged in.");
                    }

                    done(allowed);
                });
            },
            server: httpServer
        });

        this.webSocketServer.on("connection", (ws, req) => {
            const id = randomString(10);
            const socket = ws as ConnectedSocket;
            socket.id = id;
            // Headers are only present on the upgrade request, which is why this is read here
            // rather than later against the open connection.
            socket.sliceContext = slice.readSliceContext(req.headers);
            this.clientMap.set(id, ws);

            console.log(`websocket client connected`);

            ws.on("error", (error) => {
                // A protocol error on a single connection (e.g. WS_ERR_INVALID_CLOSE_CODE from a
                // malformed close frame sent by a browser going to sleep) emits an "error" event on
                // this socket. Without a listener, Node's EventEmitter rethrows it as an uncaught
                // exception and crashes the whole process. Log and drop the connection instead.
                // https://github.com/TriliumNext/Trilium/issues/9598
                console.error("WebSocket connection error:", error);
                this.clientMap.delete(id);
            });

            ws.on("message", (messageJson) => {
                void (async () => {
                    try {
                        const message = JSON.parse(messageJson as any);

                        if (this.clientMessageHandler) {
                            await this.clientMessageHandler(id, message);
                        }
                    } catch (e) {
                        // A malformed message (invalid JSON) or a failing handler must not
                        // crash the process via an unhandled rejection on this floating promise.
                        console.error("Failed to process websocket message:", e);
                    }
                })();
            });

            ws.on("close", () => {
                this.clientMap.delete(id);
            });
        });

        this.webSocketServer.on("error", (error) => {
            // https://github.com/zadam/trilium/issues/3374#issuecomment-1341053765
            console.log(error);
        });
    }

    /**
     * Register a handler for incoming client messages.
     */
    setClientMessageHandler(handler: ClientMessageHandler) {
        this.clientMessageHandler = handler;
    }

    sendMessageToAllClients(message: WebSocketMessage): void {
        if (!this.webSocketServer) {
            return;
        }

        const jsonStr = JSON.stringify(message);

        if (shouldLogMessage(message)) {
            getLog().info(`Sending message to all clients: ${jsonStr}`);
        }

        for (const client of this.webSocketServer.clients) {
            if (client.readyState !== WebSocket.OPEN) {
                continue;
            }

            const context = (client as ConnectedSocket).sliceContext;
            if (!context) {
                client.send(jsonStr);
                continue;
            }

            const scoped = scopeMessageToSlice(message, context);
            if (scoped) {
                client.send(JSON.stringify(scoped));
            }
        }
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        const client = this.clientMap.get(clientId);
        if (!client || client.readyState !== WebSocket.OPEN) {
            return false;
        }

        client.send(JSON.stringify(message));
        return true;
    }

    getClientCount(): number {
        return this.webSocketServer?.clients?.size ?? 0;
    }

    dispose(): void {
        this.webSocketServer?.close();
        this.clientMap.clear();
    }
}

/**
 * The note id that decides whether an entity change belongs to a slice, keyed by
 * `entityChange.entityName`. An entity type absent here names no note at all, so a slice
 * connection is never told about it — the same fail-closed rule `slice_mask.ts` applies to routes.
 */
function noteIdForSliceCheck(entityChange: EntityChange): string | null {
    switch (entityChange.entityName) {
        case "notes":
            return entityChange.entityId;
        case "note_reordering":
            // `entityId` is the parent note whose children were reordered; see putNoteReorderingEntityChange.
            return entityChange.entityId;
        case "revisions":
            return entityChange.noteId ?? null;
        case "branches":
            return (entityChange.entity as { noteId?: string } | undefined)?.noteId ?? null;
        case "attributes":
            return (entityChange.entity as { noteId?: string } | undefined)?.noteId ?? null;
        case "attachments":
            return (entityChange.entity as { ownerId?: string } | undefined)?.ownerId ?? null;
        default:
            // options, blobs, etapi_tokens, and any future entity type: dropped for a slice connection.
            return null;
    }
}

/**
 * The message types a slice connection may receive. Everything else is dropped rather than listed
 * as a hazard: `openNote` names a note the visitor cannot open, `toast`, `api-log-messages` and
 * `execute-script` carry text and script from wherever the vault was working, and a type added
 * later would otherwise reach a stranger's socket by default.
 */
const SLICE_MESSAGE_TYPES: ReadonlySet<WebSocketMessage["type"]> = new Set([
    "frontend-update", "ping", "reload-frontend",
    "sync-pull-in-progress", "sync-push-in-progress", "sync-finished", "sync-failed"
]);

/**
 * Scopes a broadcast down to what one slice connection may see: a message type off the list above
 * is dropped whole, and a `frontend-update` keeps only the entity changes `noteIdForSliceCheck` can
 * place inside the slice. `null` says send nothing, rather than an empty update.
 */
function scopeMessageToSlice(message: WebSocketMessage, context: slice.SliceContext): WebSocketMessage | null {
    if (!SLICE_MESSAGE_TYPES.has(message.type)) {
        return null;
    }
    if (message.type !== "frontend-update") {
        return message;
    }

    const entityChanges = message.data.entityChanges.filter(entityChange => {
        const noteId = noteIdForSliceCheck(entityChange);
        return noteId !== null && slice.isNoteInSlice(noteId, context.rootNoteId);
    });

    if (entityChanges.length === 0) {
        return null;
    }

    return { ...message, data: { ...message.data, entityChanges } };
}
