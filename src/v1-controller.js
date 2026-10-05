import { advanceActivation, confirmDeployment, decide, deployUnit, disengage, moveAtomic, planMovement, previewManeuverRoute, progress, ram, resolveAttack } from "./v1-domain.js";
import { getAttackPreview, getWeaponSelection } from "./v1-preview.js";

const same = (a, b) => a && b && a.q === b.q && a.r === b.r;

export function createBattleController({ document, store, renderer }) {
  const view = { selectedUnitId: null, plannedPosition: null, plannedRoute: [], plannedHeading: null, headingSelected: false, routeReason: null, selectedTargetId: null, selectedWeaponIndex: 0 };
  const clearRoute = () => { view.plannedPosition = null; view.plannedRoute = []; view.routeReason = null; };
  const clearSelection = () => { view.selectedUnitId = null; view.selectedTargetId = null; view.selectedWeaponIndex = 0; clearRoute(); view.plannedHeading = null; view.headingSelected = false; };
  const render = () => { const state = store.getState(); if (state.lifecycle !== "Maneuver") { clearRoute(); view.plannedHeading = null; } view.maneuverPreview = state.lifecycle === "Maneuver" && view.selectedUnitId ? previewManeuverRoute(state, view.selectedUnitId, view.plannedRoute, { heading: view.plannedHeading, ramTargetId: view.selectedTargetId }) : null; renderer.render(state, view); };
  const transact = command => store.transact(command);
  renderer.canvas.addEventListener("click", event => {
    const state = store.getState(); const rect = renderer.canvas.getBoundingClientRect(); const position = renderer.hexForPoint(event.clientX - rect.left, event.clientY - rect.top); const unit = state.units.find(candidate => same(candidate.position, position));
    if (unit) {
      const active = state.units.find(candidate => candidate.id === state.activeUnitId);
      if (state.lifecycle === "Attack" && unit.side !== active?.side) view.selectedTargetId = unit.id;
      else if (state.lifecycle === "Maneuver" && active?.kind === "capital" && unit.kind === "capital" && unit.side !== active.side && view.selectedUnitId === active.id) {
        const approaches = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }].map(direction => ({ q: unit.position.q + direction.q, r: unit.position.r + direction.r }));
        const plan = approaches.map(destination => planMovement(state, active.id, destination)).find(candidate => candidate.valid);
        view.selectedTargetId = unit.id; view.plannedPosition = plan?.steps.at(-1) ?? null; view.plannedRoute = plan?.steps ?? []; view.routeReason = plan ? null : "Нет допустимого маршрута для тарана";
        if (!view.headingSelected && plan) view.plannedHeading = plan.finalHeading;
      } else { view.selectedUnitId = unit.id; view.selectedTargetId = null; clearRoute(); view.plannedHeading = unit.kind === "capital" ? unit.heading : null; view.headingSelected = false; }
      return render();
    }
    if (view.selectedUnitId && (state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight")) transact(current => deployUnit(current, view.selectedUnitId, position, 2));
    else if (view.selectedUnitId && state.lifecycle === "Maneuver") { const plan = planMovement(state, view.selectedUnitId, position); const selected = state.units.find(candidate => candidate.id === view.selectedUnitId); view.plannedPosition = plan.valid ? position : null; view.plannedRoute = plan.valid ? plan.steps : []; if (!view.headingSelected) view.plannedHeading = plan.valid && selected?.kind === "capital" ? plan.finalHeading : selected?.kind === "capital" ? selected.heading : null; view.routeReason = plan.valid ? null : plan.reason; render(); }
  });
  renderer.els.weapons.addEventListener("click", event => { const button = event.target.closest("[data-weapon-index]"); if (!button) return; view.selectedWeaponIndex = Number(button.dataset.weaponIndex); render(); });
  renderer.els.confirmMove.addEventListener("click", () => transact(current => { if (view.selectedUnitId !== current.activeUnitId || (!view.plannedRoute.length && !view.headingSelected)) return false; const result = moveAtomic(current, view.selectedUnitId, view.plannedRoute, { heading: view.plannedHeading }); clearRoute(); view.plannedHeading = null; view.headingSelected = false; return result; }));
  renderer.els.disengage.addEventListener("click", () => transact(current => disengage(current, view.selectedUnitId, { random: () => 0 })));
  renderer.els.ram.addEventListener("click", () => transact(current => {
    const attacker = current.units.find(unit => unit.id === current.activeUnitId);
    const target = current.units.find(unit => unit.id === view.selectedTargetId);
    if (!attacker || !target || !view.plannedRoute.length) return false;
    const result = ram(current, attacker, target, view.plannedRoute, { random: () => 0 });
    view.selectedTargetId = null; clearRoute();
    return result;
  }));
  renderer.els.heading.addEventListener("click", event => { const button = event.target.closest("[data-heading]"); if (!button) return; view.plannedHeading = Number(button.dataset.heading); view.headingSelected = true; render(); });
  renderer.els.cancelManeuver.addEventListener("click", () => { clearRoute(); const selected = store.getState().units.find(unit => unit.id === view.selectedUnitId); view.plannedHeading = selected?.kind === "capital" ? selected.heading : null; view.headingSelected = false; render(); });
  renderer.els.skipAttack.addEventListener("click", () => { view.selectedTargetId = null; view.selectedWeaponIndex = 0; transact(current => advanceActivation(current, "EndActivation")); });
  renderer.els.confirm.addEventListener("click", () => transact(current => confirmDeployment(current, current.lifecycle === "DeploymentLeft" ? "left" : "right")));
  renderer.els.wait.addEventListener("click", () => transact(current => decide(current, "wait")));
  renderer.els.end.addEventListener("click", () => transact(current => {
    if (current.lifecycle === "SystemActions") advanceActivation(current, "Maneuver");
    else if (current.lifecycle === "Maneuver") advanceActivation(current, "Attack");
    else if (current.lifecycle === "Attack") {
      const attacker = current.units.find(unit => unit.id === current.activeUnitId); const target = current.units.find(unit => unit.id === view.selectedTargetId); const { weapon, available } = getWeaponSelection(attacker, view.selectedWeaponIndex);
      if (attacker && target && available && getAttackPreview(current, attacker.id, target.id, view.selectedWeaponIndex)?.canAttack) resolveAttack(current, attacker, target, weapon, { random: () => 0 });
      if (current.lifecycle !== "Finished") advanceActivation(current, "EndActivation");
      view.selectedTargetId = null; view.selectedWeaponIndex = 0;
    } else if (current.lifecycle === "WaitDecision") decide(current, "continue");
    else progress(current);
  }));
  document.getElementById("resetButton").addEventListener("click", () => { clearSelection(); store.reset(); });
  document.getElementById("startBattleButton").addEventListener("click", () => { clearSelection(); store.reset(); document.getElementById("menuScreen").hidden = true; document.getElementById("battleScreen").hidden = false; render(); });
  store.subscribe(render); render();
  return { view, render };
}
