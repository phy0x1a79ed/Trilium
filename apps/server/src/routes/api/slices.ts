import { CreateSliceRequest, SliceInfo, SlicesResponse } from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import * as awm from "../../services/awm_gateway.js";

/**
 * Minting, listing and revoking the awm slice links that open one note to somebody with no account.
 *
 * Server-only, not core: every handler calls out to the awm gateway over loopback HTTP, which the
 * standalone WASM build has neither the transport nor the gateway for.
 *
 * A slice visitor cannot reach any of this. `slice_mask.ts` refuses every route it does not name
 * and names none of these, so a link can never mint a second link.
 */

async function getSlices(req: Request<{ noteId: string }>) {
    requireAwm();
    const result = await awm.invoke<{ slices: AwmSlice[] }>("trilium_slice_list", {
        note_id: req.params.noteId
    });
    return { slices: result.slices.map(toSliceInfo) } satisfies SlicesResponse;
}

async function createSlice(req: Request<unknown, unknown, CreateSliceRequest>) {
    requireAwm();
    const { noteId, user, write, expiresInHours } = req.body;
    if (!noteId) {
        throw new ValidationError("noteId is required");
    }
    const slice = await awm.invoke<AwmSlice>("trilium_slice_expose", {
        note_id: noteId,
        user: user?.trim() || undefined,
        write: write === true,
        expires_in_hours: expiresInHours
    });
    return toSliceInfo(slice) satisfies SliceInfo;
}

async function revokeSlice(req: Request<{ token: string }>) {
    requireAwm();
    await awm.invoke("trilium_slice_revoke", { token: req.params.token });
}

export default {
    getSlices,
    createSlice,
    revokeSlice
};

function requireAwm() {
    if (!awm.isAvailable()) {
        throw new ValidationError("this Trilium cannot mint slice links");
    }
}

/** A slice row as awm writes it, which is snake_case and carries seconds since the epoch. */
interface AwmSlice {
    token: string;
    note_id: string;
    user: string | null;
    write: boolean;
    created_at: number;
    expires_at: number | null;
    revoked_at: number | null;
    active: boolean;
    url: string;
}

function toSliceInfo(slice: AwmSlice): SliceInfo {
    return {
        token: slice.token,
        noteId: slice.note_id,
        user: slice.user,
        write: slice.write,
        createdAt: slice.created_at,
        expiresAt: slice.expires_at,
        revokedAt: slice.revoked_at,
        active: slice.active,
        url: slice.url
    };
}
