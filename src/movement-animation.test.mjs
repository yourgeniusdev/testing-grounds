import assert from "node:assert/strict";
import test from "node:test";
import {
  movementAnimationContinuation,
  planMovementAnimationSegment,
  reactionAnimationContinuation,
  sampleMovementAnimationSegment
} from "./movement-animation.js";

function move(index, status = "executed", extras = {}) {
  return {
    status,
    transition: {
      elementIndex: index,
      type: "move",
      before: { position: { q: index, r: 0 }, heading: 0 },
      after: { position: { q: index + 1, r: 0 }, heading: 0 }
    },
    ...extras
  };
}

const straightPlan = {
  elements: [
    { type: "move", from: { q: 0, r: 0 }, to: { q: 1, r: 0 }, heading: 0 },
    { type: "move", from: { q: 1, r: 0 }, to: { q: 2, r: 0 }, heading: 0 },
    { type: "move", from: { q: 2, r: 0 }, to: { q: 3, r: 0 }, heading: 0 }
  ]
};

test("straight movement steps form one continuous linear animation segment", () => {
  const executed = [];
  const segment = planMovementAnimationSegment(straightPlan, 0, index => {
    executed.push(index);
    return move(index, index === 2 ? "completed" : "executed");
  });

  assert.deepEqual(executed, [0, 1, 2]);
  assert.equal(segment.elementCount, 3);
  assert.deepEqual(sampleMovementAnimationSegment(segment, 1 / 3).position, { q: 1, r: 0 });
  assert.deepEqual(sampleMovementAnimationSegment(segment, 2 / 3).position, { q: 2, r: 0 });
  assert.deepEqual(sampleMovementAnimationSegment(segment, 1).position, { q: 3, r: 0 });
});

test("turn, hazard, reaction, interception, stop, and destruction preserve animation boundaries", async t => {
  const turnPlan = { elements: [straightPlan.elements[0], { type: "turn" }, straightPlan.elements[1]] };
  assert.equal(planMovementAnimationSegment(turnPlan, 0, index => move(index)).elementCount, 1);

  for (const [name, result] of [
    ["hazard", move(0, "executed", { hazardOutcomes: [{ hit: false }] })],
    ["reaction", move(0, "reaction-pending", { reactionPlan: { id: "reaction" } })],
    ["interception", move(0, "stopped", { reason: "interception" })],
    ["stop", move(0, "stopped", { reason: "continuation-forbidden" })],
    ["destruction", move(0, "destroyed", { reason: "hazard" })]
  ]) await t.test(name, () => {
    let calls = 0;
    const segment = planMovementAnimationSegment(straightPlan, 0, () => {
      calls++;
      return result;
    });
    assert.equal(calls, 1);
    assert.equal(segment.elementCount, 1);
  });
});

test("reaction hit and miss resume the stable chain while cancellation finishes before later movement", () => {
  assert.equal(movementAnimationContinuation({ status: "reaction-pending" }), "reaction");
  assert.equal(reactionAnimationContinuation({ status: "reaction-pending" }), "reaction");
  assert.equal(reactionAnimationContinuation({ status: "executed", reactionOutcomes: [{ outcome: "hit" }] }), "next");
  assert.equal(reactionAnimationContinuation({ status: "executed", reactionOutcomes: [{ outcome: "miss" }] }), "next");
  assert.equal(reactionAnimationContinuation({ status: "destroyed", reason: "reaction" }), "finish");
  assert.equal(movementAnimationContinuation({ status: "stopped", reason: "interception" }), "finish");
});
