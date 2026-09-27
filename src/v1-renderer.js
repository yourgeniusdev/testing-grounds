import { formatAttackPreview, getAttackPreview } from "./v1-preview.js";

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
    round: document.getElementById("roundNumber"), stage: document.getElementById("stageLabel"), mode: document.getElementById("modeLabel"), list: document.getElementById("initiativeList"), log: document.getElementById("combatLog"), weapons: document.getElementById("attackWeaponActions"), summary: document.getElementById("weaponSummary")
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
    els.summary.textContent = state.lifecycle === "Attack" ? formatAttackPreview(preview) : "";
    if (state.lifecycle === "Attack") els.mode.textContent = preview?.canAttack ? `ЗАЛП: ${formatAttackPreview(preview)}` : `АТАКА · ${formatAttackPreview(preview)}`;
    els.list.replaceChildren(...state.units.map(unit => { const item = document.createElement("div"); item.className = "mission-card"; const name = document.createElement("strong"); name.textContent = unit.name; const details = document.createElement("span"); details.textContent = `${unit.side} · ${unit.kind} · ${unit.integrity} HP`; item.append(name, details); return item; }));
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);
    for (let q = state.bounds.minCol; q <= state.bounds.maxCol; q += 1) for (let r = state.bounds.minRow; r <= state.bounds.maxRow; r += 1) { const p = pixelForHex({ q, r }, layout); ctx.strokeStyle = "#536174"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + layout.size * Math.cos(a), p.y + layout.size * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
    state.units.forEach(unit => { if (!unit.position) return; const p = pixelForHex(unit.position, layout); ctx.fillStyle = unit.side === "left" ? "#55b9ff" : "#ff6e7a"; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, layout.size * .4), 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#08111f"; ctx.textAlign = "center"; ctx.fillText(unit.name[0], p.x, p.y + 5); });
    els.log.replaceChildren(...state.events.slice(-30).reverse().map(event => { const item = document.createElement("li"); item.textContent = event.action; return item; }));
  }
  return { canvas, els, hexForPoint: (x, y) => hexForPixel(x, y, layout), pointForHex: position => pixelForHex(position, layout), render };
}
