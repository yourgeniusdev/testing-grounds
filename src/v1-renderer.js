import { formatAttackPreview, getAttackPreview } from "./v1-preview.js";

const origin = { x: 90, y: 90, size: 38 };
export const pixelForHex = ({ q, r }) => ({ x: origin.x + origin.size * Math.sqrt(3) * (q + r / 2), y: origin.y + origin.size * 1.5 * r });
export const hexForPixel = (x, y) => ({ q: Math.round((x - origin.x) / (origin.size * Math.sqrt(3)) - (y - origin.y) / (origin.size * 3)), r: Math.round((y - origin.y) / (origin.size * 1.5)) });

export function createBattleRenderer(document) {
  const canvas = document.getElementById("battlefield");
  const ctx = canvas.getContext("2d");
  const els = {
    confirm: document.getElementById("confirmDeploymentButton"), confirmMove: document.getElementById("confirmMoveButton"), skipAttack: document.getElementById("skipAttackButton"), wait: document.getElementById("waitButton"), end: document.getElementById("endActivationButton"),
    round: document.getElementById("roundNumber"), stage: document.getElementById("stageLabel"), mode: document.getElementById("modeLabel"), list: document.getElementById("initiativeList"), log: document.getElementById("combatLog"), weapons: document.getElementById("attackWeaponActions"), summary: document.getElementById("weaponSummary")
  };
  function render(state, view) {
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let q = 0; q < 8; q += 1) for (let r = 0; r < 6; r += 1) { const p = pixelForHex({ q, r }); ctx.strokeStyle = "#536174"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + origin.size * Math.cos(a), p.y + origin.size * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
    state.units.forEach(unit => { if (!unit.position) return; const p = pixelForHex(unit.position); ctx.fillStyle = unit.side === "left" ? "#55b9ff" : "#ff6e7a"; ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#08111f"; ctx.textAlign = "center"; ctx.fillText(unit.name[0], p.x, p.y + 5); });
    els.log.replaceChildren(...state.events.slice(-30).reverse().map(event => { const item = document.createElement("li"); item.textContent = event.action; return item; }));
  }
  return { canvas, els, render };
}
