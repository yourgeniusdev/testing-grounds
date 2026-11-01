import { activationMovementFacts, activationResources, actionAvailability, currentEvasion, movementEvasion, movementEvasionFromFacts } from "./domain.js";

export function headingAngle(heading) {
  return Math.PI / 2 - heading * Math.PI / 3;
}

export function maneuverPreviewHeading(unit, option) {
  return option?.finalState?.heading ?? unit?.heading;
}

export function shouldDrawRoute(selected) {
  return Boolean(selected?.route?.path);
}

export function shouldShowManeuverRoutes(state) {
  return state?.lifecycle === "ActionPlanning" && state.activeAction?.type === "maneuver";
}

export function resourcePresentation(unit) {
  return activationResources(unit);
}

export function actionResourcePreview(state, unit, hoveredAction = null, availability = null) {
  const action = hoveredAction || (state?.lifecycle === "ActionPlanning" ? state.activeAction : null);
  if (!action) return { energy: 0, speedCapacity: 0, maneuverCapacity: 0 };
  const result = availability || actionAvailability(state, action, unit);
  return {
    energy: result.forecast.cost.energy,
    speedCapacity: result.forecast.capacityChange.speed,
    maneuverCapacity: result.forecast.capacityChange.maneuver,
    ...(result.forecast.cost.speed ? { speed: result.forecast.cost.speed } : {}),
    ...(result.forecast.cost.maneuver ? { maneuver: result.forecast.cost.maneuver } : {})
  };
}

export function actionTilePresentation({ selected = false, confirmation = "field", icon, resolved = false }) {
  const pendingConfirmation = selected && confirmation === "tile";
  const className = [pendingConfirmation ? "pending-confirmation" : selected ? "field-selected" : "", resolved ? "resolved" : ""].filter(Boolean).join(" ");
  return { selected, pendingConfirmation, resolved, icon: pendingConfirmation ? "✓" : icon, className, ariaPressed: String(selected) };
}

export function segmentedResourcePresentation(resource, preview = {}) {
  const spent = Math.max(0, resource.spent || 0);
  const visibleSpent = Math.min(resource.capacity, spent);
  const spendPreview = Math.max(0, Math.min(resource.remaining, preview.spend || 0));
  const capacityPreview = Math.max(0, preview.capacity || 0);
  const ordinaryCapacity = resource.capacity;
  const capacity = ordinaryCapacity + capacityPreview;
  const remaining = Math.max(0, resource.remaining - spendPreview + capacityPreview);
  const segments = Array.from({ length: ordinaryCapacity }, (_, index) => {
    const fromEnd = ordinaryCapacity - index;
    if (fromEnd <= visibleSpent) return "spent";
    if (fromEnd <= visibleSpent + spendPreview) return "preview";
    return "available";
  });
  segments.push(...Array.from({ length: capacityPreview }, () => "bonus"));
  return { spent, spendPreview, capacity, capacityPreview, remaining, segments };
}

export function resourceMetricsText(resource, preview = {}) {
  const presentation = segmentedResourcePresentation(resource, preview);
  return `макс. ${presentation.capacity} · расход ${presentation.spent + presentation.spendPreview} · остаток ${presentation.remaining}`;
}

export function weaponSelectionPresentation(state, slotId) {
  const selected = state?.lifecycle === "ActionPlanning" && state.activeAction?.type === "weapon-attack" && state.activeAction.slotId === slotId;
  return { selected, ariaPressed: String(selected) };
}

export function evasionPresentation(unit, selected = null) {
  const movement = movementEvasionFromFacts(unit);
  const current = currentEvasion(unit);
  const plannedSteps = selected?.route?.steps?.length || 0;
  const plannedTurns = selected?.route?.actions?.filter(element => element.type === "turn").length ?? selected?.route?.turnsSpent ?? 0;
  const accumulatedSteps = unit?.activationMovement ? activationMovementFacts(unit).filter(element => element.type === "move").length : 0;
  const locksEvasion = Boolean(selected && plannedSteps === 0 && plannedTurns > 0);
  const previewMovement = unit?.evasionLocked || locksEvasion ? 0 : selected ? movementEvasion(accumulatedSteps + plannedSteps, unit?.evasiveManeuver) : movement;
  return { current, movement, preview: unit?.evasionLocked || locksEvasion ? 0 : (unit?.baseEvasion || 0) + previewMovement + (unit?.disengageEvasionPenalty || 0), previewMovement };
}

function actionPresentation(state, unit, action) {
  const availability = actionAvailability(state, action, unit);
  const selected = state?.lifecycle === "ActionPlanning" && state.activeAction?.type === action.type
    && (!action.systemActionId || state.activeAction.systemActionId === action.systemActionId);
  const reasonCodes = availability.reasons.map(reason => reason.code);
  const reasons = action.type === "maneuver" && reasonCodes.filter(code => code === "resource.insufficient").length === 2
    ? ["Недостаточно Скорости и Манёвренности"]
    : availability.reasons.map(reason => reason.message);
  return {
    selected,
    canSelect: ["ActionChoice", "ActionPlanning"].includes(state?.lifecycle) && !selected && availability.available,
    canConfirm: selected && availability.available,
    canCancel: selected,
    ...(reasons.length ? { reasons } : {})
  };
}

export function maneuverActionPresentation(state, unit) {
  return actionPresentation(state, unit, { type: "maneuver" });
}

export function systemActionPresentation(state, unit, systemActionId) {
  return actionPresentation(state, unit, { type: "system-action", systemActionId });
}

