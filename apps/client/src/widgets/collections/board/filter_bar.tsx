import clsx from "clsx";

import { t } from "../../../services/i18n";
import { ChipColorOverrides, getChipColorProps } from "../../attribute_widgets/chip_colors";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import type BoardApi from "./api";
import type { BoardChipFilter } from "./filters";

/** Lists the chips the board is narrowed to, each with a button that drops it, and one that drops all. */
export default function FilterBar({ api, filters, chipColors }: {
    api: BoardApi;
    filters: BoardChipFilter[];
    chipColors: ChipColorOverrides;
}) {
    if (filters.length === 0) return null;

    return (
        <div className="board-filter-bar">
            <span className="board-filter-label">{t("board_view.filtered-by")}</span>
            <div className="user-attributes">
                {filters.map(({ name, value }) => {
                    const color = getChipColorProps(name, value, chipColors);
                    return (
                        <span
                            key={`${name}=${value}`}
                            className={clsx("user-attribute", "type-label", "board-filter-chip", color.className)}
                            style={color.style}
                        >
                            <strong>{name}:</strong>{" "}{value}
                            <ActionButton
                                icon="bx bx-x"
                                text={t("board_view.remove-filter")}
                                className="board-filter-remove"
                                onClick={() => api.removeFilter(name, value)}
                            />
                        </span>
                    );
                })}
            </div>
            <Button
                className="board-filter-clear"
                kind="lowProfile"
                size="small"
                text={t("board_view.clear-filters")}
                onClick={() => api.clearFilters()}
            />
        </div>
    );
}
