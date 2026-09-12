import options from "../../services/options.js";
import slice from "../../services/slice.js";
import FlexContainer from "./flex_container.js";
import appContext, { type EventData } from "../../components/app_context.js";
import type Component from "../../components/component.js";

export default class LeftPaneContainer extends FlexContainer<Component> {
    private currentLeftPaneVisible: boolean;

    constructor() {
        super("column");

        // A slice carries no left-pane toggle, so its tree is always shown rather than following the
        // owner's own `leftPaneVisible`, which a visitor could neither see nor change.
        this.currentLeftPaneVisible = slice.isSlice() || options.is("leftPaneVisible");

        this.id("left-pane");
        this.css("height", "100%");
        this.collapsible();
    }

    isEnabled() {
        return super.isEnabled() && this.currentLeftPaneVisible;
    }

    setLeftPaneVisibilityEvent({ leftPaneVisible }: EventData<"setLeftPaneVisibility">) {
        this.currentLeftPaneVisible = leftPaneVisible ?? !this.currentLeftPaneVisible;
        const visible = this.isEnabled();
        this.toggleInt(visible);
        this.parent?.$widget.toggleClass("left-pane-hidden", !visible);

        if (visible) {
            this.triggerEvent("focusTree", {});
        } else {
            const ntxId = appContext.tabManager.getActiveContext()?.ntxId;
            const noteContainer = document.querySelector(`.note-split[data-ntx-id="${ntxId}"]`);
            if (!noteContainer?.contains(document.activeElement)) {
                this.triggerEvent("focusOnDetail", { ntxId });
            }
        }

        options.save("leftPaneVisible", this.currentLeftPaneVisible.toString());
    }
}
