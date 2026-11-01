const HARDPOINT_MOUNTS = ["turret", "battery-left", "battery-right", "line", "forward", "squadronWeapon"];
const HARDPOINT_TYPES = ["turret", "battery", "spinal", "forward", "squadronWeapon"];
const FIRING_ARCS = ["forward"];
const MOUNTS_BY_TYPE = {
  turret: ["turret"],
  battery: ["battery-left", "battery-right"],
  spinal: ["line"],
  forward: ["forward"],
  squadronWeapon: ["squadronWeapon"]
};
const WEAPON_CLASSES = ["kinetic", "energy", "explosive"];
const DELIVERIES = ["beam", "projectile", "missile", "torpedo"];
const TARGET_KINDS = ["capital", "squadron"];
const PROJECTILES = ["beam", "tracer", "missile", "torpedo"];
const TRAILS = ["none", "short", "smoke"];
const IMPACTS = ["none", "spark", "smallExplosion", "largeExplosion"];
const SYSTEM_ACTION_EFFECTS = ["evasiveManeuver", "engineBoost"];

const fail = (path, message) => {
  throw new Error(`Invalid config at ${path}: ${message}`);
};

const validateObject = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value;
};

const validateArray = (value, path) => {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
};

const validateString = (value, path) => {
  if (typeof value !== "string" || !value.trim()) fail(path, "expected a nonempty string");
};

const validateNumber = (value, path) => {
  if (!Number.isFinite(value)) fail(path, "expected a finite number");
};

const validateBoolean = (value, path) => {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
};

const validateNumbers = (value, path, fields) => {
  for (const field of fields) validateNumber(value[field], `${path}.${field}`);
};

const validateDictionary = (name, dictionary) => {
  validateObject(dictionary, name);
  for (const [key, value] of Object.entries(dictionary)) {
    validateObject(value, `${name}.${key}`);
    if (value.id !== key) fail(`${name}.${key}.id`, `expected "${key}", received "${value.id}"`);
  }
};

const requiredReference = (dictionary, id, path, targetName) => {
  const value = dictionary[id];
  if (!value) fail(path, `unknown ${targetName} ID "${id}"`);
  return value;
};

const validateHardpoints = (owner, path) => {
  const hardpoints = validateArray(owner.hardpoints, `${path}.hardpoints`);
  const ids = new Set();
  for (const [index, hardpoint] of hardpoints.entries()) {
    const hardpointPath = `${path}.hardpoints[${index}]`;
    validateObject(hardpoint, hardpointPath);
    for (const field of ["id", "mount", "type"]) validateString(hardpoint[field], `${hardpointPath}.${field}`);
    if ("role" in hardpoint) fail(`${hardpointPath}.role`, "weapon roles are not supported");
    if (ids.has(hardpoint.id)) fail(`${hardpointPath}.id`, `duplicate hardpoint ID "${hardpoint.id}"`);
    ids.add(hardpoint.id);
    if (!HARDPOINT_MOUNTS.includes(hardpoint.mount)) fail(`${hardpointPath}.mount`, `unknown hardpoint mount "${hardpoint.mount}"`);
    if (!HARDPOINT_TYPES.includes(hardpoint.type)) fail(`${hardpointPath}.type`, `unknown hardpoint type "${hardpoint.type}"`);
    if (!MOUNTS_BY_TYPE[hardpoint.type].includes(hardpoint.mount)) fail(`${hardpointPath}.mount`, `mount "${hardpoint.mount}" is incompatible with ${hardpoint.type} hardpoint type`);
    if (hardpoint.type === "squadronWeapon" && owner.kind !== "squadron") fail(`${hardpointPath}.type`, "squadronWeapon hardpoints require a squadron owner");
    if (hardpoint.type === "squadronWeapon") {
      validateString(hardpoint.firingArc, `${hardpointPath}.firingArc`);
      if (!FIRING_ARCS.includes(hardpoint.firingArc)) fail(`${hardpointPath}.firingArc`, `unknown firing arc "${hardpoint.firingArc}"`);
    } else if ("firingArc" in hardpoint) fail(`${hardpointPath}.firingArc`, "firingArc is only valid on squadronWeapon hardpoints");
    if (hardpoint.type === "forward" && !["fore", "aft"].includes(hardpoint.orientation)) fail(`${hardpointPath}.orientation`, 'expected "fore" or "aft"');
    if (hardpoint.type !== "forward" && "orientation" in hardpoint) fail(`${hardpointPath}.orientation`, "orientation is only valid on forward hardpoints");
  }
};

