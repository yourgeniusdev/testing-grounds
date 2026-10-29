import assert from "node:assert/strict";
import {
  activeUnit,
  applyMovement,
  applyStationaryRotation,
  beginActivation,
  createBattleState,
  endActivation,
  planRoutes,
  skipMovement,
  useEvasiveManeuver,
  waitActiveUnit
} from "./domain.js";

function activationState() {
  const state = createBattleState();
  const atlas = state.units.find(unit => unit.id === "atlas");
  const swift = state.units.find(unit => unit.id === "swift");
  state.lifecycle = "WaitDecision";
  state.stage = "system";
  state.units = [atlas, swift];
  state.initiativeOrder = [atlas.id, swift.id];
  state.activeUnitId = atlas.id;
  atlas.reactor.currentEnergy = 1;
  swift.reactor.currentEnergy = 1;
  return { state, atlas, swift };
}

{
  const { state, atlas, swift } = activationState();
  beginActivation(state);
  assert.equal(atlas.reactor.currentEnergy, 3);
  assert.equal(atlas.activationStartedThisRound, true);
  assert.equal(atlas.canWait, true);
  assert.deepEqual(
    { speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining, maneuverSpent: atlas.maneuverSpent, maneuverRemaining: atlas.maneuverRemaining },
    { speedSpent: 0, speedRemaining: atlas.currentSpeed, maneuverSpent: 0, maneuverRemaining: atlas.maneuver }
  );

  assert.equal(waitActiveUnit(state), true);
  assert.equal(activeUnit(state), swift);
  assert.equal(swift.reactor.currentEnergy, 3);
  assert.equal(swift.activationStartedThisRound, true);

  assert.equal(waitActiveUnit(state), true);
  assert.equal(activeUnit(state), atlas);
  assert.equal(atlas.reactor.currentEnergy, 3);
  assert.equal(atlas.canWait, false);
  assert.equal(waitActiveUnit(state), false);
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  atlas.speedSpent = 2;
  atlas.speedRemaining = 1;
  atlas.maneuverSpent = 1;
  atlas.maneuverRemaining = 1;
  beginActivation(state);
  assert.deepEqual(
    { speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining, maneuverSpent: atlas.maneuverSpent, maneuverRemaining: atlas.maneuverRemaining },
    { speedSpent: 2, speedRemaining: 1, maneuverSpent: 1, maneuverRemaining: 1 }
  );
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  assert.equal(useEvasiveManeuver(state), true);
  assert.equal(atlas.canWait, false);
  assert.equal(atlas.maneuverSpent, 1);
  assert.equal(atlas.maneuverRemaining, atlas.maneuver - 1);
  assert.equal(useEvasiveManeuver(state), true);
  assert.equal(atlas.evasiveManeuver, false);
  assert.equal(atlas.canWait, false);
  assert.equal(atlas.maneuverSpent, 0);
  assert.equal(waitActiveUnit(state), false);
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  planRoutes(state, atlas, "safe");
  assert.equal(atlas.canWait, true);
  assert.equal(atlas.speedSpent, 0);
  assert.equal(atlas.maneuverSpent, 0);
  applyMovement(state, {
    position: { q: atlas.position.q + 2, r: atlas.position.r },
    heading: atlas.heading,
    movementCost: 2,
    turnsSpent: 1,
    steps: [{}, {}],
    interception: null
  }, (atlas.heading + 1) % 6);
  assert.equal(atlas.canWait, false);
  assert.deepEqual(
    { speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining, maneuverSpent: atlas.maneuverSpent, maneuverRemaining: atlas.maneuverRemaining },
    { speedSpent: 2, speedRemaining: atlas.currentSpeed - 2, maneuverSpent: 2, maneuverRemaining: atlas.maneuver - 2 }
  );
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  assert.equal(applyStationaryRotation(state, atlas.heading), true);
  assert.equal(atlas.canWait, false);
  assert.equal(atlas.maneuverSpent, 0);
  assert.equal(atlas.maneuverRemaining, atlas.maneuver);
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  assert.equal(applyStationaryRotation(state, (atlas.heading + 1) % 6), true);
  assert.equal(atlas.canWait, false);
  assert.equal(atlas.speedSpent, 0);
  assert.equal(atlas.speedRemaining, atlas.currentSpeed);
  assert.equal(atlas.maneuverSpent, 1);
  assert.equal(atlas.maneuverRemaining, atlas.maneuver - 1);
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  skipMovement(state);
  assert.equal(atlas.canWait, false);
  assert.equal(atlas.speedSpent, 0);
  assert.equal(atlas.speedRemaining, atlas.currentSpeed);
  assert.equal(atlas.maneuverSpent, 0);
  assert.equal(atlas.maneuverRemaining, atlas.maneuver);
}

{
  const { state, atlas, swift } = activationState();
  beginActivation(state);
  swift.speedSpent = 2;
  swift.speedRemaining = 1;
  swift.hasActivated = true;
  const result = endActivation(state);
  assert.equal(result.newRound, true);
  assert.equal(atlas.activationStartedThisRound, false);
  assert.equal(activeUnit(state), swift);
  assert.equal(swift.activationStartedThisRound, true);
  assert.equal(swift.speedSpent, 0);
  assert.equal(swift.speedRemaining, swift.currentSpeed);
}

console.log("activation checks passed");
