import { formatAttackPreview, getAttackPreview } from "./v1-preview.js";
import { deploymentZone, movementDestinations } from "./v1-domain.js";

function createHexLayout(width, height, bounds) {
  const padding = 18;
  const columns = bounds.maxCol - bounds.minCol + 1;
  const rows = bounds.maxRow - bounds.minRow + 1;
  const size = Math.max(8, Math.min((width - padding * 2) / (Math.sqrt(3) * (columns + (rows - 1) / 2)), (height - padding * 2) / (1.5 * (rows - 1) + 2)));
  return { x: padding + Math.sqrt(3) * size / 2, y: padding + size, size };
}

function pixelForHex(position, layout) {
  return { x: layout.x + layout.size * Math.sqrt(3) * (position.q + position.r / 2), y: layout.y + layout.size * 1.5 * position.r };
}

function hexForPixel(x, y, layout) {
  return { q: Math.round((x - layout.x) / (layout.size * Math.sqrt(3)) - (y - layout.y) / (layout.size * 3)), r: Math.round((y - layout.y) / (layout.size * 1.5)) };
}

export function createBattleRenderer(document) {
  const canvas = document.getElementById("battlefield");
  const ctx = canvas.getContext("2d");
  let layout = createHexLayout(300, 150, { minCol: 0, maxCol: 7, minRow: 0, maxRow: 5 });
  const els = {
    confirm: document.getElementById("confirmDeploymentButton"), confirmMove: document.getElementById("confirmMoveButton"), skipAttack: document.getElementById("skipAttackButton"), wait: document.getElementById("waitButton"), end: document.getElementById("endActivationButton"),
    round: document.getElementById("roundNumber"), stage: document.getElementById("stageLabel"), mode: document.getElementById("modeLabel"), list: document.getElementById("initiativeList"), log: document.getElementById("combatLog"), weapons: document.getElementById("attackWeaponActions"), summary: document.getElementById("weaponSummary"), heading: document.getElementById("headingButtons"), cancelManeuver: document.getElementById("cancelManeuverButton")
  };
  function resize(state) {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bitmapWidth = Math.round(width * ratio);
    const bitmapHeight = Math.round(height * ratio);
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) { canvas.width = bitmapWidth; canvas.height = bitmapHeight; }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    layout = createHexLayout(width, height, state.bounds);
    return { width, height };
  }
  function render(state, view) {
    const dimensions = resize(state);
    els.round.textContent = state.round; els.stage.textContent = state.lifecycle; els.mode.textContent = state.winner ? `ПОБЕДА: ${state.winner}` : "КАНОНИЧЕСКИЙ V1";
    const deploying = state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight";
    els.confirm.hidden = !deploying; els.confirmMove.hidden = state.lifecycle !== "Maneuver"; els.skipAttack.hidden = state.lifecycle !== "Attack";
    els.wait.disabled = state.lifecycle !== "WaitDecision"; els.end.disabled = !["SystemActions", "Maneuver", "Attack"].includes(state.lifecycle);
    els.end.textContent = state.lifecycle === "Attack" ? "Подтвердить залп" : "Продолжить";
    const attacker = state.units.find(unit => unit.id === state.activeUnitId);
    const slots = attacker?.weapons ?? attacker?.weaponSlots ?? [];
    els.weapons.replaceChildren(...slots.map((slot, index) => {
      const weapon = slot.weapon ?? slot; const button = document.createElement("button"); button.type = "button"; button.className = `action-slot weapon-action${view.selectedWeaponIndex === index ? " active" : ""}`; button.dataset.weaponIndex = index; button.textContent = weapon.id ?? `Орудие ${index + 1}`; return button;
    }));
    const preview = state.lifecycle === "Attack" && attacker && view.selectedTargetId ? getAttackPreview(state, attacker.id, view.selectedTargetId, view.selectedWeaponIndex) : null;
    els.summary.textContent = state.lifecycle === "Attack" ? formatAttackPreview(preview) : (view.routeReason || (view.plannedRoute.length ? `Маршрут: ${view.plannedRoute.length} шаг.` : ""));
    const selected = state.units.find(unit => unit.id === view.selectedUnitId);
    const canPlanHeading = state.lifecycle === "Maneuver" && selected?.kind === "capital" && selected.id === state.activeUnitId;
    els.heading.parentElement.hidden = !canPlanHeading;
    if (canPlanHeading) els.heading.replaceChildren(...Array.from({ length: 6 }, (_, heading) => { const button = document.createElement("button"); button.type = "button"; button.dataset.heading = heading; button.textContent = String(heading + 1); button.className = `heading-button${(view.plannedHeading ?? selected.heading) === heading ? " active" : ""}`; return button; }));
    if (state.lifecycle === "Attack") els.mode.textContent = preview?.canAttack ? `ЗАЛП: ${formatAttackPreview(preview)}` : `АТАКА · ${formatAttackPreview(preview)}`;
    els.list.replaceChildren(...state.units.map(unit => { const item = document.createElement("div"); item.className = "mission-card"; const name = document.createElement("strong"); name.textContent = unit.name; const details = document.createElement("span"); details.textContent = `${unit.side} · ${unit.kind} · ${unit.integrity} HP`; item.append(name, details); return item; }));
     ctx.clearRect(0, 0, dimensions.width, dimensions.height);
     const deploySide = state.lifecycle === "DeploymentLeft" ? "left" : state.lifecycle === "DeploymentRight" ? "right" : null;
     const highlighted = deploySide ? deploymentZone(state, deploySide) : state.lifecycle === "Maneuver" && selected ? movementDestinations(state, selected.id) : [];
     for (let q = state.bounds.minCol; q <= state.bounds.maxCol; q += 1) for (let r = state.bounds.minRow; r <= state.bounds.maxRow; r += 1) { const cell = { q, r }; const p = pixelForHex(cell, layout); if (highlighted.some(item => item.q === q && item.r === r)) { ctx.fillStyle = deploySide ? "rgba(85,185,255,.15)" : "rgba(255,214,92,.2)"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + layout.size * Math.cos(a), p.y + layout.size * Math.sin(a)); } ctx.closePath(); ctx.fill(); } ctx.strokeStyle = "#536174"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + layout.size * Math.cos(a), p.y + layout.size * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
     state.contents.forEach(item => { if (!item.position) return; const p = pixelForHex(item.position, layout); const colors = { asteroid: "#7d8795", nebula: "#7a63a8", debrisField: "#a57b52" }; ctx.fillStyle = colors[item.type] || (item.kind === "object" ? "#7d8795" : "#8f6b52"); if (item.type === "nebula") { ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(p.x, p.y, layout.size * .55, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; } else { ctx.fillRect(p.x - layout.size * .28, p.y - layout.size * .28, layout.size * .56, layout.size * .56); } });
      if (state.lifecycle === "Maneuver" && view.plannedRoute?.length) { view.plannedRoute.forEach((step, index) => { const p = pixelForHex(step, layout); ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(7, layout.size * .34), 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#ffe27a"; ctx.font = "700 10px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.fillText(String(index + 1), p.x, p.y - layout.size * .45); if (index > 0) { const previous = pixelForHex(view.plannedRoute[index - 1], layout); const angle = Math.atan2(p.y - previous.y, p.x - previous.x); ctx.strokeStyle = "#ffe27a"; ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 6 * Math.cos(angle - .5), p.y - 6 * Math.sin(angle - .5)); ctx.lineTo(p.x - 6 * Math.cos(angle + .5), p.y - 6 * Math.sin(angle + .5)); ctx.closePath(); ctx.fill(); } }); const destination = view.plannedRoute.at(-1); const p = pixelForHex(destination, layout); ctx.setLineDash([4, 3]); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, layout.size * .62), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
      state.units.forEach(unit => { if (!unit.position) return; const p = pixelForHex(unit.position, layout); if (unit.id === view.selectedUnitId) { ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, layout.size * .52), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; } ctx.fillStyle = unit.side === "left" ? "#55b9ff" : "#ff6e7a"; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, layout.size * .4), 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#08111f"; ctx.textAlign = "center"; ctx.fillText(unit.name[0], p.x, p.y + 5); });
    els.log.replaceChildren(...state.events.slice(-30).reverse().map(event => { const item = document.createElement("li"); item.textContent = event.action; return item; }));
  }
  return { canvas, els, hexForPoint: (x, y) => hexForPixel(x, y, layout), pointForHex: position => pixelForHex(position, layout), render };
}
