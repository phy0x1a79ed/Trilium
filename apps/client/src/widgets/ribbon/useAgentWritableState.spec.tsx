import { render } from "preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ setLabel: vi.fn(), removeOwnedLabelByName: vi.fn(), showError: vi.fn() }));

vi.mock("../react/hooks", () => ({
    useNoteLabel: () => [ null, vi.fn() ],
    useNoteLabelBoolean: () => [ false, vi.fn() ],
    useNoteProperty: () => undefined,
    useTriliumEvent: () => {},
    useTriliumOption: () => [ "", vi.fn() ]
}));
vi.mock("../../services/i18n", () => ({
    t: (key: string, opts?: { notes?: string }) => (opts?.notes ? `${key}|${opts.notes}` : key),
    getAvailableLocales: () => [],
    getLocaleById: () => null
}));
vi.mock("../../services/attributes", async (importOriginal) => {
    const real = (await importOriginal<typeof import("../../services/attributes")>()).default;
    return { default: { ...real, setLabel: spies.setLabel, removeOwnedLabelByName: spies.removeOwnedLabelByName } };
});
vi.mock("../../services/toast", () => ({ default: { showError: spies.showError } }));

import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { useAgentWritableState } from "./BasicPropertiesTab";

function runHook(noteId: string) {
    const note = froca.getNoteFromCache(noteId);
    if (!note) throw new Error(`no note ${noteId}`);
    let result: ReturnType<typeof useAgentWritableState> | undefined;
    function Probe() {
        result = useAgentWritableState(note as NonNullable<typeof note>);
        return null;
    }
    const container = document.createElement("div");
    render(<Probe />, container);
    render(null, container);
    if (!result) throw new Error("the hook did not run");
    return result;
}

describe("useAgentWritableState", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildNote({
            id: "zone", title: "Zone", "#agentWritable(inheritable)": "",
            children: [ { id: "child", title: "Child" } ]
        });
        buildNote({ id: "plain", title: "Plain" });
    });

    it("turns on with an owned, inheritable label", () => {
        const [ on, set ] = runHook("plain");
        expect(on).toBe(false);
        set(true);
        expect(spies.setLabel).toHaveBeenCalledWith("plain", "agentWritable", "", true);
    });

    it("turns off on the note that grants it", () => {
        const [ on, set ] = runHook("zone");
        expect(on).toBe(true);
        set(false);
        expect(spies.removeOwnedLabelByName).toHaveBeenCalledWith(expect.objectContaining({ noteId: "zone" }), "agentWritable");
        expect(spies.showError).not.toHaveBeenCalled();
    });

    it("refuses to turn off an inherited grant and names the granting note", () => {
        const [ on, set ] = runHook("child");
        expect(on).toBe(true);
        set(false);
        expect(spies.showError).toHaveBeenCalledWith("agent_writable_switch.inherited|Zone");
        expect(spies.removeOwnedLabelByName).not.toHaveBeenCalled();
    });
});
