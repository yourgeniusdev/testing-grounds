import { beginActionPlanning, cancelActionPlanning, switchActionPlanning } from "./domain.js";

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
