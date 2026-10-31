import assert from "node:assert/strict";
import {
  activeUnit,
  applyStationaryRotation,
  beginActivation,
  createBattleState,
  destroyUnit,
  endActivation,
  executeManeuverElement,
  planManeuver,
  planRoutes,
  skipMovement,
  signedTurn,
  useEvasiveManeuver,
  waitActiveUnit
} from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

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
  const route = planRoutes(state, atlas, "safe").get(`${atlas.position.q + 2},${atlas.position.r}`);
  const option = buildManeuverOptions(atlas, route, new Set([(atlas.heading + 1) % 6]), signedTurn)[0];
  const plan = planManeuver(state, option);
  for (let index = 0; index < plan.elements.length; index++) executeManeuverElement(state, plan, index);
  assert.equal(atlas.canWait, false);
  assert.deepEqual(
    { speedSpent: atlas.speedSpent, speedRemaining: atlas.speedRemaining, maneuverSpent: atlas.maneuverSpent, maneuverRemaining: atlas.maneuverRemaining },
    { speedSpent: 2, speedRemaining: atlas.currentSpeed - 2, maneuverSpent: 1, maneuverRemaining: atlas.maneuver - 1 }
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

{
  const state = createBattleState();
  const active = state.units.find(unit => unit.id === "atlas");
  const activatedAlly = state.units.find(unit => unit.id === "swift");
  const enemy = state.units.find(unit => unit.id === "bastion");
  state.units = [active, activatedAlly, enemy];
  state.initiativeOrder = [active.id, activatedAlly.id, enemy.id];
  state.activeUnitId = active.id;
  state.roundNumber = 3;
  state.lifecycle = "SystemActions";
  active.hasActivated = false;
  active.activationStartedThisRound = true;
  activatedAlly.hasActivated = true;
  activatedAlly.activationStartedThisRound = true;
  activatedAlly.hasWaited = true;
  activatedAlly.speedSpent = 2;
  enemy.hasActivated = true;
  enemy.activationStartedThisRound = true;

  destroyUnit(state, active);

  assert.equal(state.roundNumber, 4);
  assert.equal(state.activeUnitId, activatedAlly.id);
  assert.equal(activeUnit(state), activatedAlly);
  for (const survivor of state.units) {
    assert.equal(survivor.hasActivated, false);
    assert.equal(survivor.hasWaited, false);
  }
  assert.equal(activatedAlly.activationStartedThisRound, true);
  assert.equal(enemy.activationStartedThisRound, false);
  assert.equal(activatedAlly.speedSpent, 0);
}

console.log("activation checks passed");
