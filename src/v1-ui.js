import { advanceActivation, confirmDeployment, decide, deployUnit, moveAtomic, progress } from "./v1-domain.js";
import { createBattleStore, createLocalPersistence } from "./v1-store.js";

const canvas = document.getElementById("battlefield");
const ctx = canvas.getContext("2d");
const store = createBattleStore({ persistence: createLocalPersistence("v1-combat-ui"), initial: {
  id: "v1-ui", bounds: { minCol: 0, maxCol: 7, minRow: 0, maxRow: 5 }, units: [
    { id: "left-cap", side: "left", kind: "capital", name: "Aegis", initiative: 5, integrity: 12, armor: 3, shield: 2, mass: 3, speed: 2, position: null, weapons: [{ id: "battery", accuracy: 100, damage: 2, shots: 1, maxRange: 5 }] },
    { id: "left-squad", side: "left", kind: "squadron", name: "Lance", initiative: 4, integrity: 6, unitHealth: 2, stack: 3, speed: 3, position: null },
    { id: "right-cap", side: "right", kind: "capital", name: "Bastion", initiative: 3, integrity: 12, armor: 3, shield: 2, mass: 3, speed: 2, position: null, weapons: [{ id: "battery", accuracy: 100, damage: 2, shots: 1, maxRange: 5 }] },
    { id: "right-squad", side: "right", kind: "squadron", name: "Raptor", initiative: 2, integrity: 6, unitHealth: 2, stack: 3, speed: 3, position: null }
  ]
} });

const state = store.getState();
const els = {
  menu: document.getElementById("menuScreen"), battle: document.getElementById("battleScreen"), start: document.getElementById("startBattleButton"),
  confirm: document.getElementById("confirmDeploymentButton"), wait: document.getElementById("waitButton"), end: document.getElementById("endActivationButton"), reset: document.getElementById("resetButton"),
  round: document.getElementById("roundNumber"), stage: document.getElementById("stageLabel"), mode: document.getElementById("modeLabel"), list: document.getElementById("initiativeList"), log: document.getElementById("combatLog")
};
let selected = null;
const origin = { x: 90, y: 90, size: 38 };
const pixel = ({ q, r }) => ({ x: origin.x + origin.size * Math.sqrt(3) * (q + r / 2), y: origin.y + origin.size * 1.5 * r });
const hex = (x, y) => { const q = (x - origin.x) / (origin.size * Math.sqrt(3)) - (y - origin.y) / (origin.size * 3); const r = (y - origin.y) / (origin.size * 1.5); return { q: Math.round(q), r: Math.round(r) }; };
const same = (a, b) => a && b && a.q === b.q && a.r === b.r;

function log() { els.log.innerHTML = state.events.slice(-30).reverse().map(event => `<li>${event.action}</li>`).join(""); }
function render() {
  els.round.textContent = state.round; els.stage.textContent = state.lifecycle; els.mode.textContent = state.winner ? `ПОБЕДА: ${state.winner}` : "КАНОНИЧЕСКИЙ V1";
  els.confirm.hidden = !(state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight");
  els.wait.disabled = state.lifecycle !== "WaitDecision"; els.end.disabled = !["SystemActions", "Maneuver", "Attack"].includes(state.lifecycle);
  els.list.innerHTML = state.units.map(unit => `<div class="mission-card"><strong>${unit.name}</strong><span>${unit.side} · ${unit.kind} · ${unit.integrity} HP</span></div>`).join("");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let q = 0; q < 8; q += 1) for (let r = 0; r < 6; r += 1) { const p = pixel({ q, r }); ctx.strokeStyle = "#536174"; ctx.beginPath(); for (let i = 0; i < 6; i += 1) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(p.x + origin.size * Math.cos(a), p.y + origin.size * Math.sin(a)); } ctx.closePath(); ctx.stroke(); }
  state.units.forEach(unit => { if (!unit.position) return; const p = pixel(unit.position); ctx.fillStyle = unit.side === "left" ? "#55b9ff" : "#ff6e7a"; ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#08111f"; ctx.textAlign = "center"; ctx.fillText(unit.name[0], p.x, p.y + 5); });
  log();
}
function transact(command) { store.transact(command); render(); }
canvas.addEventListener("click", event => { const rect = canvas.getBoundingClientRect(); const position = hex(event.clientX - rect.left, event.clientY - rect.top); const unit = state.units.find(candidate => same(candidate.position, position)); if (unit) { selected = unit.id; return render(); } if (selected && (state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight")) transact(current => deployUnit(current, selected, position, 2)); else if (selected && state.lifecycle === "Maneuver") transact(current => moveAtomic(current, selected, [position])); });
els.confirm.addEventListener("click", () => transact(current => confirmDeployment(current, current.lifecycle === "DeploymentLeft" ? "left" : "right")));
els.wait.addEventListener("click", () => transact(current => decide(current, "wait")));
els.end.addEventListener("click", () => transact(current => { if (current.lifecycle === "SystemActions") advanceActivation(current, "Maneuver"); else if (current.lifecycle === "Maneuver") advanceActivation(current, "Attack"); else if (current.lifecycle === "Attack") advanceActivation(current, "EndActivation"); else progress(current); }));
els.reset.addEventListener("click", () => { store.reset(); selected = null; render(); });
els.start.addEventListener("click", () => { els.menu.hidden = true; els.battle.hidden = false; render(); });
store.subscribe(render); render();
export { store };
