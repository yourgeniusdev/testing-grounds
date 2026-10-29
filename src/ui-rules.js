export function headingAngle(heading) {
  return Math.PI / 2 - heading * Math.PI / 3;
}

export function shouldAutoEndActivation({ attackImplemented }) {
  return !attackImplemented;
}

export function shouldDrawRoute(selected) {
  return Boolean(selected?.route?.path);
}

export function maneuverResourcePreview(unit, selected, stage, signedTurn) {
  const route = selected?.route && stage !== "attack" ? selected.route : null;
  const speedSpent = unit.speedSpent || 0;
  const maneuverSpent = unit.maneuverSpent || 0;
  if (!route) return { speedSpent, speedPreview: 0, maneuverSpent, maneuverPreview: 0 };
  const speedPreview = Math.max(0, route.movementCost - speedSpent);
  const headingTurns = unit.kind === "capital" && selected.heading !== undefined ? Math.abs(signedTurn(route.heading ?? unit.heading, selected.heading)) : 0;
  const plannedTurns = route.turnsSpent + headingTurns + (unit.evasiveManeuver ? 1 : 0);
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