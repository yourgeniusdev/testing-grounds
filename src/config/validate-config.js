const HARDPOINT_MOUNTS = ["turret", "battery-left", "battery-right", "line", "forward", "squadronWeapon"];
const HARDPOINT_TYPES = ["turret", "battery", "spinal", "forward", "squadronWeapon"];
const MOUNTS_BY_TYPE = {
  turret: ["turret"],
  battery: ["battery-left", "battery-right"],
  spinal: ["line"],
  forward: ["forward"],
  squadronWeapon: ["squadronWeapon"]
};

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
    for (const field of ["id", "role", "mount", "type"]) validateString(hardpoint[field], `${hardpointPath}.${field}`);
    if (ids.has(hardpoint.id)) fail(`${hardpointPath}.id`, `duplicate hardpoint ID "${hardpoint.id}"`);
    ids.add(hardpoint.id);
    if (!HARDPOINT_MOUNTS.includes(hardpoint.mount) || !HARDPOINT_TYPES.includes(hardpoint.type)) {
      fail(`${hardpointPath}.${HARDPOINT_MOUNTS.includes(hardpoint.mount) ? "type" : "mount"}`, "hardpoint requires role, supported mount and supported type");
    }
    if (!MOUNTS_BY_TYPE[hardpoint.type].includes(hardpoint.mount)) fail(`${hardpointPath}.mount`, `mount "${hardpoint.mount}" is incompatible with ${hardpoint.type} hardpoint type`);
    if (hardpoint.type === "squadronWeapon" && owner.kind !== "squadron") fail(`${hardpointPath}.type`, "squadronWeapon hardpoints require a squadron owner");
    if (hardpoint.type === "forward" && !["fore", "aft"].includes(hardpoint.orientation)) fail(`${hardpointPath}.orientation`, 'expected "fore" or "aft"');
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
    if (!slots.some(slot => slot.required && slot.type === requiredType)) {
      fail(`${path}.systemSlots`, `missing required ${requiredType} slot`);
    }
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
    const weapon = requiredReference(weapons, installation.weaponId, `${installationPath}.weaponId`, "weapon");
    if (!weapon.compatibleHardpointTypes.includes(hardpoint.type)) {
      fail(`${installationPath}.weaponId`, `weapon "${weapon.id}" is incompatible with ${hardpoint.type} hardpoint "${hardpointId}"`);
    }
  }
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
  const { capitalHulls, squadronModels, primarySystems, weapons, shipLoadouts, squadronLoadouts, visuals } = config;
  for (const [name, dictionary] of Object.entries({ capitalHulls, squadronModels, primarySystems, weapons, shipLoadouts, squadronLoadouts, visuals })) {
    validateDictionary(name, dictionary);
  }

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
    validateNumbers(model, path, ["baseSpeed", "initiative", "stack", "unitHealth", "shield", "armor", "baseEvasion"]);
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

  for (const [weaponId, weapon] of Object.entries(weapons)) {
    const path = `weapons.${weaponId}`;
    validateString(weapon.name, `${path}.name`);
    const compatibleTypes = validateArray(weapon.compatibleHardpointTypes, `${path}.compatibleHardpointTypes`);
    if (!compatibleTypes.length) fail(`${path}.compatibleHardpointTypes`, "expected a nonempty array");
    compatibleTypes.forEach((type, index) => {
      validateString(type, `${path}.compatibleHardpointTypes[${index}]`);
      if (!HARDPOINT_TYPES.includes(type)) fail(`${path}.compatibleHardpointTypes[${index}]`, `unknown hardpoint type "${type}"`);
    });
    validateString(weapon.weaponClass, `${path}.weaponClass`);
    validateNumbers(weapon, path, ["accuracy", "effectiveRange", "maxRange", "shots", "damage", "critChance", "energyCost"]);
    if (!compatibleTypes.includes("squadronWeapon")) {
      validateObject(weapon.future, `${path}.future`);
      validateNumber(weapon.future.massUnits, `${path}.future.massUnits`);
    }
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
    for (const slotId of Object.keys(loadout.systems)) {
      if (!hull.systemSlots.some(slot => slot.id === slotId)) fail(`${path}.systems.${slotId}`, `unknown system slot ID "${slotId}"`);
    }
    validateWeapons(hull, loadout.weapons, weapons, path);
  }

  for (const [loadoutId, loadout] of Object.entries(squadronLoadouts)) {
    const path = `squadronLoadouts.${loadoutId}`;
    const model = requiredReference(squadronModels, loadout.modelId, `${path}.modelId`, "squadron model");
    validateWeapons(model, loadout.weapons, weapons, path);
  }

  return true;
}
