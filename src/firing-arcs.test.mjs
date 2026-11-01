import assert from "node:assert/strict";
import test from "node:test";
import { isPositionInFiringArc, previewWeaponAttack, weaponAttackArc } from "./battle.js";
import { DIRECTIONS, createBattleState, hexDistance, key, unitById } from "./domain.js";

const origin = { q: 0, r: 0 };
const positions = [];
for (let q = -7; q <= 7; q++) for (let r = -7; r <= 7; r++) {
  const position = { q, r };
  if (hexDistance(origin, position) >= 1 && hexDistance(origin, position) <= 7) positions.push(position);
}

const canonical = {
  "battery-left": ["1,-1", "0,-1", "2,-2", "1,-2", "0,-2", "3,-3", "2,-3", "1,-3", "0,-3", "4,-4", "3,-4", "2,-4", "1,-4", "0,-4", "5,-5", "4,-5", "3,-5", "2,-5", "1,-5", "0,-5"],
  "battery-right": ["-1,1", "0,1", "-2,2", "-1,2", "0,2", "-3,3", "-2,3", "-1,3", "0,3", "-4,4", "-3,4", "-2,4", "-1,4", "0,4", "-5,5", "-4,5", "-3,5", "-2,5", "-1,5", "0,5"],
  line: ["1,0", "2,0", "3,0", "4,0", "5,0", "6,0", "7,0"],
  "forward-fore": ["1,0", "2,0", "2,-1", "1,1", "3,0", "3,-1", "3,-2", "2,1", "1,2"]
};

function rotate(position, times) {
  let { q, r } = position;
  for (let turn = 0; turn < times; turn++) [q, r] = [q + r, -q];
  return { q, r };
}

function rotateKeys(keys, times) {
  return new Set(keys.map(value => {
    const [q, r] = value.split(",").map(Number);
    const rotated = rotate({ q, r }, times);
    return key(rotated.q, rotated.r);
  }));
}

for (let heading = 0; heading < 6; heading++) {
  for (const mount of ["battery-left", "battery-right", "line"]) {
    test(`${mount} has exact boundary cells at heading ${heading}`, () => {
      const expected = rotateKeys(canonical[mount], heading);
      const maxRange = mount === "line" ? 7 : 5;
      const actual = new Set(positions.filter(position => hexDistance(origin, position) <= maxRange && isPositionInFiringArc(origin, heading, position, mount)).map(position => key(position.q, position.r)));
      assert.deepEqual(actual, expected);
    });
  }

  test(`forward fore and aft are symmetric at heading ${heading}`, () => {
    const fore = new Set(positions.filter(position => hexDistance(origin, position) <= 3 && isPositionInFiringArc(origin, heading, position, "forward", "fore")).map(position => key(position.q, position.r)));
    const aft = new Set(positions.filter(position => hexDistance(origin, position) <= 3 && isPositionInFiringArc(origin, heading, position, "forward", "aft")).map(position => key(position.q, position.r)));
    assert.deepEqual(fore, rotateKeys(canonical["forward-fore"], heading));
    assert.deepEqual(aft, rotateKeys(canonical["forward-fore"], (heading + 3) % 6));
  });
}

test("spinal arc is constrained to exact longitudinal line", () => {
  assert.equal(isPositionInFiringArc(origin, 0, { q: 2, r: 0 }, "line"), true);
  assert.equal(isPositionInFiringArc(origin, 0, { q: 2, r: -1 }, "line"), false);
  assert.equal(isPositionInFiringArc(origin, 0, { q: 1, r: 1 }, "line"), false);
});

test("turret geometry covers every direction", () => {
  for (const position of positions) assert.equal(isPositionInFiringArc(origin, 4, position, "turret"), true, key(position.q, position.r));
});

test("real Atlas forward hardpoint carries orientation into runtime geometry", () => {
  const state = createBattleState();
  const attacker = unitById(state, "atlas");
  const target = unitById(state, "raptor");
  const forward = attacker.weapons.find(weapon => weapon.mount === "forward");
  state.activeUnitId = attacker.id;
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  target.position = { q: 2, r: 0 };
  assert.equal(forward.orientation, "fore");
  assert.equal(previewWeaponAttack(state, attacker.id, forward.id, target.id).canConfirm, true);
  target.position = { q: -2, r: 0 };
  assert.equal(previewWeaponAttack(state, attacker.id, forward.id, target.id).canConfirm, false);
});

