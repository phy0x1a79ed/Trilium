import "../launch_bar/ColorSchemeSwitcher.css";

import ActionButton from "../react/ActionButton";
import { useColorSchemeSwitcher } from "../react/hooks";

/** Cycles this browser between following the operating system, light and dark. */
export default function ColorSchemeToggle() {
    const { icon, tooltip, isCustom, cycle } = useColorSchemeSwitcher();

    return (
        <ActionButton
            className={`toggle-button color-scheme-switcher${isCustom ? " unsupported" : ""}`}
            text={tooltip}
            tooltipHtml
            tooltipClass="color-scheme-switcher-tooltip"
            icon={icon}
            onClick={cycle}
        />
    );
}
