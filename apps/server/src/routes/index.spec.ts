import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markAsInternalElectronRequest } from "../services/electron_request.js";

// Force the process-wide desktop-build flag ON so these tests reproduce the
// #10589 setup: a browser hitting the desktop app's HTTP listener. The gating
// must key off the per-request trusted-renderer marker, NOT this flag — that's
// exactly what the assertions below verify.
vi.mock("../services/utils.js", async (orig) => {
    const actual = await orig<typeof import("../services/utils.js")>();
    return { ...actual, isElectron: true, isDev: true, isMac: false, supportsBackgroundMaterial: false };
});

vi.mock("../services/config.js", () => ({ default: { General: {}, Network: {} } }));
vi.mock("../services/port.js", () => ({ default: 8080 }));
vi.mock("../services/app_path.js", () => ({ default: "app" }));
vi.mock("../services/asset_path.js", () => ({ default: "assets" }));
vi.mock("./csrf_protection.js", () => ({ generateCsrfToken: () => "csrf-test-token" }));
vi.mock("../services/open_id.js", () => ({
    default: { isOpenIDEnabled: () => false, getSSOIssuerName: () => "", getSSOIssuerIcon: () => "" }
}));
vi.mock("../services/totp.js", () => ({ default: { isTotpEnabled: () => false } }));

// A trimmed stand-in for trilium-core's real readSliceContext (packages/trilium-core/src/services/slice.ts):
// same three header names, same shape, but with no becca dependency to drag into a route spec.
vi.mock("@triliumnext/core", () => ({
    attributes: {},
    BNote: class {},
    getSharedBootstrapItems: () => ({}),
    icon_packs: { getIconPacks: () => [], generateCss: () => "", MIME_TO_EXTENSION_MAPPINGS: {} },
    options: { getOptionMap: () => ({}) },
    password: { isPasswordSet: () => true },
    slice: {
        readSliceContext: (headers: Record<string, string | undefined>) => {
            const rootNoteId = headers["x-awm-slice-root"];
            if (!rootNoteId) {
                return null;
            }
            return {
                rootNoteId,
                user: headers["x-awm-slice-user"] ?? null,
                canWrite: headers["x-awm-slice-write"] === "1"
            };
        }
    },
    sql_init: { isDbInitialized: () => true },
    task_states: { generateTaskStateCss: () => "" },
    getLog: () => ({ info: () => {}, error: () => {} })
}));

const { bootstrap, getView } = await import("./index.js");

function makeReq(overrides: {
    loggedIn?: boolean;
    internal?: boolean;
    query?: Record<string, unknown>;
    cookies?: Record<string, string>;
    userAgent?: string;
    headers?: Record<string, string>;
} = {}): Request {
    const req = {
        session: { loggedIn: overrides.loggedIn ?? false },
        query: overrides.query ?? {},
        headers: {
            ...(overrides.userAgent ? { "user-agent": overrides.userAgent } : {}),
            ...(overrides.headers ?? {})
        },
        cookies: overrides.cookies ?? {}
    } as unknown as Request;
    if (overrides.internal) {
        markAsInternalElectronRequest(req);
    }
    return req;
}

function makeRes(): { res: Response; body: () => any } {
    let captured: any;
    const res = { send: (payload: any) => { captured = payload; } } as unknown as Response;
    return { res, body: () => captured };
}

describe("bootstrap auth gating (desktop build, #10589)", () => {
    it("serves the login screen to an untrusted (browser) request even on a desktop build", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: false, internal: false }), res);

        // A browser hitting the desktop's HTTP listener must get the login screen,
        // not a spurious loggedIn:true (which stranded it with 401s on every API call).
        expect(body().loggedIn).toBe(false);
        expect(body().login).toBeTruthy();
        expect(body().csrfToken).toBeUndefined();
        // ...and it must NOT be told it's the Electron renderer (no `electron` body
        // class, no renderer-only trilium-app:// URLs).
        expect(body().isElectron).toBe(false);
        expect(body().wsBaseUrl).toBeUndefined();
    });

    it("treats a browser as logged in once it has a real session", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true, internal: false }), res);

        expect(body().loggedIn).toBe(true);
        expect(body().csrfToken).toBe("csrf-test-token");
    });

    it("bypasses the login screen for the trusted desktop renderer with no web session", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: false, internal: true }), res);

        // The trilium-app:// renderer is trusted and never gates on a web session.
        expect(body().loggedIn).toBe(true);
        expect(body().csrfToken).toBe("csrf-test-token");
        // It IS the Electron renderer, so it keeps the electron flag and the
        // absolute renderer-only URLs it can't derive from trilium-app://.
        expect(body().isElectron).toBe(true);
        expect(body().wsBaseUrl).toBeTruthy();
    });
});

