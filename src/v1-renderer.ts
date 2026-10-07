import { formatAttackPreview, getAttackPreview } from "./v1-preview.ts";
import { deploymentZone, movementDestinations } from "./v1-domain.ts";

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
    round: document.getElementById("roundNumber"), stage: document.getElementById("stageLabel"), mode: document.getElementById("modeLabel"), list: document.getElementById("initiativeList"), log: document.getElementById("combatLog"), weapons: document.getElementById("attackWeaponActions"), summary: document.getElementById("weaponSummary"), heading: document.getElementById("headingButtons"), cancelManeuver: document.getElementById("cancelManeuverButton"), disengage: document.getElementById("disengageButton"), ram: document.getElementById("ramButton"), maneuverDetails: document.getElementById("maneuverDetails"), maneuverPopup: document.getElementById("maneuverPopup"), routeBadge: document.getElementById("maneuverBadge")
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
    els.wait.disabled = state.lifecycle !== "WaitDecision"; els.end.disabled = !["WaitDecision", "SystemActions", "Maneuver", "Attack"].includes(state.lifecycle);
    els.end.textContent = state.lifecycle === "Attack" ? "Подтвердить залп" : "Продолжить";
    const attacker = state.units.find(unit => unit.id === state.activeUnitId);
    const slots = attacker?.weapons ?? attacker?.weaponSlots ?? [];
    els.disengage.hidden = !(state.lifecycle === "Maneuver" && attacker?.kind === "squadron" && attacker.engagedWith?.length);
    const ramTarget = state.units.find(unit => unit.id === view.selectedTargetId);
    els.ram.hidden = !(state.lifecycle === "Maneuver" && attacker?.kind === "capital" && ramTarget?.kind === "capital" && ramTarget.side !== attacker.side && view.plannedRoute.length);
    els.weapons.replaceChildren(...slots.map((slot, index) => {
      const weapon = slot.weapon ?? slot; const button = document.createElement("button"); button.type = "button"; button.className = `action-slot weapon-action${view.selectedWeaponIndex === index ? " active" : ""}`; button.dataset.weaponIndex = index; button.textContent = weapon.id ?? `Орудие ${index + 1}`; return button;
    }));
    const preview = state.lifecycle === "Attack" && attacker && view.selectedTargetId ? getAttackPreview(state, attacker.id, view.selectedTargetId, view.selectedWeaponIndex) : null;
    const selected = state.units.find(unit => unit.id === view.selectedUnitId);
      const routeText = view.routeReason || (view.plannedRoute.length ? `Маршрут: ${view.plannedRoute.length} шаг. → (${view.plannedRoute.at(-1).q}, ${view.plannedRoute.at(-1).r})` : "");
      const maneuverPreview = view.maneuverPreview;
      const routeCost = maneuverPreview?.movementCost ?? 0;
      const headingText = selected?.kind === "capital" ? ` · курс ${(maneuverPreview?.finalHeading ?? view.plannedHeading ?? selected.heading) + 1}` : "";
      const entryText = maneuverPreview?.entries.map(entry => {
        const effects = entry.effects.map(effect => `${effect.sourceId}: ${effect.type === "damage" ? `−${effect.amount} HP` : `${effect.field} ${effect.amount >= 0 ? "+" : ""}${effect.amount}`}`);
        const risks = entry.aaRisks.map(risk => `ПВО ${risk.ownerId} ${risk.accuracy}%/${risk.damage} урон`);
        const notes = [...effects, ...risks, entry.lethal ? "уничтожение — следующие шаги недостижимы" : null].filter(Boolean);
        return notes.length ? `шаг ${entry.index} (${entry.position.q},${entry.position.r}): ${notes.join(", ")}` : null;
      }).filter(Boolean).join(" · ");
      const legalityText = maneuverPreview?.ramRequired ? ` · требуется явный таран ${maneuverPreview.ramTargetId}` : maneuverPreview && !maneuverPreview.stopLegal ? " · остановка запрещена" : "";
       els.summary.textContent = state.lifecycle === "Attack" ? formatAttackPreview(preview) : (routeText ? `${routeText}${headingText} · стоимость ${routeCost}` : `Выберите маршрут${headingText}`);
     const maneuverActive = state.lifecycle === "Maneuver" && selected?.id === state.activeUnitId;
     els.maneuverPopup.hidden = !maneuverActive;
     if (maneuverActive) {
        els.maneuverDetails.textContent = view.routeReason ? `${view.routeReason}${headingText} · скорость ${selected.speed ?? 0}` : view.plannedRoute.length ? `${routeText}${headingText} · стоимость ${routeCost} · скорость останется ${maneuverPreview.speedRemaining} · повороты ${maneuverPreview.turnsUsed}, останется ${maneuverPreview.turnsRemaining}${entryText ? ` · ${entryText}` : ""}${legalityText}` : `Выберите допустимый гекс для маршрута${headingText} · скорость ${selected.speed ?? 0}`;
       els.routeBadge.textContent = view.routeReason ? "ЗАБЛОКИРОВАН" : view.plannedRoute.length ? "ГОТОВ" : "ОЖИДАНИЕ";
     }
     const canPlanHeading = maneuverActive && selected?.kind === "capital";
    els.heading.parentElement.hidden = !canPlanHeading;
    if (canPlanHeading) {
      els.heading.parentElement.querySelector("span").textContent = `Курс: текущий ${selected.heading + 1} · выбранный ${(view.plannedHeading ?? selected.heading) + 1}`;
      els.heading.replaceChildren(...Array.from({ length: 6 }, (_, heading) => { const button = document.createElement("button"); button.type = "button"; button.dataset.heading = heading; button.textContent = String(heading + 1);       button.title = `Курс ${heading + 1}`; button.className = `heading-button${(view.plannedHeading ?? selected.heading) === heading ? " active" : ""}`; return button; }));
    }
     if (state.lifecycle === "Attack") els.mode.textContent = preview?.canAttack ? `ЗАЛП: ${formatAttackPreview(preview)}` : `АТАКА · ${formatAttackPreview(preview)}`;
     if (state.lifecycle !== "Maneuver") els.maneuverPopup.hidden = true;
    els.list.replaceChildren(...state.units.map(unit => { const item = document.createElement("div"); item.className = "mission-card"; const name = document.createElement("strong"); name.textContent = unit.name; const details = document.createElement("span"); details.textContent = `${unit.side} · ${unit.kind} · ${unit.integrity} HP`; item.append(name, details); return item; }));
     ctx.clearRect(0, 0, dimensions.width, dimensions.height);
     const deploySide = state.lifecycle === "DeploymentLeft" ? "left" : state.lifecycle === "DeploymentRight" ? "right" : null;
     const highlighted = deploySide ? deploymentZone(state, deploySide) : state.lifecycle === "Maneuver" && selected ? movementDestinations(state, selected.id) : [];
     for (let q = state.bounds.minCol; q <= state.bounds.maxCol; q += 1) for (let r = state.bounds.minRow; r <= state.bounds.maxRow; r += 1) { const cell = { q, r }; const p = pixelForHex(cell, layout); if (highlighted.some(item => item.q === q && item.r === r)) { ctx.fillStyle = deploySide ? "rgba(85,185,255,.15)" : "rgba(255,214,92,.2)"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + layout.size * Math.cos(a), p.y + layout.size * Math.sin(a)); } ctx.closePath(); ctx.fill(); } ctx.strokeStyle = "#536174"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + layout.size * Math.cos(a), p.y + layout.size * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
      state.contents.forEach(item => { if (!item.position) return; const p = pixelForHex(item.position, layout); const type = item.type ?? (item.kind === "terrain" ? "terrain" : "object"); const colors = { asteroid: "#7d8795", nebula: "#7a63a8", debrisField: "#a57b52" }; ctx.fillStyle = colors[type] || "#8f6b52"; ctx.strokeStyle = type === "nebula" ? "#b49be8" : type === "debrisField" ? "#d5a875" : "#b8c1cc"; if (type === "nebula") { ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(p.x, p.y, layout.size * .58, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; } else if (type === "debrisField") { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-layout.size * .28, -layout.size * .28, layout.size * .56, layout.size * .56); ctx.restore(); ctx.beginPath(); ctx.arc(p.x, p.y, layout.size * .35, 0, Math.PI * 2); ctx.stroke(); } else { ctx.beginPath(); ctx.moveTo(p.x, p.y - layout.size * .38); for (let i = 1; i < 6; i += 1) { const a = -Math.PI / 2 + i * Math.PI / 3; ctx.lineTo(p.x + layout.size * .38 * Math.cos(a), p.y + layout.size * .38 * Math.sin(a)); } ctx.closePath(); ctx.fill(); ctx.stroke(); } });
      if (state.lifecycle === "Maneuver" && view.plannedRoute?.length) { view.plannedRoute.forEach((step, index) => { const p = pixelForHex(step, layout); ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(7, layout.size * .34), 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#ffe27a"; ctx.font = "700 10px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.fillText(String(index + 1), p.x, p.y - layout.size * .45); if (index > 0) { const previous = pixelForHex(view.plannedRoute[index - 1], layout); const angle = Math.atan2(p.y - previous.y, p.x - previous.x); ctx.strokeStyle = "#ffe27a"; ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 6 * Math.cos(angle - .5), p.y - 6 * Math.sin(angle - .5)); ctx.lineTo(p.x - 6 * Math.cos(angle + .5), p.y - 6 * Math.sin(angle + .5)); ctx.closePath(); ctx.fill(); } }); const destination = view.plannedRoute.at(-1); const p = pixelForHex(destination, layout); ctx.setLineDash([4, 3]); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, layout.size * .62), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
      state.units.forEach(unit => { if (!unit.position) return; const p = pixelForHex(unit.position, layout); if (unit.id === view.selectedUnitId) { ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, layout.size * .52), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; } ctx.fillStyle = unit.side === "left" ? "#55b9ff" : "#ff6e7a"; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, layout.size * .4), 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#08111f"; ctx.textAlign = "center"; ctx.fillText(unit.name[0], p.x, p.y + 5); });
      els.log.replaceChildren(...state.events.slice(-30).reverse().map(event => { const item = document.createElement("li"); item.dataset.eventAction = event.action; const details = event.position ? ` · (${event.position.q},${event.position.r})` : event.after?.stage ? ` · ${event.after.stage}` : event.after?.winner ? ` · победитель: ${event.after.winner}` : event.random ? ` · бросок ${Math.round(event.random.roll)}%` : ""; item.textContent = `${event.action}${event.actorId ? ` · ${event.actorId}` : ""}${details}`; return item; }));
  }
  return { canvas, els, hexForPoint: (x, y) => hexForPixel(x, y, layout), pointForHex: position => pixelForHex(position, layout), render };
}
