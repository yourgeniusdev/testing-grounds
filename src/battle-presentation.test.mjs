import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBattleState, confirmDeployment, activeUnit, endActivation, waitActiveUnit } from "./domain.js";
import { createActivationTransitionGuard, adjacentTooltip, createHoldGesture, damageIndicators, impactPlacement, informationTooltipLayout, inspectionObjects, repeatedTargetTap, visualShotSchedule } from "./battle-presentation.js";

test("mobile transition guard prevents repeated taps from ending the new activation", () => {
  let now = 0;
  const guard = createActivationTransitionGuard(() => now);
  const state = createBattleState();
  const run = action => guard.run(true, action);
  assert.equal(run(() => confirmDeployment(state, "azure")), true);
  assert.equal(run(() => confirmDeployment(state, "crimson")), false);
  now = 450;
  assert.equal(run(() => confirmDeployment(state, "crimson")), true);
  assert.equal(activeUnit(state).id, "hornet-azure");
  now = 899;
  assert.equal(run(() => endActivation(state)), false);
  assert.equal(activeUnit(state).id, "hornet-azure");
  now = 900;
  assert.ok(run(() => endActivation(state)));
  const next = activeUnit(state).id;
  assert.equal(run(() => endActivation(state)), false);
  assert.equal(activeUnit(state).id, next);
  now = 1350;
  assert.equal(run(() => waitActiveUnit(state)), true);
  const afterWait = activeUnit(state).id;
  assert.equal(run(() => endActivation(state)), false);
  assert.equal(activeUnit(state).id, afterWait);
});

test("transition guard leaves desktop immediate and failed actions do not arm it", () => {
  const guard = createActivationTransitionGuard(() => 0);
  assert.equal(guard.run(true, () => false), false);
  assert.equal(guard.run(true, () => null), null);
  assert.equal(guard.run(true, () => true), true);
  assert.equal(guard.run(false, () => true), true);
  assert.equal(guard.run(false, () => true), true);
});

test("tooltip uses hex boundary and fitting side without covering target", () => {
  for (const x of [25, 160, 320, 615]) {
    const layout = adjacentTooltip({ x, y: 180 }, 16, { width: 640, height: 220 }, 220, 150);
    assert.ok(layout.left >= 0);
    assert.ok(layout.left + layout.width <= 640);
    assert.ok(layout.left > x || layout.left + layout.width < x);
    assert.ok(layout.top >= 8 && layout.top + 150 <= 220);
  }
});

test("damage is factual per layer and squadron loss is separate", () => {
  assert.deepEqual(damageIndicators({ shield: 3, armor: 5, integrity: 8, stack: 2 }, { shield: 0, armor: 0, integrity: 4, stack: 1 }).map(value => value.text), ["−3 ◇", "−5 ⬡", "−4 ♥", "−1 ✈"]);
  assert.deepEqual(damageIndicators({ shield: 0 }, { shield: 0 }).map(value => value.text), ["0"]);
  assert.equal(damageIndicators({}, {}, "miss")[0].text, "Промах");
});

test("visual cadence preserves immutable canonical plan identity and gameplay fields", () => {
  const plan = Object.freeze({ steps: Object.freeze([0, 1, 2].map(index => Object.freeze({ index, launchTime: index * 20, duration: 100, arrivalTime: index * 20 + 100, damage: 4 }))) });
  const visual = visualShotSchedule(plan);
  assert.equal(visual.domainPlan, plan);
  assert.deepEqual(visual.steps.map(step => step.launchTime), [0, 150, 300]);
  assert.deepEqual(visual.steps.map(step => step.damage), [4, 4, 4]);
  assert.equal(plan.steps[1].launchTime, 20);
});

test("consumed hold suppresses release click without a time limit and resets for next gesture", () => {
  const gesture = createHoldGesture();
  gesture.begin(); gesture.consume();
  assert.equal(gesture.click(), true);
  assert.equal(gesture.click(), false);
  gesture.consume(); gesture.begin();
  assert.equal(gesture.click(), false);
  gesture.consume(); gesture.cancel();
  assert.equal(gesture.click(), false);
  gesture.begin();
  assert.equal(gesture.click(), false);
});

test("live impacts reserve separate footprints including all layers and rise", () => {
  const live = [];
  for (let i = 0; i < 15; i++) {
    const box = impactPlacement({ x: 300 + i % 2, y: 200 }, 58, i % 2 ? 84 : 21, live);
    for (const other of live) assert.ok(box.left >= other.left + other.width || box.left + box.width <= other.left || box.top - 32 >= other.top + other.height || box.top + box.height <= other.top - 32);
    live.push(box);
  }
  assert.deepEqual(impactPlacement({ x: 300, y: 200 }, 58, 21, []), live[0]);
});

test("inspection includes every unit and terrain object at the hex", () => {
  const position = { q: 0, r: 1 };
  const units = [{ id: "a", position }, { id: "b", position }];
  const contents = [{ id: "terrain", position }, { id: "station", position }, { id: "elsewhere", position: { q: 1, r: 1 } }];
  assert.deepEqual(inspectionObjects(units, contents, position).map(item => item.id), ["a", "b", "terrain", "station"]);
});

