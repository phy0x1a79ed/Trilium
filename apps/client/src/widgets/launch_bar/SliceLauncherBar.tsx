import { useEffect } from "preact/hooks";

import appContext from "../../components/app_context";
import { t } from "../../services/i18n";
import resizer from "../../services/resizer";
import slice from "../../services/slice";
import { LaunchBarActionButton, LaunchBarContext } from "./launch_bar_widgets";

/**
 * The launcher bar a public slice shows.
 *
 * A fixed list, not the owner's `_lbVisibleLaunchers` subtree, which lives outside every slice and
 * which `slice_mask.ts` refuses. What a slice offers is decided here, so a launcher added upstream is
 * absent until somebody adds it. Every launcher here acts on the slice root rather than on the vault.
 */
export default function SliceLauncherBar({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    // `LeftPaneToggle` sizes the left pane for the owner, and it is one of the launchers left out.
    // Without the resizer, Split never runs and the note tree renders zero pixels wide.
    useEffect(() => {
        resizer.setupLeftPaneResizer(true);
    }, []);

    // A Trilium search is a saved note, so the search launcher needs a link that writes. A link that
    // only reads searches the same subtree through jump-to-note, which asks the same scoped route.
    const canWrite = slice.canWrite();

    return (
        <div
            id="launcher-container"
            style={{
                display: "flex",
                flexGrow: 1,
                flexDirection: isHorizontalLayout ? "row" : "column"
            }}
        >
            <LaunchBarContext.Provider value={{ isHorizontalLayout }}>
                {canWrite && <>
                    <LaunchBarActionButton
                        icon="bx bx-file-blank"
                        text={t("slice_launcher.new_note")}
                        triggerCommand="createNoteIntoInbox"
                    />
                    <LaunchBarActionButton
                        icon="bx bx-search"
                        text={t("slice_launcher.search")}
                        triggerCommand="searchNotes"
                    />
                </>}
                <LaunchBarActionButton
                    icon="bx bx-send"
                    text={t("slice_launcher.jump_to_note")}
                    triggerCommand="jumpToNote"
                />
                <LaunchBarActionButton
                    icon="bx bxs-network-chart"
                    text={t("slice_launcher.note_map")}
                    onClick={() => void openSliceNoteMap()}
                />
                <LaunchBarActionButton
                    icon="bx bx-history"
                    text={t("slice_launcher.recent_changes")}
                    triggerCommand="showRecentChanges"
                />
            </LaunchBarContext.Provider>
        </div>
    );
}

/**
 * Opens the slice root as a note map, which is what the owner's launcher does with `_globalNoteMap`:
 * that note lives in the hidden subtree, so a slice draws its own root instead.
 */
function openSliceNoteMap() {
    return appContext.tabManager.openTabWithNoteWithHoisting(slice.defaultRootNoteId(), {
        activate: true,
        viewScope: { viewMode: "note-map" }
    });
}
