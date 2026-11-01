import { routePreviewKindsAt } from "./ui-rules.js";

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
