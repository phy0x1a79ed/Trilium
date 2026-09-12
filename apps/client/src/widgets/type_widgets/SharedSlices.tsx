import "./SharedSlices.css";

import type { SliceInfo, SlicesResponse } from "@triliumnext/commons";
import { useCallback, useMemo, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import slice from "../../services/slice";
import { SliceLinkRow } from "../dialogs/share_slice";
import ActionButton from "../react/ActionButton";
import { Card } from "../react/Card";
import FormCheckbox from "../react/FormCheckbox";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { useFetch } from "../react/use_fetch";

/**
 * Every slice link the vault has handed out, on one screen.
 *
 * The share dialog shows the links on one note, reached by right-clicking that note. This is the
 * other way round: the vault's own audit, which is the only way to find a link whose note nobody
 * remembers sharing.
 */
export default function SharedSlices() {
    // Whether an awm gateway stands in front of this Trilium is settled before the page loads, so
    // the list below is never mounted where its route would refuse.
    if (!slice.isSharingAvailable()) {
        return (
            <div className="shared-slices">
                <NoItems icon="bx bx-link" text={t("shared_slices.unavailable")} />
            </div>
        );
    }

    return <SliceList />;
}

function SliceList() {
    const [ showInactive, setShowInactive ] = useState(false);
    const [ refreshToken, setRefreshToken ] = useState(0);
    const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);
    const { data, failed } = useFetch<SlicesResponse>("slices", refreshToken);
    const groups = useMemo(
        () => groupByNote(data?.slices ?? [], showInactive),
        [ data, showInactive ]
    );

    return (
        <div className="shared-slices">
            <p className="shared-slices-explanation">{t("shared_slices.explanation")}</p>

            <div className="shared-slices-controls">
                <FormCheckbox
                    label={t("shared_slices.show_inactive")}
                    currentValue={showInactive}
                    onChange={setShowInactive}
                />
                <ActionButton
                    icon="bx bx-refresh" text={t("shared_slices.refresh")}
                    onClick={refresh}
                />
            </div>

            {data === null
                ? <NoItems
                    icon={failed ? "bx bx-error" : "bx bx-loader-alt bx-spin"}
                    text={t(failed ? "shared_slices.failed" : "shared_slices.loading")}
                />
                : groups.length === 0
                    ? <NoItems icon="bx bx-link" text={t("shared_slices.none")} />
                    : groups.map((group) => (
                        <Card
                            key={group.noteId}
                            heading={group.title ?? group.noteId}
                            actions={<NoteLink
                                notePath={group.noteId}
                                title={t("shared_slices.open_note")}
                                noPreview
                            />}
                        >
                            <ul className="share-slice-list">
                                {group.slices.map((sliceInfo) => (
                                    <SliceLinkRow
                                        key={sliceInfo.token}
                                        slice={sliceInfo}
                                        onRevoked={refresh}
                                    />
                                ))}
                            </ul>
                        </Card>
                    ))}
        </div>
    );
}

interface SliceGroup {
    noteId: string;
    title: string | null;
    slices: SliceInfo[];
}

/**
 * The links on one note, gathered into one card each.
 *
 * The route answers newest first and this keeps that order, so the note shared most recently heads
 * the page. A revoked or expired link is left out unless the page is asking for the whole audit.
 */
function groupByNote(slices: SliceInfo[], showInactive: boolean): SliceGroup[] {
    const groups = new Map<string, SliceGroup>();

    for (const sliceInfo of slices) {
        if (!sliceInfo.active && !showInactive) {
            continue;
        }

        const group = groups.get(sliceInfo.noteId)
            ?? { noteId: sliceInfo.noteId, title: sliceInfo.title, slices: [] };
        group.slices.push(sliceInfo);
        groups.set(sliceInfo.noteId, group);
    }

    return [ ...groups.values() ];
}
