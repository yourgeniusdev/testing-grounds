import { beginActionPlanning, cancelActionPlanning, switchActionPlanning } from "./domain.js";

export function bindRulesDialog(dialog, opener, closeButtons) {
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];
  const panels = [...dialog.querySelectorAll('[role="tabpanel"]')];
  function selectTab(index, focus = true) {
    tabs.forEach((tab, current) => {
      tab.setAttribute("aria-selected", String(current === index));
      tab.tabIndex = current === index ? 0 : -1;
    });
    panels.forEach(panel => { panel.hidden = panel.id !== tabs[index].getAttribute("aria-controls"); });
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(index));
    tab.addEventListener("keydown", event => {
      const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(next);
    });
  });
  opener.addEventListener("click", () => {
    selectTab(0, false);
    dialog.showModal();
    tabs[0].focus();
  });
  closeButtons.forEach(button => button.addEventListener("click", () => dialog.close()));
  dialog.addEventListener("close", () => opener.focus());
}

export function clearActionTransients(ui) {
  ui.routes = new Map();
  ui.selected = null;
  ui.hoveredAction = null;
  ui.hoveredOption = null;
  ui.optionTargets = [];
  ui.hoveredWeapon = null;
  ui.tooltipHex = null;
}

export function pendingWeaponId(state) {
  return state?.lifecycle === "ActionPlanning" && state.activeAction?.type === "weapon-attack" ? state.activeAction.slotId : null;
}

export function selectPendingAction(state, ui, action) {
  const selected = state.lifecycle === "ActionChoice" ? beginActionPlanning(state, action) : switchActionPlanning(state, action);
  if (!selected) return false;
  clearActionTransients(ui);
  return true;
}

export function cancelPendingAction(state, ui) {
  const canceled = cancelActionPlanning(state);
  clearActionTransients(ui);
  return canceled;
}

export function shouldCancelCanvasAction({ actionType, maneuverRoute = false, maneuverOption = false, weaponTarget = false }) {
  if (!actionType) return false;
  if (actionType === "maneuver") return !(maneuverRoute || maneuverOption);
  if (actionType === "weapon-attack") return !weaponTarget;
  return true;
}

export function shouldCancelDocumentAction({ planning, insideActionControl = false, insideCanvas = false, insideWeaponTooltip = false }) {
  return Boolean(planning && !insideActionControl && !insideCanvas && !insideWeaponTooltip);
}

export function recalculateActionUi(state, ui, unit, planRoutes, policy = "risky") {
  clearActionTransients(ui);
  ui.routes = state?.lifecycle === "ActionPlanning" && state.activeAction?.type === "maneuver" ? planRoutes(state, unit, policy) : new Map();
  return ui.routes;
}
