import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import packageJson from "../../package.json" with { type: "json" };
import { getResourceDir, isDev } from "./utils";

/**
 * The URL prefix for assets (e.g. `assets/v1.2.3`).
 */
export const assetUrlFragment = `assets/v${packageJson.version}`;

/**
 * Similar to the {@link assetUrlFragment}, but on dev mode it also contains the `/src` suffix.
 */
const assetPath = isDev ? assetUrlFragment + "/src" : assetUrlFragment;

export default assetPath;

let translationsVersion: string | undefined;

/**
 * A content hash of the built translation catalogues, which the client appends to their URLs.
 * They are cached for a year under {@link assetUrlFragment}, and a build can change a catalogue
 * without changing the version. `undefined` in development, where they are served uncached.
 */
export function getTranslationsVersion() {
    if (isDev) return undefined;
    translationsVersion ??= hashDirectory(path.join(getResourceDir(), "public", "translations"));
    return translationsVersion;
}

/** Hashes every file under `dir` with its relative path, or returns `undefined` if `dir` is missing. */
export function hashDirectory(dir: string) {
    if (!existsSync(dir)) return undefined;

    const hash = createHash("sha256");
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((file) => statSync(path.join(dir, file)).isFile())
        .sort();
    for (const file of files) {
        hash.update(file.split(path.sep).join("/"));
        hash.update(readFileSync(path.join(dir, file)));
    }
    return hash.digest("hex").slice(0, 12);
}
