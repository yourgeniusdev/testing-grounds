import { createBattle } from "./v1-domain.js";

export function createMemoryPersistence(initial = null) {
  let snapshot = initial;
  return {
    load() { return snapshot ? structuredClone(snapshot) : null; },
    save(state) { snapshot = structuredClone(state); return snapshot; },
    clear() { snapshot = null; }
  };
}

export function createLocalPersistence(key = "v1-combat-state", storage = globalThis.localStorage) {
  return {
    load() {
      const value = storage?.getItem(key);
      return value ? JSON.parse(value) : null;
    },
    save(state) {
      storage?.setItem(key, JSON.stringify(state));
      return state;
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