const validateSystemSlots = (hull, path) => {
  const slots = validateArray(hull.systemSlots, `${path}.systemSlots`);
  const ids = new Set();
  for (const [index, slot] of slots.entries()) {
    const slotPath = `${path}.systemSlots[${index}]`;
    validateObject(slot, slotPath);
    validateString(slot.id, `${slotPath}.id`);
    validateString(slot.type, `${slotPath}.type`);
    validateBoolean(slot.required, `${slotPath}.required`);
    if (ids.has(slot.id)) fail(`${slotPath}.id`, `duplicate system slot ID "${slot.id}"`);
    ids.add(slot.id);
  }
  for (const requiredType of ["engine", "reactor"]) {
    if (!slots.some(slot => slot.required && slot.type === requiredType)) fail(`${path}.systemSlots`, `missing required ${requiredType} slot`);
  }
};

const validateInstallations = (assignments, path) => {
  validateObject(assignments, `${path}.weapons`);
  const ids = new Set();
  for (const [hardpointId, installation] of Object.entries(assignments)) {
    const installationPath = `${path}.weapons.${hardpointId}`;
    validateObject(installation, installationPath);
    validateString(installation.id, `${installationPath}.id`);
    validateString(installation.weaponId, `${installationPath}.weaponId`);
    if ("role" in installation) fail(`${installationPath}.role`, "weapon roles are not supported");
    if (ids.has(installation.id)) fail(`${installationPath}.id`, `duplicate installation ID "${installation.id}"`);
    ids.add(installation.id);
  }
};

const validateWeapons = (owner, assignments, weapons, path) => {
  validateInstallations(assignments, path);
  const hardpoints = Object.fromEntries(owner.hardpoints.map(hardpoint => [hardpoint.id, hardpoint]));
  for (const [hardpointId, installation] of Object.entries(assignments)) {
    const installationPath = `${path}.weapons.${hardpointId}`;
    const hardpoint = hardpoints[hardpointId];
    if (!hardpoint) fail(installationPath, `unknown hardpoint ID "${hardpointId}"`);
    const catalogWeapon = requiredReference(weapons, installation.weaponId, `${installationPath}.weaponId`, "weapon");
    if (!catalogWeapon.compatibleHardpointTypes.includes(hardpoint.type)) fail(`${installationPath}.weaponId`, `weapon "${catalogWeapon.id}" is incompatible with ${hardpoint.type} hardpoint "${hardpointId}"`);
  }
};

const validateWeaponVisual = (entry, path) => {
  const visual = validateObject(entry.visual, `${path}.visual`);
  validateString(visual.projectile, `${path}.visual.projectile`);
  if (!PROJECTILES.includes(visual.projectile)) fail(`${path}.visual.projectile`, `unknown projectile "${visual.projectile}"`);
  validateString(visual.color, `${path}.visual.color`);
  validateString(visual.trail, `${path}.visual.trail`);
  if (!TRAILS.includes(visual.trail)) fail(`${path}.visual.trail`, `unknown trail "${visual.trail}"`);
  validateString(visual.impact, `${path}.visual.impact`);
  if (!IMPACTS.includes(visual.impact)) fail(`${path}.visual.impact`, `unknown impact "${visual.impact}"`);
  validateNumbers(visual, `${path}.visual`, ["size", "speedHexesPerSecond", "launchIntervalMs", "impactRadius"]);
  if (visual.size <= 0 || visual.size > 1) fail(`${path}.visual.size`, "expected a value greater than 0 and at most 1 hex");
  if (visual.speedHexesPerSecond <= 0 || visual.speedHexesPerSecond > 100) fail(`${path}.visual.speedHexesPerSecond`, "expected a value greater than 0 and at most 100");
  if (visual.launchIntervalMs < 0 || visual.launchIntervalMs > 5000) fail(`${path}.visual.launchIntervalMs`, "expected a value from 0 to 5000");
  if (visual.impactRadius < 0 || visual.impactRadius >= 1) fail(`${path}.visual.impactRadius`, "expected a value from 0 to less than 1 hex");
  if (visual.projectile !== entry.delivery && !(entry.delivery === "projectile" && visual.projectile === "tracer")) fail(`${path}.visual.projectile`, `projectile "${visual.projectile}" does not represent ${entry.delivery} delivery`);
};

