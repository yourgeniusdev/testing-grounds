import { advanceActivation, confirmDeployment, decide, deployUnit, disengage, moveAtomic, planMovement, planRam, previewManeuverRoute, progress, ram, resolveAttack } from "./v1-domain.ts";
import { getAttackPreview, getWeaponSelection } from "./v1-preview.ts";
import type { BattleStoreFacade } from "./v1-store.ts";
import type { BattleState, Position } from "./v1-types.ts";

interface BattleView {
  selectedUnitId: string | null;
  plannedPosition: Position | null;
  plannedRoute: Position[];
  plannedHeading: number | null;
  headingSelected: boolean;
  routeReason: string | null;
  selectedTargetId: string | null;
  selectedWeaponIndex: number;
  maneuverPreview?: ReturnType<typeof previewManeuverRoute> | null;
}
interface RendererContract {
  canvas: HTMLCanvasElement;
  els: Record<string, HTMLElement>;
  hexForPoint(x: number, y: number): Position;
  render(state: BattleState, view: BattleView): void;
  animateAttack?(from: Position, to: Position, hit: boolean): void;
}
const same = (a: Position | null | undefined, b: Position | null | undefined) => Boolean(a && b && a.q === b.q && a.r === b.r);

export function createBattleController({ document, store, renderer, random = Math.random }: { document: Document; store: BattleStoreFacade; renderer: RendererContract; random?: () => number }) {
  const view: BattleView = { selectedUnitId: null, plannedPosition: null, plannedRoute: [], plannedHeading: null, headingSelected: false, routeReason: null, selectedTargetId: null, selectedWeaponIndex: 0 };
  let logVisibleFrom = 0;
  const clearRoute = () => { view.plannedPosition = null; view.plannedRoute = []; view.routeReason = null; };
  const clearSelection = () => { view.selectedUnitId = null; view.selectedTargetId = null; view.selectedWeaponIndex = 0; clearRoute(); view.plannedHeading = null; view.headingSelected = false; };
  const render = () => { const state = store.getState(); if (state.lifecycle !== "Maneuver") { clearRoute(); view.plannedHeading = null; } view.maneuverPreview = state.lifecycle === "Maneuver" && view.selectedUnitId ? previewManeuverRoute(state, view.selectedUnitId, view.plannedRoute, { heading: view.plannedHeading, ramTargetId: view.selectedTargetId }) : null; renderer.render({ ...state, events: state.events.slice(logVisibleFrom) }, view); };
  const transact = <Result>(command: (state: BattleState) => Result) => store.transact(command);
  renderer.canvas.addEventListener("click", event => {
    const state = store.getState(); const rect = renderer.canvas.getBoundingClientRect(); const position = renderer.hexForPoint(event.clientX - rect.left, event.clientY - rect.top); const unit = state.units.find(candidate => same(candidate.position, position)); const object = state.contents.find(candidate => candidate.kind === "object" && candidate.size === "large" && same(candidate.position, position));
    if (unit || object) {
      const active = state.units.find(candidate => candidate.id === state.activeUnitId); const ramTarget = unit ?? object;
      if (unit && state.lifecycle === "Attack" && unit.side !== active?.side) view.selectedTargetId = unit.id;
      else if (state.lifecycle === "Maneuver" && active?.kind === "capital" && ((unit?.kind === "capital" && unit.side !== active.side) || object) && view.selectedUnitId === active.id) {
        const plan = planRam(state, active, ramTarget);
        view.selectedTargetId = ramTarget.id; view.plannedPosition = plan.valid ? plan.steps.at(-1) : null; view.plannedRoute = plan.valid ? plan.steps : []; view.routeReason = plan.valid ? null : "Нет допустимого маршрута для тарана";
        if (!view.headingSelected && plan.valid) view.plannedHeading = plan.finalHeading;
      } else if (unit) { view.selectedUnitId = unit.id; view.selectedTargetId = null; clearRoute(); view.plannedHeading = unit.kind === "capital" ? unit.heading : null; view.headingSelected = false; }
      return render();
    }
    if (view.selectedUnitId && (state.lifecycle === "DeploymentLeft" || state.lifecycle === "DeploymentRight")) transact(current => deployUnit(current, view.selectedUnitId, position, 2));
    else if (view.selectedUnitId && state.lifecycle === "Maneuver") { const plan = planMovement(state, view.selectedUnitId, position); const selected = state.units.find(candidate => candidate.id === view.selectedUnitId); view.plannedPosition = plan.valid ? position : null; view.plannedRoute = plan.valid ? plan.steps : []; if (!view.headingSelected) view.plannedHeading = plan.valid && selected?.kind === "capital" ? plan.finalHeading : selected?.kind === "capital" ? selected.heading : null; view.routeReason = plan.valid ? null : plan.reason; render(); }
  });
  renderer.els.weapons.addEventListener("click", event => { const button = (event.target as Element).closest<HTMLElement>("[data-weapon-index]"); if (!button) return; view.selectedWeaponIndex = Number(button.dataset.weaponIndex); render(); });
  const confirmMove = () => transact(current => { if (view.selectedUnitId !== current.activeUnitId || (!view.plannedRoute.length && !view.headingSelected)) return false; const result = moveAtomic(current, view.selectedUnitId, view.plannedRoute, { heading: view.plannedHeading, random }); clearRoute(); view.plannedHeading = null; view.headingSelected = false; return result; });
  renderer.els.confirmMove.addEventListener("click", confirmMove);
  document.getElementById("confirmManeuverButton").addEventListener("click", confirmMove);
  renderer.els.disengage.addEventListener("click", () => transact(current => disengage(current, view.selectedUnitId, { random })));
  renderer.els.ram.addEventListener("click", () => transact(current => {
    const attacker = current.units.find(unit => unit.id === current.activeUnitId);
    const target = [...current.units, ...current.contents].find(item => item.id === view.selectedTargetId);
    if (!attacker || !target || !view.plannedRoute.length) return false;
    const result = ram(current, attacker, target, view.plannedRoute, { random });
    view.selectedTargetId = null; clearRoute();
    return result;
  }));
  renderer.els.heading.addEventListener("click", event => { const button = (event.target as Element).closest<HTMLElement>("[data-heading]"); if (!button) return; view.plannedHeading = Number(button.dataset.heading); view.headingSelected = true; render(); });
  renderer.els.cancelManeuver.addEventListener("click", () => { clearRoute(); const selected = store.getState().units.find(unit => unit.id === view.selectedUnitId); view.plannedHeading = selected?.kind === "capital" ? selected.heading : null; view.headingSelected = false; render(); });
  renderer.els.skipAttack.addEventListener("click", () => { view.selectedTargetId = null; view.selectedWeaponIndex = 0; transact(current => advanceActivation(current, "EndActivation")); });
  renderer.els.confirm.addEventListener("click", () => transact(current => confirmDeployment(current, current.lifecycle === "DeploymentLeft" ? "left" : "right", { random })));
  renderer.els.wait.addEventListener("click", () => transact(current => decide(current, "wait")));
  renderer.els.end.addEventListener("click", () => transact(current => {
    if (current.lifecycle === "SystemActions") advanceActivation(current, "Maneuver");
    else if (current.lifecycle === "Maneuver") advanceActivation(current, "Attack");
    else if (current.lifecycle === "Attack") {
      const attacker = current.units.find(unit => unit.id === current.activeUnitId); const target = current.units.find(unit => unit.id === view.selectedTargetId); const { weapon, available } = getWeaponSelection(attacker, view.selectedWeaponIndex);
       if (attacker && target && available && getAttackPreview(current, attacker.id, target.id, view.selectedWeaponIndex)?.canAttack) { const result = resolveAttack(current, attacker, target, getWeaponSelection(attacker, view.selectedWeaponIndex).slot, { random }); if (attacker.position && target.position) renderer.animateAttack?.(attacker.position, target.position, result.hits > 0); }
      if ((current.lifecycle as string) !== "Finished") advanceActivation(current, "EndActivation");
      view.selectedTargetId = null; view.selectedWeaponIndex = 0;
    } else if (current.lifecycle === "WaitDecision") decide(current, "continue");
     else progress(current, { random });
  }));
  document.getElementById("resetButton").addEventListener("click", () => { clearSelection(); logVisibleFrom = 0; store.reset(); });
  document.getElementById("clearLogButton").addEventListener("click", () => { logVisibleFrom = store.getState().events.length; render(); });
  document.getElementById("menuButton").addEventListener("click", () => { document.getElementById("battleScreen").hidden = true; document.getElementById("menuScreen").hidden = false; });
  const rules = document.getElementById("rulesDialog") as HTMLDialogElement;
  document.getElementById("rulesButton").addEventListener("click", () => rules.showModal());
  document.getElementById("closeRules").addEventListener("click", () => rules.close());
  document.getElementById("dialogOkay").addEventListener("click", () => rules.close());
  document.getElementById("startBattleButton").addEventListener("click", () => { clearSelection(); logVisibleFrom = 0; store.reset(); document.getElementById("menuScreen").hidden = true; document.getElementById("battleScreen").hidden = false; render(); });
  store.subscribe(render); render();
  return { view, render };
}
