import assert from "node:assert/strict";
import { activeUnit, axialToOffset, createBattleState, useEvasiveManeuver } from "./domain.js";
import { headingAngle, shouldAutoEndActivation, shouldDrawRoute, shouldHighlightOccupiedHex, shouldOutlineUnit } from "./ui-rules.js";

assert.equal(headingAngle(0), Math.PI / 2, "курс 0 должен направлять нарисованный вверх нос вправо");
assert.equal(headingAngle(3), -Math.PI / 2, "курс 3 должен направлять нос влево");
assert.equal(shouldAutoEndActivation({ attackImplemented: false }), true, "без реализованной атаки манёвр должен завершать активацию");
assert.equal(shouldDrawRoute({ targetId: "raptor" }), false, "выбранная цель атаки не должна отрисовываться как маршрут");
assert.equal(shouldDrawRoute({ route: { path: [] } }), true, "выбранный маршрут должен отрисовываться");
assert.equal(shouldHighlightOccupiedHex("DeploymentLeft"), false, "корабли не должны подсвечивать гекс во время расстановки левой стороны");
assert.equal(shouldHighlightOccupiedHex("DeploymentRight"), false, "корабли не должны подсвечивать гекс во время расстановки правой стороны");
assert.equal(shouldHighlightOccupiedHex("WaitDecision"), true, "корабли должны подсвечивать гекс после начала игрового цикла");
assert.equal(shouldOutlineUnit("atlas", "atlas", undefined, "DeploymentLeft"), false, "активный корабль не должен обводиться до окончания расстановки");
assert.equal(shouldOutlineUnit("atlas", "atlas", "atlas", "DeploymentLeft"), true, "выбранный игроком корабль должен обводиться при расстановке");
assert.equal(shouldOutlineUnit("atlas", "atlas", undefined, "WaitDecision"), true, "активный корабль должен обводиться после начала игрового цикла");
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
const unit = activeUnit(state);
assert.equal(useEvasiveManeuver(state), true, "манёвр уклонения должен включаться до подтверждения");
assert.equal(unit.evasiveManeuver, true, "включённое действие должно учитываться в предпросмотре");
assert.equal(state.stage, "system", "переключение действия не должно менять этап");
assert.equal(useEvasiveManeuver(state), true, "манёвр уклонения должен выключаться повторным нажатием");
assert.equal(unit.evasiveManeuver, false, "повторное нажатие должно отменять действие");
console.log("regression checks passed");