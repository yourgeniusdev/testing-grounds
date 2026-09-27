export function headingAngle(heading) {
  return Math.PI / 2 - heading * Math.PI / 3;
}

export function shouldAutoEndActivation({ attackImplemented }) {
  return !attackImplemented;
}

export function shouldDrawRoute(selected) {
  return Boolean(selected?.route?.path);
}