const validateCatalogWeapon = (entry, path, weapons) => {
  validateString(entry.name, `${path}.name`);
  const compatibleTypes = validateArray(entry.compatibleHardpointTypes, `${path}.compatibleHardpointTypes`);
  if (!compatibleTypes.length) fail(`${path}.compatibleHardpointTypes`, "expected a nonempty array");
  const seenTypes = new Set();
  compatibleTypes.forEach((type, index) => {
    validateString(type, `${path}.compatibleHardpointTypes[${index}]`);
    if (!HARDPOINT_TYPES.includes(type)) fail(`${path}.compatibleHardpointTypes[${index}]`, `unknown hardpoint type "${type}"`);
    if (seenTypes.has(type)) fail(`${path}.compatibleHardpointTypes[${index}]`, `duplicate hardpoint type "${type}"`);
    seenTypes.add(type);
  });
  validateString(entry.weaponClass, `${path}.weaponClass`);
  if (!WEAPON_CLASSES.includes(entry.weaponClass)) fail(`${path}.weaponClass`, `unknown weapon class "${entry.weaponClass}"`);
  validateString(entry.delivery, `${path}.delivery`);
  if (!DELIVERIES.includes(entry.delivery)) fail(`${path}.delivery`, `unknown delivery "${entry.delivery}"`);
  if (entry.delivery === "beam" && entry.weaponClass !== "energy") fail(`${path}.delivery`, "beam delivery requires energy weapon class");
  if (entry.weaponClass === "kinetic" && entry.delivery !== "projectile") fail(`${path}.delivery`, "kinetic weapons require projectile delivery");
  if (["missile", "torpedo"].includes(entry.delivery) && entry.weaponClass !== "explosive") fail(`${path}.delivery`, `${entry.delivery} delivery requires explosive weapon class`);
  if (entry.weaponClass === "energy" && !["beam", "projectile"].includes(entry.delivery)) fail(`${path}.delivery`, "energy weapons require beam or projectile delivery");
  if (entry.weaponClass === "explosive" && !["projectile", "missile", "torpedo"].includes(entry.delivery)) fail(`${path}.delivery`, "explosive weapons require projectile, missile or torpedo delivery");
  const targetKinds = validateArray(entry.targetKinds, `${path}.targetKinds`);
  if (!targetKinds.length) fail(`${path}.targetKinds`, "expected a nonempty array");
  targetKinds.forEach((kind, index) => {
    if (!TARGET_KINDS.includes(kind)) fail(`${path}.targetKinds[${index}]`, `unknown target kind "${kind}"`);
  });
  if (targetKinds.includes("squadron") && compatibleTypes.some(type => !["turret", "squadronWeapon"].includes(type))) fail(`${path}.targetKinds`, "AA targeting is only valid on turret and squadronWeapon hardpoints");
  validateNumbers(entry, path, ["accuracy", "effectiveRange", "maxRange", "shots", "damage", "critChance", "energyCost", "cooldownRounds"]);
  if (entry.accuracy < 0 || entry.accuracy > 100) fail(`${path}.accuracy`, "expected a value from 0 to 100");
  if (entry.critChance < 0 || entry.critChance > 100) fail(`${path}.critChance`, "expected a value from 0 to 100");
  if (!Number.isInteger(entry.shots) || entry.shots <= 0) fail(`${path}.shots`, "expected a positive integer");
  if (!Number.isInteger(entry.damage) || entry.damage <= 0) fail(`${path}.damage`, "expected a positive integer");
  if (!Number.isInteger(entry.effectiveRange) || entry.effectiveRange <= 0) fail(`${path}.effectiveRange`, "expected a positive integer");
  if (!Number.isInteger(entry.maxRange) || entry.maxRange <= 0) fail(`${path}.maxRange`, "expected a positive integer");
  if (entry.effectiveRange > entry.maxRange) fail(`${path}.effectiveRange`, "cannot exceed maxRange");
  if (entry.energyCost < 0) fail(`${path}.energyCost`, "expected a nonnegative number");
  if (!Number.isInteger(entry.cooldownRounds) || entry.cooldownRounds < 0) fail(`${path}.cooldownRounds`, "expected a nonnegative integer");
  if (entry.variantOf !== undefined) {
    validateString(entry.variantOf, `${path}.variantOf`);
    const parent = requiredReference(weapons, entry.variantOf, `${path}.variantOf`, "weapon parent");
    if (parent === entry) fail(`${path}.variantOf`, "variant cannot reference itself");
    if (parent.variantOf) fail(`${path}.variantOf`, "variant chains deeper than one level are not supported");
    if (entry.weaponClass !== parent.weaponClass) fail(`${path}.weaponClass`, "variant cannot change weaponClass");
    if (entry.delivery !== parent.delivery) fail(`${path}.delivery`, "variant cannot change delivery");
    if (JSON.stringify(entry.compatibleHardpointTypes) !== JSON.stringify(parent.compatibleHardpointTypes)) fail(`${path}.compatibleHardpointTypes`, "variant cannot change compatibleHardpointTypes");
    if (entry.id === parent.id || entry.name === parent.name) fail(path, "variant requires unique id and name");
  }
  if (!compatibleTypes.includes("squadronWeapon")) {
    validateObject(entry.future, `${path}.future`);
    validateNumber(entry.future.massUnits, `${path}.future.massUnits`);
  }
  validateWeaponVisual(entry, path);
};