for (const squadronId of ["wasps", "mantis"]) {
  test(`${squadronId} slots accept forward and reject aft targets for all headings`, () => {
    const state = createBattleState();
    const attacker = unitById(state, squadronId);
    const capitalTarget = state.units.find(unit => unit.sideId !== attacker.sideId && unit.kind === "capital");
    const squadronTarget = state.units.find(unit => unit.sideId !== attacker.sideId && unit.kind === "squadron");
    state.activeUnitId = attacker.id;
    attacker.position = { q: 0, r: 0 };
    for (const weapon of attacker.weapons) {
      const target = weapon.targetKinds.length === 1 ? capitalTarget : squadronTarget;
      for (let heading = 0; heading < DIRECTIONS.length; heading++) {
        const [dq, dr] = DIRECTIONS[heading];
        attacker.heading = heading;
        target.position = { q: dq, r: dr };
        assert.equal(previewWeaponAttack(state, attacker.id, weapon.id, target.id).canConfirm, true, `${weapon.id} heading ${heading} fore`);
        target.position = { q: -dq, r: -dr };
        const preview = previewWeaponAttack(state, attacker.id, weapon.id, target.id);
        assert.equal(preview.canConfirm, false, `${weapon.id} heading ${heading} aft`);
        assert.deepEqual(preview.reasons, ["Вне сектора"]);
      }
    }
  });
}

test("Kiro assault craft beam turret targets every direction and both unit kinds", () => {
  const state = createBattleState();
  const attacker = unitById(state, "kiro");
  const capitalTarget = unitById(state, "atlas");
  const squadronTarget = unitById(state, "wasps");
  const weapon = attacker.weapons[0];
  state.activeUnitId = attacker.id;
  attacker.position = { q: 0, r: 0 };
  assert.equal(weapon.mount, "turret");
  assert.deepEqual(weapon.targetKinds, ["capital", "squadron"]);
  for (const target of [capitalTarget, squadronTarget]) {
    for (const [dq, dr] of DIRECTIONS) {
      target.position = { q: dq * 2, r: dr * 2 };
      assert.equal(previewWeaponAttack(state, attacker.id, weapon.id, target.id).canConfirm, true);
    }
  }
});

test("selected squadron slot UI arc uses the same forward geometry as target validation", () => {
  const state = createBattleState();
  const attacker = unitById(state, "mantis");
  const target = unitById(state, "atlas");
  const weapon = attacker.weapons.find(candidate => candidate.id === "mantis-torpedo");
  state.activeUnitId = attacker.id;
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 2;
  target.position = { q: 0, r: -2 };
  const arc = weaponAttackArc(state, attacker.id, weapon.id);
  assert.equal(arc.has(key(target.position.q, target.position.r)), true);
  assert.equal(previewWeaponAttack(state, attacker.id, weapon.id, target.id).canConfirm, true);
  target.position = { q: 0, r: 2 };
  assert.equal(arc.has(key(target.position.q, target.position.r)), false);
  assert.equal(previewWeaponAttack(state, attacker.id, weapon.id, target.id).canConfirm, false);
});

test("squadron slot shots scale with surviving stack independently of forward geometry", () => {
  const state = createBattleState();
  const attacker = unitById(state, "mantis");
  const target = unitById(state, "atlas");
  state.activeUnitId = attacker.id;
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  target.position = { q: 1, r: 0 };
  for (const weapon of attacker.weapons) {
    for (const stack of [3, 2, 1]) {
      attacker.stack = stack;
      const preview = previewWeaponAttack(state, attacker.id, weapon.id, target.id);
      assert.equal(preview.shots, weapon.shots * stack, `${weapon.id} stack ${stack}`);
    }
  }
});

test("Mantis torpedo retains its target restriction and combat characteristics", () => {
  const state = createBattleState();
  const attacker = unitById(state, "mantis");
  const capitalTarget = unitById(state, "atlas");
  const squadronTarget = unitById(state, "wasps");
  const weapon = attacker.weapons.find(candidate => candidate.id === "mantis-torpedo");
  state.activeUnitId = attacker.id;
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  capitalTarget.position = { q: 1, r: 0 };
  squadronTarget.position = { q: 1, r: 0 };
  assert.deepEqual({ targetKinds: weapon.targetKinds, effectiveRange: weapon.effectiveRange, maxRange: weapon.maxRange, cooldownRounds: weapon.cooldownRounds, damage: weapon.damage }, { targetKinds: ["capital"], effectiveRange: 2, maxRange: 3, cooldownRounds: 1, damage: 8 });
  assert.equal(previewWeaponAttack(state, attacker.id, weapon.id, capitalTarget.id).canConfirm, true);
  const squadronPreview = previewWeaponAttack(state, attacker.id, weapon.id, squadronTarget.id);
  assert.equal(squadronPreview.canConfirm, false);
  assert.deepEqual(squadronPreview.reasons, ["Недопустимый тип цели"]);
});
