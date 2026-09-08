import "./ColorSchemeSwitcher.css";

import { useColorSchemeSwitcher } from "../react/hooks";
import { LaunchBarActionButton, LauncherNoteProps } from "./launch_bar_widgets";

export default function ColorSchemeSwitcher({ launcherNote }: LauncherNoteProps) {
    const { icon, tooltip, isCustom, cycle } = useColorSchemeSwitcher();

    return (
        <LaunchBarActionButton
            launcherNote={launcherNote}
            className={`color-scheme-switcher${isCustom ? " unsupported" : ""}`}
            icon={icon}
            text={tooltip}
            tooltipHtml
            tooltipClass="color-scheme-switcher-tooltip"
            onClick={cycle}
        />
    );
}