const validateVisuals = visuals => {
  for (const [visualId, visual] of Object.entries(visuals)) {
    const path = `visuals.${visualId}`;
    validateString(visual.svg, `${path}.svg`);
    validateNumber(visual.size, `${path}.size`);
  }
  const path = "visuals.squadron.formationOffsets";
  const offsetsByCount = validateObject(visuals.squadron?.formationOffsets, path);
  for (const count of [1, 2, 3]) {
    const offsets = validateArray(offsetsByCount[count], `${path}.${count}`);
    if (offsets.length !== count) fail(`${path}.${count}`, `expected ${count} offsets, received ${offsets.length}`);
    for (const [index, offset] of offsets.entries()) {
      const offsetPath = `${path}.${count}[${index}]`;
      validateObject(offset, offsetPath);
      validateNumber(offset.x, `${offsetPath}.x`);
      validateNumber(offset.y, `${offsetPath}.y`);
    }
  }
};

export function validateConfig(config) {
  validateObject(config, "config");
  const { capitalHulls, squadronModels, primarySystems, weapons, shipLoadouts, squadronLoadouts, systemActions, visuals } = config;
  for (const [name, dictionary] of Object.entries({ capitalHulls, squadronModels, primarySystems, weapons, shipLoadouts, squadronLoadouts, systemActions, visuals })) validateDictionary(name, dictionary);

  for (const [hullId, hull] of Object.entries(capitalHulls)) {
    const path = `capitalHulls.${hullId}`;
    validateNumbers(hull, path, ["baseSpeed", "maneuver", "initiative", "combatMassUnits", "shield", "armor", "integrity", "baseEvasion"]);
    validateObject(hull.future, `${path}.future`);
    validateNumber(hull.future.massUnits, `${path}.future.massUnits`);
    validateHardpoints(hull, path);
    validateSystemSlots(hull, path);
    requiredReference(visuals, hull.visualId, `${path}.visualId`, "visual");
  }

  for (const [modelId, model] of Object.entries(squadronModels)) {
    const path = `squadronModels.${modelId}`;
    validateString(model.displayName, `${path}.displayName`);
    validateString(model.craftType, `${path}.craftType`);
    validateNumbers(model, path, ["baseSpeed", "maneuver", "initiative", "stack", "unitHealth", "shield", "armor", "baseEvasion"]);
    if (model.maneuver < 0) fail(`${path}.maneuver`, "expected a nonnegative number");
    validateHardpoints(model, path);
    requiredReference(visuals, model.visualId, `${path}.visualId`, "visual");
  }

  for (const [systemId, system] of Object.entries(primarySystems)) {
    const path = `primarySystems.${systemId}`;
    validateString(system.displayName, `${path}.displayName`);
    validateString(system.type, `${path}.type`);
    validateObject(system.future, `${path}.future`);
    if (system.type === "engine") validateNumbers(system.future, `${path}.future`, ["massUnits", "powerDrawUnits", "thrustUnits"]);
    if (system.type === "reactor") {
      validateNumbers(system, path, ["capacity", "rechargePerRound"]);
      validateNumber(system.future.massUnits, `${path}.future.massUnits`);
    }
  }

  for (const [weaponId, entry] of Object.entries(weapons)) validateCatalogWeapon(entry, `weapons.${weaponId}`, weapons);
  for (const [actionId, action] of Object.entries(systemActions)) {
    const path = `systemActions.${actionId}`;
    validateString(action.name, `${path}.name`);
    validateObject(action.cost, `${path}.cost`);
    for (const [resource, amount] of Object.entries(action.cost)) {
      if (!["energy", "maneuver"].includes(resource)) fail(`${path}.cost.${resource}`, `unknown resource "${resource}"`);
      validateNumber(amount, `${path}.cost.${resource}`);
      if (!Number.isInteger(amount) || amount < 0) fail(`${path}.cost.${resource}`, "expected a nonnegative integer");
    }
    validateString(action.effect, `${path}.effect`);
    if (!SYSTEM_ACTION_EFFECTS.includes(action.effect)) fail(`${path}.effect`, `unknown system action effect "${action.effect}"`);
    if ("preview" in action) {
      validateObject(action.preview, `${path}.preview`);
      for (const [resource, amount] of Object.entries(action.preview)) {
        if (!["speedCapacity", "maneuverCapacity"].includes(resource)) fail(`${path}.preview.${resource}`, `unknown preview resource "${resource}"`);
        validateNumber(amount, `${path}.preview.${resource}`);
        if (!Number.isInteger(amount) || amount < 0) fail(`${path}.preview.${resource}`, "expected a nonnegative integer");
      }
    }
    if ("oncePerActivation" in action) validateBoolean(action.oncePerActivation, `${path}.oncePerActivation`);
  }
  validateVisuals(visuals);

  for (const [loadoutId, loadout] of Object.entries(shipLoadouts)) {
    const path = `shipLoadouts.${loadoutId}`;
    const hull = requiredReference(capitalHulls, loadout.hullId, `${path}.hullId`, "capital hull");
    validateObject(loadout.systems, `${path}.systems`);
    for (const slot of hull.systemSlots) {
      const systemId = loadout.systems[slot.id];
      if (slot.required && !systemId) fail(`${path}.systems.${slot.id}`, `required ${slot.type} system is missing`);
      if (!systemId) continue;
      const system = requiredReference(primarySystems, systemId, `${path}.systems.${slot.id}`, "primary system");
      if (system.type !== slot.type) fail(`${path}.systems.${slot.id}`, `system "${system.id}" has type "${system.type}", expected "${slot.type}"`);
    }
    for (const slotId of Object.keys(loadout.systems)) if (!hull.systemSlots.some(slot => slot.id === slotId)) fail(`${path}.systems.${slotId}`, `unknown system slot ID "${slotId}"`);
    validateWeapons(hull, loadout.weapons, weapons, path);
  }

  for (const [loadoutId, loadout] of Object.entries(squadronLoadouts)) {
    const path = `squadronLoadouts.${loadoutId}`;
    const model = requiredReference(squadronModels, loadout.modelId, `${path}.modelId`, "squadron model");
    validateWeapons(model, loadout.weapons, weapons, path);
  }

  return true;
}
