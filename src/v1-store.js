import { createBattle, freezeEventLog, replayEventLog } from "./v1-domain.js";

const PERSISTENCE_VERSION = 2;

const replayFields = ["bounds", "lifecycle", "deployment", "round", "queue", "activeUnitId", "activationStage", "attackSpentBy", "winner", "units", "contents", "interceptionLinks"];

function replayShape(state) { return Object.fromEntries(replayFields.map(field => [field, structuredClone(state[field])])); }

function legacyDelta(before, after) {
  return { patches: replayFields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(field => ({ path: [field], value: structuredClone(after[field]) })) };
}

function migrateLegacyEvents(state) {
  if (!state.events.length || state.events.every(event => Object.hasOwn(event, "checkpoint") && Object.hasOwn(event, "delta"))) return state;
  if (!state.events.every(event => event.snapshot && typeof event.snapshot === "object")) return null;
  let previous = replayShape(state.events[0].snapshot);
  state.events = state.events.map((event, index) => {
    const current = replayShape(event.snapshot);
    const migrated = { ...event, checkpoint: index === 0 ? structuredClone(current) : null, delta: index === 0 ? { patches: [] } : legacyDelta(previous, current) };
    delete migrated.snapshot;
    previous = current;
    return migrated;
  });
  return state;
}

function legacyState(value) {
  const state = value && typeof value.id === "string" && Array.isArray(value.units) && Array.isArray(value.contents) && Array.isArray(value.events) && Number.isInteger(value.sequence) ? structuredClone(value) : null;
  return state ? migrateLegacyEvents(state) : null;
}

function sameReplayState(state, replayed) {
  return state.sequence === replayed.sequence && replayFields.every(field => JSON.stringify(state[field]) === JSON.stringify(replayed[field]));
}

function restore(value) {
  const state = value?.persistenceVersion === PERSISTENCE_VERSION ? structuredClone(value.state) : legacyState(value);
  if (!state) return null;
  try {
    if (state.events?.length) {
      freezeEventLog(state.events, state.id);
      const replayed = replayEventLog(state.events, state.id);
      if (!sameReplayState(state, replayed)) return null;
      const canonical = { ...state, ...Object.fromEntries(replayFields.map(field => [field, replayed[field]])), events: replayed.events, sequence: replayed.sequence };
      canonical._eventCheckpoint = structuredClone(replayed.events[0].checkpoint);
      canonical._eventReplayState = replayShape(replayed);
      freezeEventLog(canonical.events, canonical.id);
      return canonical;
    }
    if (state.sequence !== 0) return null;
    state._eventCheckpoint = replayShape(state);
    state._eventReplayState = replayShape(state);
    return state;
  } catch { return null; }
}

function persisted(state) {
  const snapshot = structuredClone(state);
  freezeEventLog(snapshot.events, snapshot.id);
  return { persistenceVersion: PERSISTENCE_VERSION, state: snapshot };
}

export function createMemoryPersistence(initial = null) {
  let snapshot = initial?.persistenceVersion ? initial : initial ? { persistenceVersion: PERSISTENCE_VERSION, state: initial } : null;
  return {
    load() { return restore(snapshot); },
    save(state) { snapshot = persisted(state); return structuredClone(snapshot.state); },
    clear() { snapshot = null; }
  };
}

export function createLocalPersistence(key = "v1-combat-state", storage = globalThis.localStorage) {
  return {
    load() {
      const value = storage?.getItem(key);
      if (!value) return null;
      try { return restore(JSON.parse(value)); } catch { return null; }
    },
    save(state) {
      const snapshot = persisted(state);
      storage?.setItem(key, JSON.stringify(snapshot));
      return structuredClone(snapshot.state);
    },
    clear() { storage?.removeItem(key); }
  };
}

export function createBattleStore({ persistence = createMemoryPersistence(), initial = {} } = {}) {
  let state = persistence.load() || createBattle(initial);
  const listeners = new Set();
  function notify() { listeners.forEach(listener => listener(state)); return state; }
  return {
    getState() { return state; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    replace(next) { state = next; persistence.save(state); return notify(); },
    transact(command) { const result = command(state); persistence.save(state); notify(); return result; },
    save() { return persistence.save(state); },
    reset(next = initial) { state = createBattle(next); persistence.save(state); return notify(); }
  };
}
