import assert from "node:assert/strict";
import test from "node:test";
import { beginActivation, createBattleState, unitById } from "./domain.js";
import { bindRulesDialog, cancelPendingAction, pendingWeaponId, recalculateActionUi, selectPendingAction, shouldCancelCanvasAction, shouldCancelDocumentAction } from "./ui-controller.js";

function rulesFixture() {
  let focused;
  function element(id) {
    const listeners = new Map();
    return {
      id, attributes: {}, hidden: false, tabIndex: 0,
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      focus() { focused = this; },
      addEventListener(name, listener) { listeners.set(name, listener); },
      dispatch(name, event = {}) { listeners.get(name)?.(event); }
    };
  }
  const panels = Array.from({ length: 4 }, (_, index) => element(`panel-${index}`));
  const tabs = panels.map((panel, index) => {
    const tab = element(`tab-${index}`);
    tab.setAttribute("aria-controls", panel.id);
    return tab;
  });
  const dialog = element("dialog");
  dialog.querySelectorAll = selector => selector === '[role="tab"]' ? tabs : panels;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatch("close"); };
  const opener = element("opener");
  const closeButtons = [element("close"), element("okay")];
  bindRulesDialog(dialog, opener, closeButtons);
  return { dialog, tabs, panels, opener, closeButtons, focused: () => focused };
}

test("rules dialog resets to activation on every opening and restores focus on closing", () => {
  const ui = rulesFixture();
  for (const button of ui.closeButtons) {
    ui.opener.dispatch("click");
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.focused(), ui.tabs[0]);
    assert.deepEqual(ui.panels.map(panel => panel.hidden), [false, true, true, true]);
    ui.tabs[2].dispatch("click");
    assert.deepEqual(ui.tabs.map(tab => tab.attributes["aria-selected"]), ["false", "false", "true", "false"]);
    assert.deepEqual(ui.panels.map(panel => panel.hidden), [true, true, false, true]);
    button.dispatch("click");
    assert.equal(ui.dialog.open, false);
    assert.equal(ui.focused(), ui.opener);
  }
  ui.opener.dispatch("click");
  ui.dialog.close();
  assert.equal(ui.focused(), ui.opener);
});

test("rules tabs automatically activate with wrapping arrows and Home/End, leaving Tab and Escape native", () => {
  const ui = rulesFixture();
  ui.opener.dispatch("click");
  for (const [from, key, to] of [[0, "ArrowLeft", 3], [3, "ArrowRight", 0], [0, "End", 3], [3, "Home", 0], [0, "ArrowRight", 1], [1, "ArrowLeft", 0]]) {
    let prevented = false;
    ui.tabs[from].dispatch("keydown", { key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(ui.focused(), ui.tabs[to]);
    assert.deepEqual(ui.tabs.map(tab => tab.tabIndex), ui.tabs.map((_, index) => index === to ? 0 : -1));
    assert.deepEqual(ui.panels.map(panel => panel.hidden), ui.panels.map((_, index) => index !== to));
  }
  for (const key of ["Tab", "Escape", "ArrowDown"]) {
    ui.tabs[0].dispatch("keydown", { key, preventDefault() { assert.fail(`${key} must remain native`); } });
  }
});

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
  assert.equal(selectPendingAction(state, ui, { type: "system-action", systemActionId: "reactor-to-engines", reason: "player-choice" }), true);
  assert.equal(state.activeAction.systemActionId, "reactor-to-engines");
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

test("UI recalculation clears stale route and target previews before rebuilding current routes", () => {
  const { state, atlas, ui } = setup();
  selectPendingAction(state, ui, { type: "maneuver", reason: "player-choice" });
  ui.selected = { targetId: "stale-target" };
  ui.hoveredOption = { optionId: "stale-route" };
  ui.optionTargets = [{ optionId: "stale-route" }];
  ui.hoveredWeapon = atlas.weapons[0].id;
  let plannedWith = null;

  const routes = recalculateActionUi(state, ui, atlas, (current, unit, policy) => {
    plannedWith = { current, unit, policy };
    return new Map([["current", {}]]);
  }, "safe");

  assert.equal(routes, ui.routes);
  assert.equal(ui.routes.has("current"), true);
  assert.deepEqual({ selected: ui.selected, hoveredOption: ui.hoveredOption, optionTargets: ui.optionTargets, hoveredWeapon: ui.hoveredWeapon, tooltipHex: ui.tooltipHex }, {
    selected: null, hoveredOption: null, optionTargets: [], hoveredWeapon: null, tooltipHex: null
  });
  assert.deepEqual(plannedWith, { current: state, unit: atlas, policy: "safe" });
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
