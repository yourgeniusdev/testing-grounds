import assert from "node:assert/strict";
import test from "node:test";
import { attackPreview, isPositionInFiringArc } from "./battle.js";
import { createBattleState, hexDistance, key, unitById } from "./domain.js";

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
  "forward-fore": ["0,1", "1,0", "1,-1", "0,2", "1,1", "2,0", "2,-1", "2,-2", "0,3", "1,2", "2,1", "3,0", "3,-1", "3,-2", "3,-3"]
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

test("turret and squadron weapon cover every direction", () => {
  for (const mount of ["turret", "squadronWeapon"]) {
    for (const position of positions) assert.equal(isPositionInFiringArc(origin, 4, position, mount), true, `${mount} ${key(position.q, position.r)}`);
  }
});

test("attack preview carries forward hardpoint orientation into runtime geometry", () => {
  const state = createBattleState();
  const attacker = unitById(state, "swift");
  const target = unitById(state, "raptor");
  state.activeUnitId = attacker.id;
  state.stage = "attack";
  attacker.position = { q: 0, r: 0 };
  attacker.heading = 0;
  attacker.weapons = [{ ...attacker.weapons[0], mount: "forward", orientation: "aft", maxRange: 3 }];
  target.position = { q: -2, r: 0 };
  assert.equal(attackPreview(state, target.id, "primary").included.length, 1);
  target.position = { q: 2, r: 0 };
  assert.equal(attackPreview(state, target.id, "primary").included.length, 0);
});
