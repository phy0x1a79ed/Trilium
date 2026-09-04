import { getLog } from "@triliumnext/core";

/**
 * The one module that knows this vault might be running inside awm.
 *
 * awm is a personal workspace runtime; where it hosts Trilium, it also runs a gateway on loopback
 * that owns the slice tokens (see `slice.ts` in trilium-core for what a slice is). Minting a link
 * means asking that gateway, so this holds the call and nothing else in the vault has to know the
 * gateway exists.
 *
 * Server-only on purpose: it reads `process.env` and calls out over HTTP, neither of which
 * `packages/trilium-core` may do, since core also runs in standalone's browser worker.
 */

/** The gateway to invoke through, and the public origin it builds links from. */
function hubUrl(): string | undefined {
    return process.env.AWM_HUB_URL?.trim() || undefined;
}

function edgeUrl(): string | undefined {
    return process.env.AWM_EDGE_URL?.trim() || undefined;
}

/**
 * Whether this instance can mint slice links at all.
 *
 * Both variables are needed and for different reasons: without the hub there is nothing to mint
 * through, and without the edge origin awm would build a link nobody outside can follow.
 */
export function isAvailable(): boolean {
    return hubUrl() !== undefined && edgeUrl() !== undefined;
}

/**
 * Call an awm verb and return its result.
 *
 * Deliberately sends no `X-Awm-As` header. The gateway reads an absent identity as the operator,
 * which is what the slice verbs require; an empty string is not absent, and the verb would refuse
 * it as an unknown caller.
 */
export async function invoke<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const hub = hubUrl();
    if (!hub) {
        throw new Error("this Trilium is not running inside awm");
    }
    const response = await fetch(`${hub.replace(/\/+$/, "")}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const payload = await response.json().catch(() => null) as GatewayResponse | null;
    if (!response.ok) {
        const message = describeFailure(payload) ?? `${response.status} ${response.statusText}`;
        getLog().error(`awm ${name} failed: ${message}`);
        throw new Error(message);
    }
    return parseResult(payload?.result) as T;
}

const TIMEOUT_MS = 15_000;

interface GatewayResponse {
    result?: unknown;
    detail?: string | { error?: string; error_class?: string };
}

/**
 * The result as an object, however the gateway chose to hand it over.
 *
 * A verb returns a mapping, which arrives either as JSON or as a JSON string — the MCP shape, where
 * a tool's output is text.
 */
function parseResult(result: unknown): unknown {
    if (typeof result !== "string") {
        return result;
    }
    try {
        return JSON.parse(result);
    } catch {
        return result;
    }
}

/** What the gateway said went wrong: a bare string for a mapped error, a mapping for the rest. */
function describeFailure(payload: GatewayResponse | null): string | undefined {
    const detail = payload?.detail;
    if (typeof detail === "string") {
        return detail;
    }
    return detail?.error;
}
