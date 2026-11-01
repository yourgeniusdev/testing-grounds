export const AVAILABILITY_REASON_ORDER = Object.freeze([
  "battle.finished",
  "actor.missing",
  "action.another-resolving",
  "action.invalid",
  "action.not-ready",
  "overwatch.ineligible",
  "overwatch.inactive",
  "maneuver.intercepted",
  "disengage.not-intercepted",
  "disengage.invalid-links",
  "resource.unavailable",
  "resource.insufficient",
  "maneuver.no-route",
  "target.missing",
  "target.friendly",
  "target.invalid-kind",
  "target.out-of-arc",
  "target.out-of-range",
  "target.line-of-fire-blocked"
]);

const REASON_RANK = new Map(AVAILABILITY_REASON_ORDER.map((code, index) => [code, index]));
const RESOURCE_RANK = new Map(["speed", "maneuver", "energy"].map((resource, index) => [resource, index]));

function isPlainContainer(value) {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePlainGraph(value, clones = new WeakMap()) {
  if (!isPlainContainer(value)) return value;
  if (clones.has(value)) return clones.get(value);
  const prototype = Object.getPrototypeOf(value);
  const clone = Array.isArray(value) ? new Array(value.length) : Object.create(prototype);
  clones.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if ("value" in descriptor) descriptor.value = clonePlainGraph(descriptor.value, clones);
    Object.defineProperty(clone, key, descriptor);
  }
  return clone;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!isPlainContainer(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Reflect.ownKeys(value).map(key => value[key])) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function availabilityReason(code, message, params = {}) {
  return { code, message, params };
}

function compareReasons(left, right) {
  return (REASON_RANK.get(left.code) ?? Number.MAX_SAFE_INTEGER) - (REASON_RANK.get(right.code) ?? Number.MAX_SAFE_INTEGER)
    || (RESOURCE_RANK.get(left.params?.resource) ?? Number.MAX_SAFE_INTEGER) - (RESOURCE_RANK.get(right.params?.resource) ?? Number.MAX_SAFE_INTEGER)
    || left.code.localeCompare(right.code)
    || JSON.stringify(left.params).localeCompare(JSON.stringify(right.params));
}

function forecastResources(resources, cost, capacityChange) {
  return Object.fromEntries(Object.entries(resources || {}).map(([resource, snapshot]) => {
    const spend = Math.max(0, cost[resource] || 0);
    const gainedCapacity = capacityChange[resource] || 0;
    const capacity = Math.max(0, snapshot.capacity + gainedCapacity);
    const spent = snapshot.spent + spend;
    return [resource, { capacity, spent, remaining: Math.max(0, capacity - spent) }];
  }));
}

export function createAvailability({ action, reasons = [], cost = {}, resources = {}, capacityChange = {}, readiness = null, target = null, details = null }) {
  const orderedReasons = [...reasons].sort(compareReasons);
  return deepFreeze(clonePlainGraph({
    action,
    available: orderedReasons.length === 0,
    reasons: orderedReasons,
    forecast: {
      cost: { speed: cost.speed || 0, maneuver: cost.maneuver || 0, energy: cost.energy || 0 },
      capacityChange: { speed: capacityChange.speed || 0, maneuver: capacityChange.maneuver || 0, energy: capacityChange.energy || 0 },
      resources: forecastResources(resources, cost, capacityChange)
    },
    resources: Object.fromEntries(Object.entries(resources || {}).map(([resource, snapshot]) => [resource, { ...snapshot }])),
    readiness,
    target,
    details
  }));
}

export function insufficientResourceReasons(resources, cost) {
  const labels = { speed: "Скорости", maneuver: "Манёвренности", energy: "энергии" };
  return ["speed", "maneuver", "energy"].flatMap(resource => {
    const required = cost[resource] || 0;
    const available = resources?.[resource]?.remaining || 0;
    return required > available
      ? [availabilityReason("resource.insufficient", `Недостаточно ${labels[resource]}: требуется ${required}, доступно ${available}`, { resource, required, available })]
      : [];
  });
}