describe("bootstrap slice payload", () => {
    it("leaves the payload exactly as it is today when the request carries no slice headers", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true }), res);

        expect(body().sliceRootNoteId).toBeUndefined();
        expect(body().sliceUser).toBeUndefined();
        expect("sliceRootNoteId" in body()).toBe(false);
        expect("sliceUser" in body()).toBe(false);
    });

    it("carries the slice root and visitor named by the edge's headers", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({
            loggedIn: true,
            headers: { "x-awm-slice-root": "sliceRoot1", "x-awm-slice-user": "Alice" }
        }), res);

        expect(body().sliceRootNoteId).toBe("sliceRoot1");
        expect(body().sliceUser).toBe("Alice");
    });

    it("carries a null visitor for an open slice link nobody has named yet", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({
            loggedIn: true,
            headers: { "x-awm-slice-root": "sliceRoot1" }
        }), res);

        expect(body().sliceRootNoteId).toBe("sliceRoot1");
        expect(body().sliceUser).toBeNull();
    });

    // What gates the "Share as slice" entry out of the note tree. Both variables are needed: the hub
    // to mint through, and the edge origin to build a followable link from.
    it("says sharing is unavailable without an awm gateway behind it", () => {
        vi.stubEnv("AWM_HUB_URL", "");
        vi.stubEnv("AWM_EDGE_URL", "");
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true }), res);

        expect(body().sliceSharingAvailable).toBe(false);
    });

    it("says sharing is available once both the hub and the edge origin are named", () => {
        vi.stubEnv("AWM_HUB_URL", "http://127.0.0.1:7819/");
        vi.stubEnv("AWM_EDGE_URL", "https://example.invalid");
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true }), res);

        expect(body().sliceSharingAvailable).toBe(true);
    });

    it("says sharing is unavailable with a hub but no public origin to build a link from", () => {
        vi.stubEnv("AWM_HUB_URL", "http://127.0.0.1:7819/");
        vi.stubEnv("AWM_EDGE_URL", "");
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true }), res);

        expect(body().sliceSharingAvailable).toBe(false);
    });

    afterEach(() => vi.unstubAllEnvs());
});

describe("getView view resolution (desktop build, #10720)", () => {
    it("resolves the mobile view when a browser hits a desktop build with the trilium-device=mobile cookie", () => {
        // "Switch to Mobile Version" sets this cookie and reloads. On a desktop
        // build the process-wide isElectron flag is true, but this browser request
        // is NOT the trusted renderer, so the cookie must still be honoured.
        // Previously getView short-circuited on the global flag and always returned
        // "desktop", so the mobile layout never activated.
        const req = makeReq({ internal: false, cookies: { "trilium-device": "mobile" } });

        expect(getView(req)).toBe("mobile");
    });

    it("keeps the desktop view for the trusted Electron renderer even with a mobile cookie", () => {
        const req = makeReq({ internal: true, cookies: { "trilium-device": "mobile" } });

        expect(getView(req)).toBe("desktop");
    });

    it("honours the print override above everything else", () => {
        const req = makeReq({ query: { print: "" }, cookies: { "trilium-device": "mobile" } });

        expect(getView(req)).toBe("print");
    });

    it("respects the ?mobile and ?desktop query overrides on a browser request", () => {
        expect(getView(makeReq({ query: { mobile: "" } }))).toBe("mobile");
        expect(getView(makeReq({ query: { desktop: "" } }))).toBe("desktop");
    });

    it("respects an explicit trilium-device=desktop cookie", () => {
        expect(getView(makeReq({ cookies: { "trilium-device": "desktop" } }))).toBe("desktop");
    });

    it("falls back to user-agent detection when no override is present", () => {
        const mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
        expect(getView(makeReq({ userAgent: mobileUa }))).toBe("mobile");

        const desktopUa = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome";
        expect(getView(makeReq({ userAgent: desktopUa }))).toBe("desktop");
    });
});
