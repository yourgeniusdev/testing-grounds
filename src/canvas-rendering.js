import { routePreviewKindsAt } from "./ui-rules.js";

export function battlefieldGeometry(width, height, dpr = 1) {
  const heightSize = (height - 50) / 18;
  const widthSize = (width - 32) / (Math.sqrt(3) * 14);
  return { dpr, size: Math.max(1, Math.min(44, heightSize, widthSize)), cx: width / 2, cy: height / 2 };
}

export function maneuverTargetPosition(target, neighbor, width, height) {
  const margin = 24;
  const rawInside = neighbor.x >= margin && neighbor.x <= width - margin && neighbor.y >= margin && neighbor.y <= height - margin;
  const distance = rawInside ? 1 : .62;
  const x = target.x + (neighbor.x - target.x) * distance;
  const y = target.y + (neighbor.y - target.y) * distance;
  return { x: Math.max(margin, Math.min(width - margin, x)), y: Math.max(margin, Math.min(height - margin, y)), radius: 20 };
}

export function maneuverZoneRenderCommands({ plannedRoutes, selectedRoute, position, event }) {
  const routes = [...(plannedRoutes?.values?.() || []), selectedRoute].filter(Boolean);
  const previewKinds = routes.reduce((known, route) => {
    const kinds = routePreviewKindsAt(route, position);
    return { aa: known.aa || kinds.aa, interception: known.interception || kinds.interception };
  }, { aa: false, interception: false });
  const hazards = Boolean(event?.hazards.length);
  let base = null;
  const outlines = [];

  if (previewKinds.aa) {
    base = { fillStyle: "rgba(179,76,88,.14)", strokeStyle: "rgba(196,92,104,.78)", lineWidth: 2, lineDash: [] };
    outlines.push({ kind: "aa", inset: 6, strokeStyle: "rgba(196,92,104,.86)", lineWidth: 2, lineDash: [2, 3] });
  }
  if (previewKinds.interception) {
    base = {
      ...(base || {}),
      ...(previewKinds.aa || hazards ? {} : { fillStyle: "rgba(198,126,75,.15)" }),
      strokeStyle: previewKinds.aa ? "rgba(211,125,84,.92)" : "rgba(211,137,83,.82)",
      lineWidth: 2.5,
      lineDash: [5, 4]
    };
    outlines.push({ kind: "interception", inset: 3, strokeStyle: "rgba(211,137,83,.92)", lineWidth: 2.5, lineDash: [7, 4] });
  }

  return { base, outlines };
}
