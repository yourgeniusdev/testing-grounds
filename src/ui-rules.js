export function headingAngle(heading) {
  return Math.PI / 2 - heading * Math.PI / 3;
}

export function shouldAutoEndActivation({ attackImplemented }) {
  return !attackImplemented;
}

export function shouldDrawRoute(selected) {
  return Boolean(selected?.route?.path);
}

function resourceState(spent, capacity) {
  return { spent, remaining: Math.max(0, capacity - spent), capacity };
}

function turnDistance(from, to, signedTurn) {
  if (from === undefined || to === undefined) return 0;
  return Math.abs(signedTurn ? signedTurn(from, to) : to - from);
}

export function buildManeuverOptions(unit, route, headings, signedTurn) {
  const availableHeadings = headings === null || headings === undefined ? [undefined] : [...headings];
  return availableHeadings.map(heading => {
    const finalState = { hex: { ...route.position } };
    if (heading !== undefined) finalState.heading = heading;
    const headingTurns = turnDistance(route.steps?.length ? route.heading : unit.heading, heading, signedTurn);
    const maneuverSpent = (route.turnsSpent || 0) + headingTurns + (unit.evasiveManeuver ? 1 : 0);
    const resources = { speed: resourceState(route.movementCost || 0, unit.currentSpeed || 0) };
    if (Number.isFinite(unit.maneuver)) resources.maneuver = resourceState(maneuverSpent, unit.maneuver);
    return {
      optionId: `maneuver:${route.position.q}:${route.position.r}${heading === undefined ? "" : `:heading:${heading}`}`,
      finalState,
      route,
      resources,
      consequences: route.consequences || [],
      interception: route.interception ?? null
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

export function shouldHighlightOccupiedHex(lifecycle) {
  return lifecycle !== "DeploymentLeft" && lifecycle !== "DeploymentRight";
}

export function shouldOutlineUnit(entityId, activeUnitId, selectedDeploymentUnitId, lifecycle) {
  const deploying = lifecycle === "DeploymentLeft" || lifecycle === "DeploymentRight";
  return entityId === selectedDeploymentUnitId || (!deploying && entityId === activeUnitId);
}