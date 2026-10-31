export function headingAngle(heading) {
  return Math.PI / 2 - heading * Math.PI / 3;
}

export function maneuverPreviewHeading(unit, option) {
  return option?.finalState?.heading ?? unit?.heading;
}

export function shouldAutoEndActivation({ attackImplemented }) {
  return !attackImplemented;
}

export function shouldDrawRoute(selected) {
  return Boolean(selected?.route?.path);
}

export function canSelectWeaponAttackTarget(attacker, target, selectedWeaponId) {
  return Boolean(selectedWeaponId && attacker && target && target.id !== attacker.id && target.sideId !== attacker.sideId);
}

function resourceState(spent, capacity) {
  return { spent, remaining: Math.max(0, capacity - spent), capacity };
}

function turnDistance(from, to, signedTurn) {
  if (from === undefined || to === undefined) return 0;
  return Math.abs(signedTurn ? signedTurn(from, to) : to - from);
}

export function buildManeuverOptions(unit, route, headings, signedTurn) {
  const availableHeadings = headings === null || headings === undefined ? [route.heading] : [...headings];
  return availableHeadings.map(heading => {
    const finalState = { hex: { ...route.position }, heading };
    const maneuverSpent = (unit.maneuverSpent || 0) + (route.turnsSpent || 0);
    const resources = { speed: resourceState((unit.speedSpent || 0) + (route.movementCost || 0), unit.currentSpeed || 0) };
    if (Number.isFinite(unit.maneuver)) resources.maneuver = resourceState(maneuverSpent, unit.maneuver);
    return {
      optionId: `maneuver:${route.position.q}:${route.position.r}:heading:${heading}`,
      finalState,
      route,
      resources,
      consequences: route.consequences || [],
      interceptions: route.interceptions || [],
      interception: route.interception ?? route.interceptions?.[0] ?? null
    };
  });
}

function plannedResourceSpent(resource) {
  if (typeof resource === "number") return resource;
  return resource?.spent;
}

export function maneuverResourcePreview(unit, selected, stage, signedTurn) {
  const speedSpent = unit.speedSpent || 0;
  const maneuverSpent = unit.maneuverSpent || 0;
  if (stage === "attack") return { speedSpent, speedPreview: 0, maneuverSpent, maneuverPreview: 0 };
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

export function routeConsequenceRows(route) {
  return (route?.previewConsequences || []).map(consequence => ({
    kind: consequence.kind,
    title: consequence.kind === "aa" ? `AA · ${consequence.sourceName}` : consequence.kind === "interception" ? `Interception · ${consequence.sourceName}` : consequence.sourceName,
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