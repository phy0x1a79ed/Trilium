import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "../../package.json" with { type: "json" };

describe("asset_path", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("./utils");
    });

    it("appends /src suffix in dev mode", async () => {
        vi.resetModules();
        vi.doMock("./utils", () => ({ isDev: true }));

        const mod = await import("./asset_path.js");
        expect(mod.assetUrlFragment).toBe(`assets/v${packageJson.version}`);
        expect(mod.default).toBe(`assets/v${packageJson.version}/src`);
    });

    it("omits /src suffix outside dev mode", async () => {
        vi.resetModules();
        vi.doMock("./utils", () => ({ isDev: false }));

        const mod = await import("./asset_path.js");
        expect(mod.default).toBe(`assets/v${packageJson.version}`);
    });
});

describe("hashDirectory", () => {
    it("changes with a file's content and name, and is undefined for a missing directory", async () => {
        const { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } = await import("fs");
        const { tmpdir } = await import("os");
        const path = await import("path");
        const { hashDirectory } = await import("./asset_path.js");

        const dir = mkdtempSync(path.join(tmpdir(), "trilium-translations-"));
        try {
            mkdirSync(path.join(dir, "en"));
            writeFileSync(path.join(dir, "en", "translation.json"), `{"a":"A"}`);
            const first = hashDirectory(dir);
            expect(first).toMatch(/^[0-9a-f]{12}$/);
            expect(hashDirectory(dir)).toBe(first);

            writeFileSync(path.join(dir, "en", "translation.json"), `{"a":"A","b":"B"}`);
            const second = hashDirectory(dir);
            expect(second).not.toBe(first);

            renameSync(path.join(dir, "en", "translation.json"), path.join(dir, "en", "entry.json"));
            expect(hashDirectory(dir)).not.toBe(second);

            expect(hashDirectory(path.join(dir, "missing"))).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
