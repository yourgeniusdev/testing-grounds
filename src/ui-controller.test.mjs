import assert from "node:assert/strict";
import test from "node:test";
import { beginActivation, createBattleState, unitById } from "./domain.js";
import { cancelPendingAction, pendingWeaponId, selectPendingAction, shouldCancelCanvasAction, shouldCancelDocumentAction } from "./ui-controller.js";

function setup() {
  const state = createBattleState();
  const atlas = unitById(state, "atlas");
  state.units = [atlas];
  state.initiativeOrder = [atlas.id];
  state.activeUnitId = atlas.id;
  state.lifecycle = "WaitDecision";
  beginActivation(state);
  const ui = { routes: new Map([["old", {}]]), selected: { targetId: "old" }, hoveredAction: { type: "maneuver" }, hoveredOption: {}, optionTargets: [{}], hoveredWeapon: "old", tooltipHex: { q: 1, r: 1 } };
  return { state, atlas, ui };
}

test("controller selects and switches plans while clearing all action transients", () => {
  const { state, atlas, ui } = setup();
  const left = atlas.weapons[0].id;

  assert.equal(selectPendingAction(state, ui, { type: "weapon-attack", slotId: left, reason: "player-choice" }), true);
  assert.equal(pendingWeaponId(state), left);
  assert.deepEqual(ui, { routes: new Map(), selected: null, hoveredAction: null, hoveredOption: null, optionTargets: [], hoveredWeapon: null, tooltipHex: null });

  ui.selected = { targetId: "new" };
  assert.equal(selectPendingAction(state, ui, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" }), true);
  assert.equal(state.activeAction.systemActionId, "evasive-maneuver");
  assert.equal(pendingWeaponId(state), null);
  assert.equal(ui.selected, null);
});

test("controller cancellation clears canonical planning and transients together", () => {
  const { state, atlas, ui } = setup();
  selectPendingAction(state, ui, { type: "weapon-attack", slotId: atlas.weapons[0].id, reason: "player-choice" });
  ui.selected = { targetId: "enemy" };

  assert.equal(cancelPendingAction(state, ui), true);
  assert.equal(state.activeAction, null);
  assert.equal(state.lifecycle, "ActionChoice");
  assert.equal(pendingWeaponId(state), null);
  assert.equal(ui.selected, null);
});

test("canvas cancellation ignores interactions that progress the active plan", () => {
  assert.equal(shouldCancelCanvasAction({ actionType: "maneuver", maneuverRoute: true }), false);
  assert.equal(shouldCancelCanvasAction({ actionType: "maneuver", maneuverOption: true }), false);
  assert.equal(shouldCancelCanvasAction({ actionType: "weapon-attack", weaponTarget: true }), false);
  assert.equal(shouldCancelCanvasAction({ actionType: "weapon-attack" }), true);
  assert.equal(shouldCancelCanvasAction({ actionType: "system-action" }), true);
  assert.equal(shouldCancelCanvasAction({ actionType: null }), false);
});

test("document outside cancellation preserves action controls, canvas progression, and weapon tooltip controls", () => {
  assert.equal(shouldCancelDocumentAction({ planning: true, insideActionControl: true }), false);
  assert.equal(shouldCancelDocumentAction({ planning: true, insideCanvas: true }), false);
  assert.equal(shouldCancelDocumentAction({ planning: true, insideWeaponTooltip: true }), false);
  assert.equal(shouldCancelDocumentAction({ planning: true }), true);
  assert.equal(shouldCancelDocumentAction({ planning: false }), false);
});
