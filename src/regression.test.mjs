import assert from "node:assert/strict";
import { activeUnit, axialToOffset, beginActionPlanning, confirmSystemAction, createBattleState } from "./domain.js";
import { headingAngle, maneuverResourcePreview, shouldDrawRoute, shouldHighlightOccupiedHex, shouldOutlineUnit } from "./ui-rules.js";

assert.equal(headingAngle(0), Math.PI / 2, "курс 0 должен направлять нарисованный вверх нос вправо");
assert.equal(headingAngle(3), -Math.PI / 2, "курс 3 должен направлять нос влево");
assert.equal(shouldDrawRoute({ targetId: "raptor" }), false, "выбранная цель атаки не должна отрисовываться как маршрут");
assert.equal(shouldDrawRoute({ route: { path: [] } }), true, "выбранный маршрут должен отрисовываться");
assert.equal(shouldHighlightOccupiedHex("DeploymentLeft"), false, "корабли не должны подсвечивать гекс во время расстановки левой стороны");
assert.equal(shouldHighlightOccupiedHex("DeploymentRight"), false, "корабли не должны подсвечивать гекс во время расстановки правой стороны");
assert.equal(shouldHighlightOccupiedHex("WaitDecision"), true, "корабли должны подсвечивать гекс после начала игрового цикла");
assert.equal(shouldOutlineUnit("atlas", "atlas", undefined, "DeploymentLeft"), false, "активный корабль не должен обводиться до окончания расстановки");
assert.equal(shouldOutlineUnit("atlas", "atlas", "atlas", "DeploymentLeft"), true, "выбранный игроком корабль должен обводиться при расстановке");
assert.equal(shouldOutlineUnit("atlas", "atlas", undefined, "WaitDecision"), true, "активный корабль должен обводиться после начала игрового цикла");
assert.deepEqual(maneuverResourcePreview({ kind: "capital", heading: 0, speedSpent: 0, maneuverSpent: 0, evasiveManeuver: false }, null, () => 0), { speedSpent: 0, speedPreview: 0, maneuverSpent: 0, maneuverPreview: 0 }, "пустой выбор не должен ломать инспектор активного юнита");
assert.deepEqual(maneuverResourcePreview({ kind: "capital", heading: 0, speedSpent: 0, maneuverSpent: 0, evasiveManeuver: false }, { heading: 2, route: { heading: 0, movementCost: 0, turnsSpent: 0, steps: [] } }, (from, to) => to - from), { speedSpent: 0, speedPreview: 0, maneuverSpent: 0, maneuverPreview: 2 }, "стационарный доворот должен показывать расход всех очков манёвренности");
assert.deepEqual(maneuverResourcePreview({ kind: "squadron", speedSpent: 0, maneuverSpent: 0, evasiveManeuver: false }, { route: { movementCost: 3, turnsSpent: 0, steps: [{}, {}, {}] } }, () => 0), { speedSpent: 0, speedPreview: 3, maneuverSpent: 0, maneuverPreview: 0 }, "эскадрилья должна получать предпросмотр расхода скорости без манёвренности");
const state = createBattleState();
const swift = state.units.find(candidate => candidate.id === "swift");
const wasps = state.units.find(candidate => candidate.id === "wasps");
assert.equal(swift.loadoutId, "swift", "сценарий должен сохранять ссылку на комплектацию");
assert.equal(swift.reactor.currentEnergy, 4, "начальная энергия должна материализоваться из instance-данных сценария");
assert.equal(wasps.callsign, "Осы", "позывной должен оставаться instance-данными сценария");
for (const candidate of state.units) {
  const { col } = axialToOffset(candidate.position.q, candidate.position.r);
  assert.equal(col, candidate.sideId === "azure" ? -5 : 5, "корабли должны начинать на втором от края ряду гексов");
}
state.activeUnitId = "swift";
const unit = activeUnit(state);
state.lifecycle = "ActionChoice";
assert.ok(beginActionPlanning(state, { type: "system-action", systemActionId: "evasive-maneuver", reason: "player-choice" }), "манёвр уклонения должен переходить в предпросмотр");
assert.equal(unit.evasiveManeuver, false, "предпросмотр не должен применять эффект");
assert.equal(state.lifecycle, "ActionPlanning", "выбор действия должен открыть планирование");
assert.ok(confirmSystemAction(state, { systemActionId: "evasive-maneuver" }), "манёвр уклонения должен подтверждаться");
assert.equal(unit.evasiveManeuver, true, "подтверждение должно применить эффект");
assert.equal(state.lifecycle, "ActionChoice", "разрешение должно вернуть общий выбор");
console.log("regression checks passed");