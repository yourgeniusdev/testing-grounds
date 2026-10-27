export function headingAngle(heading) {
  return Math.PI / 2 - heading * Math.PI / 3;
}

export function shouldAutoEndActivation({ attackImplemented }) {
  return !attackImplemented;
}

export function shouldDrawRoute(selected) {
  return Boolean(selected?.route?.path);
}

export function shouldHighlightOccupiedHex(lifecycle) {
  return lifecycle !== "DeploymentLeft" && lifecycle !== "DeploymentRight";
}

export function shouldOutlineUnit(entityId, activeUnitId, selectedDeploymentUnitId, lifecycle) {
  const deploying = lifecycle === "DeploymentLeft" || lifecycle === "DeploymentRight";
  return entityId === selectedDeploymentUnitId || (!deploying && entityId === activeUnitId);
}