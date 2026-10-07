import { formatAttackPreview, getAttackPreview } from "./v1-preview.ts";
import { arcAllows, deploymentZone, movementDestinations, previewAttack } from "./v1-domain.ts";
import { createSvgImage } from "./icons.js";

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
  const svgImages = new Map();
  let lastRender = null;
  const cachedImage = (key, type, color) => {
    if (!svgImages.has(key)) {
      const image = createSvgImage(type, color);
      image.addEventListener("load", () => lastRender?.());
      svgImages.set(key, image);
    }
    return svgImages.get(key);
  };
  const imageFor = unit => cachedImage(`${unit.kind}:${unit.side}`, unit.kind === "squadron" ? "squadron" : "cruiser", unit.side === "left" ? "#55b9ff" : "#ff6e7a");
  const terrainImageFor = item => { const type = item.type === "nebula" ? "nebula" : item.type === "debrisField" || item.kind === "debris" ? "debrisField" : item.size === "large" ? "largeAsteroid" : "asteroidField"; const color = type === "nebula" ? "#7a63a8" : type === "debrisField" ? "#a57b52" : "#7d8795"; return cachedImage(`terrain:${type}`, type, color); };
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
    lastRender = () => render(state, view);
    const dimensions = resize(state);
    document.getElementById("attackEffect").setAttribute("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);
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
      const attackWeapon = slots[view.selectedWeaponIndex]?.weapon ?? slots[view.selectedWeaponIndex];
      const attackCells = state.lifecycle === "Attack" && attacker?.position && attackWeapon ? Array.from({ length: state.bounds.maxCol - state.bounds.minCol + 1 }, (_, index) => index + state.bounds.minCol).flatMap(q => Array.from({ length: state.bounds.maxRow - state.bounds.minRow + 1 }, (_, index) => ({ q, r: index + state.bounds.minRow }))).filter(position => arcAllows(attacker, { position }, attackWeapon)) : [];
      const highlighted = deploySide ? deploymentZone(state, deploySide) : state.lifecycle === "Maneuver" && selected ? movementDestinations(state, selected.id) : attackCells;
     for (let q = state.bounds.minCol; q <= state.bounds.maxCol; q += 1) for (let r = state.bounds.minRow; r <= state.bounds.maxRow; r += 1) { const cell = { q, r }; const p = pixelForHex(cell, layout); const content = state.contents.find(item => item.position?.q === q && item.position?.r === r); const occupied = state.units.some(unit => unit.position?.q === q && unit.position?.r === r); if (highlighted.some(item => item.q === q && item.r === r)) { ctx.fillStyle = deploySide ? "rgba(85,185,255,.15)" : state.lifecycle === "Attack" ? "rgba(255,102,125,.2)" : "rgba(255,214,92,.2)"; } else if (content?.kind === "object" || occupied) ctx.fillStyle = "rgba(255,102,125,.1)"; else if (content) ctx.fillStyle = "rgba(244,200,97,.1)"; else ctx.fillStyle = "transparent"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + layout.size * Math.cos(a), p.y + layout.size * Math.sin(a)); } ctx.closePath(); ctx.fill(); ctx.strokeStyle = content?.kind === "object" || occupied ? "rgba(255,102,125,.5)" : content ? "rgba(244,200,97,.5)" : "#536174"; ctx.stroke(); }
       state.contents.forEach(item => { if (!item.position) return; const p = pixelForHex(item.position, layout); const image = terrainImageFor(item); const size = layout.size * 1.12; ctx.save(); ctx.globalAlpha = item.type === "nebula" ? .62 : .9; if (image.complete) ctx.drawImage(image, p.x - size / 2, p.y - size / 2, size, size); ctx.restore(); });
      if (state.lifecycle === "Maneuver" && view.plannedRoute?.length) { view.plannedRoute.forEach((step, index) => { const p = pixelForHex(step, layout); ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(7, layout.size * .34), 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#ffe27a"; ctx.font = "700 10px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.fillText(String(index + 1), p.x, p.y - layout.size * .45); if (index > 0) { const previous = pixelForHex(view.plannedRoute[index - 1], layout); const angle = Math.atan2(p.y - previous.y, p.x - previous.x); ctx.strokeStyle = "#ffe27a"; ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 6 * Math.cos(angle - .5), p.y - 6 * Math.sin(angle - .5)); ctx.lineTo(p.x - 6 * Math.cos(angle + .5), p.y - 6 * Math.sin(angle + .5)); ctx.closePath(); ctx.fill(); } }); const destination = view.plannedRoute.at(-1); const p = pixelForHex(destination, layout); ctx.setLineDash([4, 3]); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(10, layout.size * .62), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
       state.units.forEach(unit => { if (!unit.position) return; const p = pixelForHex(unit.position, layout); const active = unit.id === state.activeUnitId; const selectedUnit = unit.id === view.selectedUnitId || unit.id === view.selectedTargetId; if (active || selectedUnit) { ctx.strokeStyle = active ? "#66e4ff" : "#ffe27a"; ctx.lineWidth = active ? 4 : 3; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, layout.size * .55), 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; } const image = imageFor(unit); const size = layout.size * (unit.kind === "squadron" ? .82 : 1.05); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(((unit.heading ?? 2) - 2) * Math.PI / 3); if (image.complete) ctx.drawImage(image, -size / 2, -size / 2, size, size); ctx.restore(); ctx.fillStyle = "#e8edf5"; ctx.font = "700 9px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.fillText(unit.name, p.x, p.y + layout.size * .68); });
       const labels = { "deployment-start": "Начало расстановки", "deployment-place": "Юнит размещён", "deployment-complete": "Расстановка завершена", "round-start": "Начало раунда", "activation-start": "Начало активации", "activation-stage": "Новый этап", "movement-step": "Шаг манёвра", "maneuver-completed": "Манёвр завершён", "attack-shot": "Выстрел", "damage-packet": "Получен урон", "unit-destroyed": "Юнит уничтожен", victory: "Бой завершён", wait: "Ожидание", "disengagement-succeeded": "Отрыв успешен", "disengagement-failed": "Отрыв не удался" };
       els.log.replaceChildren(...state.events.slice(-30).reverse().map(event => { const item = document.createElement("li"); item.dataset.eventAction = event.action; const details = event.position ? ` · (${event.position.q},${event.position.r})` : event.after?.stage ? ` · ${event.after.stage}` : event.after?.winner ? ` · победитель: ${event.after.winner}` : event.random?.roll !== undefined ? ` · бросок ${Math.round(event.random.roll)}%` : ""; item.textContent = `${labels[event.action] ? `${labels[event.action]} [${event.action}]` : event.action}${event.actorId ? ` · ${event.actorId}` : ""}${details}`; return item; }));
  }
  function animateAttack(from, to, hit) { const start = pixelForHex(from, layout), end = pixelForHex(to, layout); const beam = document.getElementById("attackBeam"); beam.setAttribute("x1", String(start.x)); beam.setAttribute("y1", String(start.y)); beam.setAttribute("x2", String(end.x)); beam.setAttribute("y2", String(end.y)); beam.classList.toggle("miss", !hit); beam.parentElement.removeAttribute("hidden"); beam.parentElement.classList.remove("firing"); void beam.parentElement.getBoundingClientRect(); beam.parentElement.classList.add("firing"); globalThis.setTimeout(() => { beam.parentElement.hidden = true; beam.parentElement.classList.remove("firing"); }, 520); }
  return { canvas, els, hexForPoint: (x, y) => hexForPixel(x, y, layout), pointForHex: position => pixelForHex(position, layout), animateAttack, render };
}