export function disengageActionPresentation(state, unit) {
  if (unit?.kind !== "squadron" || !unit.engagedWith?.length) return { visible: false, selected: false, canSelect: false, canConfirm: false, canCancel: false };
  const availability = actionAvailability(state, { type: "disengage" }, unit);
  return { visible: true, ...actionPresentation(state, unit, { type: "disengage" }), preview: availability.details };
}

export function interceptionEffectRows(state, unit) {
  if (!unit?.engagedWith?.length) return [];
  return [...new Set(unit.engagedWith)]
    .map(id => state?.units?.find(candidate => candidate.id === id))
    .filter(linked => linked?.kind === "squadron" && linked.sideId !== unit.sideId && linked.engagedWith?.includes(unit.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(linked => ({ tone: "negative", icon: "↝", name: `Перехват · ${linked.name || linked.id}`, text: "Обычный манёвр запрещён до успешного Отрыва", duration: "Пока связь актуальна" }));
}

export function canSelectWeaponAttackTarget(attacker, target, selectedWeaponId) {
  return Boolean(selectedWeaponId && attacker && target && target.id !== attacker.id && target.sideId !== attacker.sideId);
}

function turnDistance(from, to, signedTurn) {
  if (from === undefined || to === undefined) return 0;
  return Math.abs(signedTurn ? signedTurn(from, to) : to - from);
}

export function buildManeuverOptions(unit, route, headings, signedTurn) {
  const availableHeadings = headings === null || headings === undefined ? [route.heading] : [...headings];
  return availableHeadings.map(heading => {
    const finalState = { hex: { ...route.position }, heading };
    const current = activationResources(unit);
    const maneuverSpent = current.maneuver.spent + (route.turnsSpent || 0);
    const resources = { speed: { ...current.speed, spent: current.speed.spent + (route.movementCost || 0), remaining: Math.max(0, current.speed.capacity - current.speed.spent - (route.movementCost || 0)) } };
    if (Number.isFinite(unit.maneuver)) resources.maneuver = { ...current.maneuver, spent: maneuverSpent, remaining: Math.max(0, current.maneuver.capacity - maneuverSpent) };
    return {
      optionId: `maneuver:${route.position.q}:${route.position.r}:heading:${heading}`,
      finalState,
      route,
      resources,
      consequences: route.consequences || [],
      interceptions: route.interceptions || []
    };
  });
}

function plannedResourceSpent(resource) {
  if (typeof resource === "number") return resource;
  return resource?.spent;
}

export function maneuverResourcePreview(unit, selected, signedTurn) {
  const speedSpent = unit.speedSpent || 0;
  const maneuverSpent = unit.maneuverSpent || 0;
  const activeOption = selected?.previewOption ?? selected?.option;
  if (activeOption) {
    const plannedSpeed = plannedResourceSpent(activeOption.resources?.speed) ?? speedSpent;
    const plannedManeuver = plannedResourceSpent(activeOption.resources?.maneuver) ?? maneuverSpent;
    return {
      speedSpent,
      speedPreview: Math.max(0, plannedSpeed - speedSpent),
      maneuverSpent,
      maneuverPreview: Math.max(0, plannedManeuver - maneuverSpent)
    };
  }
  const route = selected?.route;
  if (!route) return { speedSpent, speedPreview: 0, maneuverSpent, maneuverPreview: 0 };
  const speedPreview = Math.max(0, route.movementCost - speedSpent);
  const headingTurns = turnDistance(route.steps?.length ? route.heading : unit.heading, selected.heading, signedTurn);
  const plannedTurns = (route.turnsSpent || 0) + headingTurns + (unit.evasiveManeuver ? 1 : 0);
  const maneuverPreview = Math.max(0, plannedTurns - maneuverSpent);
  return { speedSpent, speedPreview, maneuverSpent, maneuverPreview };
}

function consequenceDetail(consequence) {
  const guarantee = consequence.guaranteed ? "Guaranteed" : `${Math.round((consequence.probability || 0) * 100)}%`;
  const range = consequence.min === consequence.max ? `${consequence.max}` : `${consequence.min}–${consequence.max}`;
  const harm = consequence.expectedHarm > 0 ? ` · expected harm ${consequence.expectedHarm}` : "";
  if (consequence.guaranteed && !consequence.max) return `${guarantee} · ${consequence.effect}`;
  return `${guarantee} · ${range} · ${consequence.effect}${harm}`;
}

export function routePreviewKindsAt(route, position) {
  if (!route || !position) return { aa: false, interception: false, hazard: false };
  const descriptors = (route.previewConsequences || []).filter(consequence => consequence.position?.q === position.q && consequence.position?.r === position.r);
  return { aa: descriptors.some(consequence => consequence.kind === "aa"), interception: descriptors.some(consequence => consequence.kind === "interception"), hazard: descriptors.some(consequence => consequence.kind === "hazard") };
}

export function routeConsequenceRows(route) {
  return (route?.previewConsequences || []).map(consequence => ({
    kind: consequence.kind,
    title: consequence.kind === "aa" ? `ПВО · ${consequence.sourceName}` : consequence.kind === "interception" ? `Перехват · ${consequence.sourceName}` : consequence.sourceName,
    detail: consequenceDetail(consequence)
  }));
}

export function shouldHighlightOccupiedHex(lifecycle) {
  return lifecycle !== "DeploymentLeft" && lifecycle !== "DeploymentRight";
}

export function shouldOutlineUnit(entityId, activeUnitId, selectedDeploymentUnitId, lifecycle) {
  const deploying = lifecycle === "DeploymentLeft" || lifecycle === "DeploymentRight";
  return entityId === selectedDeploymentUnitId || (!deploying && entityId === activeUnitId);
}