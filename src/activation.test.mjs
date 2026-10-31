import assert from "node:assert/strict";
import {
  activeUnit,
  beginActivation,
  createBattleState,
  createScenario,
  deployUnit,
  destroyUnit,
  endActivation,
  executeManeuverElement,
  planManeuver,
  planRoutes,
  useEvasiveManeuver,
  waitActiveUnit
} from "./domain.js";
import { buildManeuverOptions } from "./ui-rules.js";

{
  const scenario = createScenario();
  for (const unit of scenario.units) {
    assert.equal(unit.heading, unit.sideId === "azure" ? 0 : 3);
    assert.ok(Number.isInteger(unit.heading) && unit.heading >= 0 && unit.heading < 6);
  }
}

{
  const state = createBattleState();
  const atlas = state.units.find(unit => unit.id === "atlas");
  const wasps = state.units.find(unit => unit.id === "wasps");
  const bastion = state.units.find(unit => unit.id === "bastion");
  const mantis = state.units.find(unit => unit.id === "mantis");
  assert.deepEqual(
    { maneuver: wasps.maneuver, maneuverSpent: wasps.maneuverSpent, maneuverRemaining: wasps.maneuverRemaining, heading: wasps.heading },
    { maneuver: 5, maneuverSpent: 0, maneuverRemaining: 5, heading: 0 }
  );
  assert.deepEqual(
    { maneuver: mantis.maneuver, maneuverSpent: mantis.maneuverSpent, maneuverRemaining: mantis.maneuverRemaining, heading: mantis.heading },
    { maneuver: 4, maneuverSpent: 0, maneuverRemaining: 4, heading: 3 }
  );
  assert.equal(deployUnit(state, atlas.id, { ...atlas.position }, 4), true);
  assert.equal(atlas.heading, 0);
  assert.equal(deployUnit(state, wasps.id, { ...wasps.position }, 4), true);
  assert.equal(wasps.heading, 0);
  state.lifecycle = "DeploymentRight";
  assert.equal(deployUnit(state, bastion.id, { ...bastion.position }, 1), true);
  assert.equal(bastion.heading, 3);
  assert.equal(deployUnit(state, mantis.id, { ...mantis.position }, 1), true);
  assert.equal(mantis.heading, 3);
}

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
  const route = planRoutes(state, atlas, "safe").get(`${atlas.position.q + 2},${atlas.position.r}:${(atlas.heading + 1) % 6}`);
  const option = buildManeuverOptions(atlas, route)[0];
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
  atlas.currentSpeed = 0;
  atlas.speedRemaining = 0;
  const routes = planRoutes(state, atlas, "risky");
  assert.equal(routes.has(`${atlas.position.q},${atlas.position.r}:${atlas.heading}`), false);
  const targetHeading = (atlas.heading + 2) % 6;
  const route = routes.get(`${atlas.position.q},${atlas.position.r}:${targetHeading}`);
  const [option] = buildManeuverOptions(atlas, route);
  const before = structuredClone({ heading: atlas.heading, maneuverSpent: atlas.maneuverSpent, stage: state.stage });
  const plan = planManeuver(state, option);
  assert.deepEqual({ heading: atlas.heading, maneuverSpent: atlas.maneuverSpent, stage: state.stage }, before);
  assert.deepEqual(plan.elements.map(element => element.type), ["turn", "turn"]);
  assert.ok(plan.elements.every(Object.isFrozen));
  for (let index = 0; index < plan.elements.length; index++) executeManeuverElement(state, plan, index);
  assert.equal(atlas.heading, targetHeading);
  assert.equal(atlas.speedSpent, 0);
  assert.equal(atlas.maneuverSpent, 2);
  assert.equal(state.stage, "attack");
}

{
  const { state, atlas } = activationState();
  beginActivation(state);
  atlas.currentSpeed = 0;
  atlas.speedRemaining = 0;
  const route = { position: { ...atlas.position }, heading: atlas.heading, movementCost: 0, turnsSpent: 0, steps: [], actions: [], consequences: [], previewConsequences: [], path: [{ ...atlas.position, heading: atlas.heading }] };
  const [emptyOption] = buildManeuverOptions(atlas, route);
  assert.equal(planManeuver(state, emptyOption), null);
  assert.equal(state.stage, "system");
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