test("integration remeasures constrained tooltip, preserves overlay plan, and previews invalid enemies", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(app.indexOf('el.tooltip.style.width = `${layout.width}px`') < app.indexOf("const measured = adjacentTooltip"));
  assert.match(app, /const measured = adjacentTooltip[^;]+el.tooltip.offsetHeight/);
  assert.doesNotMatch(css, /\[data-panel="actions"\]/);
  const filter = app.match(/const eligible = state.units.filter\([^;]+/)[0];
  assert.match(filter, /unit.sideId !== attacker.sideId/);
  assert.doesNotMatch(filter, /canConfirm/);
  assert.match(app, /confirmPlan"\).disabled =[^;]+\.canConfirm/);
  assert.doesNotMatch(app, /suppressClickUntil/);
  assert.match(app, /if \(inspectHex\(pointerHex\(event\), event\)\) holdGesture.consume\(\)/);
});

test("information tooltip stays compact and clamps every viewport edge with scrollable height", () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 480 }, { width: 180, height: 120 }]) {
    for (const x of [0, viewport.width / 2, viewport.width]) {
      for (const y of [0, viewport.height / 2, viewport.height]) {
        for (const height of [40, 200, 2000]) {
          const layout = informationTooltipLayout({ x, y }, viewport, height);
          assert.ok(layout.width <= 220);
          assert.ok(layout.left >= 8 && layout.left + layout.width <= viewport.width - 8);
          assert.ok(layout.top >= 8 && layout.top + Math.min(height, layout.maxHeight) <= viewport.height - 8);
        }
      }
    }
  }
});

test("hold information uses independent non-modal popovers and consumes outside dismissal", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const hold = app.slice(app.indexOf('document.addEventListener("pointerdown"'));
  assert.match(hold, /showInformationPopover\(description.innerHTML, event\)/);
  assert.match(hold, /inspectHex\(pointerHex\(event\), event\)/);
  assert.doesNotMatch(hold, /showModal|Закрыть|dataset.panel/);
  assert.match(hold, /closeInformationPopover\(\);\s+holdGesture.consume\(\);\s+event.preventDefault\(\);\s+event.stopImmediatePropagation\(\)/);
  const show = app.slice(app.indexOf("function showInformationPopover"), app.indexOf("function inspectHex"));
  assert.doesNotMatch(show, /pinned\s*=|ui.selected\s*=|cancelAction|Закрыть|dialog/);
  assert.match(app, /if \(held \|\| outside\) \{ event.preventDefault\(\); event.stopImmediatePropagation\(\); \}/);
});

test("mobile chrome overlays the full field and initiative uses compact information only", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const mobileCss = css.slice(css.indexOf("@media (pointer:coarse), (max-width:950px)"));
  assert.match(mobileCss, /\.topbar \{ display:none; \}/);
  assert.match(mobileCss, /grid-template-rows:minmax\(0,1fr\)/);
  assert.match(mobileCss, /\.command-deck \{ position:fixed;[^}]+left:55px; top:6px; bottom:6px/);
  assert.match(mobileCss, /\.action-groups \{ display:flex; flex:1; flex-direction:column;[^}]+min-height:0; \}/);
  assert.match(mobileCss, /\.primary-action-groups \{ display:flex; flex:1; flex-direction:column;[^}]+min-height:0; overflow-y:auto/);
  assert.match(mobileCss, /\.action-group \{ flex:none; \}/);
  assert.match(css, /\.primary-action-groups \{ display:contents; \}/);
  assert.match(html, /class="primary-action-groups">[\s\S]*id="routePolicyButton"[\s\S]*id="attackWeaponActions"[^\n]+\n\s*<\/div>\s*<section class="action-group turn-action-group">/);
  assert.match(html, /class="turn-actions">[\s\S]*id="waitButton"[\s\S]*id="endActivationButton"[\s\S]*id="confirmDeploymentButton"/);
  assert.match(mobileCss, /\.action-group-scroll,\.attack-action-slots,\.turn-actions \{ flex-direction:column/);
  assert.match(mobileCss, /\.action-group-title,\.command-deck \.action-placeholders \{ display:none; \}/);
  assert.match(mobileCss, /\.mobile-battle-status \{[^}]+top:6px; right:84px; z-index:4/);
  assert.match(mobileCss, /\.energy-resource \{ position:fixed; left:123px; right:auto; bottom:6px;[^}]+grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(html, /data-panel="actions"/);
  assert.doesNotMatch(mobileCss, /data-panel[^\n]+(?:command-deck|action-groups)/);
  assert.doesNotMatch(mobileCss, /44px minmax|top:48px|100dvh - 92px/);
  assert.match(mobileCss, /\.energy-label \.energy-details \{ display:none; \}/);
  assert.match(app, /role="img" aria-label="Энергия: \$\{resourceMetricsText\(energy, energyPreview\)\}/);
  assert.match(html, /data-panel="log">Журнал<\/button><button id="mobileMenuButton"/);
  assert.match(app, /mobileMenuButton"\).addEventListener\("click", exitBattle\)/);
  const initiative = app.slice(app.indexOf('el.initiativeList.addEventListener("click"'), app.indexOf('el.clearLogButton.addEventListener'));
  const compact = initiative.slice(initiative.indexOf("if (mobile())"), initiative.indexOf("const model"));
  assert.match(compact, /unit.name.*Инициатива.*unit.initiative/);
  assert.match(compact, /showInformationPopover/);
  assert.doesNotMatch(compact, /unitTooltip|dialog|dataset.panel/);
  assert.match(compact, /return;/);
});

test("repeat target confirmation requires same target and 350ms", () => {
  assert.equal(repeatedTargetTap({ targetId: "a", time: 100 }, "a", 449), false);
  assert.equal(repeatedTargetTap({ targetId: "a", time: 100 }, "a", 450), true);
  assert.equal(repeatedTargetTap({ targetId: "a", time: 100 }, "b", 500), false);
});
