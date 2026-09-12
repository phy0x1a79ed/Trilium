import becca from "@triliumnext/core/src/becca/becca.js";
import { buildNote } from "@triliumnext/core/src/test/becca_easy_mocking.js";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import slicesRoute from "./slices.js";

/**
 * The transport between this vault and the awm gateway that owns the slice tokens.
 *
 * awm's own behaviour is not under test here — the gateway is stubbed. What is: that the call is
 * shaped the way the gateway expects, that a result arriving as a JSON string is read the same as
 * one arriving as JSON, and that the routes refuse to run at all without awm behind them.
 */

const AWM_ROW = {
    token: "tok123", note_id: "note1", user: "steven", write: true,
    created_at: 1700000000, expires_at: null, revoked_at: null, active: true,
    url: "https://example.invalid/slice/tok123/#root/note1"
};

describe("Slices API", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        becca.reset();
    });

    it("mints a link through the gateway and hands back what awm recorded", async () => {
        const fetchMock = stubAwm({ result: AWM_ROW });

        const slice = await slicesRoute.createSlice(req({
            body: { noteId: "note1", user: " steven ", write: true, expiresInHours: 24 }
        }));

        expect(slice).toEqual({
            token: "tok123", noteId: "note1", title: null, user: "steven", write: true,
            createdAt: 1700000000, expiresAt: null, revokedAt: null, active: true,
            url: "https://example.invalid/slice/tok123/#root/note1"
        });

        const [ url, init ] = fetchMock.mock.calls[0];
        expect(url).toBe("http://gateway.invalid/invoke");
        expect(JSON.parse(String(init.body))).toEqual({
            name: "trilium_slice_expose",
            args: { note_id: "note1", user: "steven", write: true, expires_in_hours: 24 }
        });
        // The gateway reads an absent identity as the operator, which is what the slice verbs want.
        // An empty string is not absent, and would be refused as an unknown caller.
        expect(Object.keys(init.headers)).not.toContain("X-Awm-As");
    });

    it("reads a result the gateway delivered as a JSON string", async () => {
        stubAwm({ result: JSON.stringify({ slices: [ AWM_ROW ] }) });

        const { slices } = await slicesRoute.getSlices(req({ params: { noteId: "note1" } }));

        expect(slices).toHaveLength(1);
        expect(slices[0].noteId).toBe("note1");
        expect(slices[0].createdAt).toBe(1700000000);
    });

    it("lists every slice on the vault when no note is named, and titles each row from becca", async () => {
        buildNote({ id: "note1", title: "Field notes" });
        const fetchMock = stubAwm({ result: { slices: [ AWM_ROW, { ...AWM_ROW, token: "tok456", note_id: "gone" } ] } });

        const { slices } = await slicesRoute.getAllSlices();

        expect(slices.map((slice) => slice.title)).toEqual([ "Field notes", null ]);
        // An absent note id means every slice, so the args carry nothing at all.
        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
            name: "trilium_slice_list", args: {}
        });
    });

    it("revokes by token and asks for nothing else", async () => {
        const fetchMock = stubAwm({ result: { token: "tok123", revoked: true } });

        await slicesRoute.revokeSlice(req({ params: { token: "tok123" } }));

        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
            name: "trilium_slice_revoke", args: { token: "tok123" }
        });
    });

    it("surfaces what the gateway said went wrong rather than a bare status", async () => {
        const error = "slice_expose needs the Trilium fork";
        const detail = { error_class: "PermissionError", error };
        stubAwm({ detail }, 500);

        await expect(slicesRoute.createSlice(req({ body: { noteId: "note1" } })))
            .rejects.toThrow("slice_expose needs the Trilium fork");
    });

    it("refuses every route without an awm gateway, and never calls out", async () => {
        const fetchMock = stubAwm({ result: AWM_ROW });
        vi.stubEnv("AWM_EDGE_URL", "");

        for (const call of [
            () => slicesRoute.getSlices(req({ params: { noteId: "note1" } })),
            () => slicesRoute.getAllSlices(),
            () => slicesRoute.createSlice(req({ body: { noteId: "note1" } })),
            () => slicesRoute.revokeSlice(req({ params: { token: "tok123" } }))
        ]) {
            await expect(call()).rejects.toThrow("cannot mint slice links");
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses to mint without a note to mint for", async () => {
        stubAwm({ result: AWM_ROW });

        await expect(slicesRoute.createSlice(req({ body: {} })))
            .rejects.toThrow("noteId is required");
    });
});

/** An awm gateway that answers one payload, with both environment variables in place. */
function stubAwm(payload: object, status = 200) {
    vi.stubEnv("AWM_HUB_URL", "http://gateway.invalid/");
    vi.stubEnv("AWM_EDGE_URL", "https://example.invalid");
    const fetchMock = vi.fn(async () => ({
        ok: status === 200,
        status,
        statusText: status === 200 ? "OK" : "Internal Server Error",
        json: async () => payload
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn> & {
        mock: { calls: [ string, { body: string; headers: Record<string, string> } ][] }
    };
}

function req({ body = {}, params = {} }: { body?: object; params?: Record<string, string> }) {
    return { body, params } as unknown as Request<any, any, any>;
}
