import { createBattle, freezeEventLog, replayEventLog } from "./v1-domain.ts";
import type { BattleInitialState, BattleState, DomainEvent, StorageLike } from "./v1-types.ts";

const PERSISTENCE_VERSION = 2;
const replayFields = ["bounds", "lifecycle", "deployment", "round", "queue", "activeUnitId", "activationStage", "attackSpentBy", "winner", "units", "contents", "interceptionLinks"] as const;
type ReplayField = typeof replayFields[number];
type PersistedBattle = { persistenceVersion: number; state: BattleState };
type Listener = (state: BattleState) => void;
export type BattleCommand<Result = void> = (state: BattleState) => Result;

export interface BattleStore {
  load(): BattleState | null;
  save(state: BattleState): BattleState;
  clear(): void;
}

export interface EventLogStore {
  load(battleId: string): DomainEvent[];
  save(battleId: string, events: DomainEvent[]): DomainEvent[];
  clear(battleId: string): void;
}

export interface BattleStoreFacade {
  getState(): BattleState;
  dispatch<Result>(command: BattleCommand<Result>): Result;
  subscribe(listener: Listener): () => void;
  replace(next: BattleState): BattleState;
  transact<Result>(command: BattleCommand<Result>): Result;
  save(): BattleState;
  reset(next?: BattleInitialState): BattleState;
}

function replayShape(state: BattleState): Record<ReplayField, unknown> {
  return Object.fromEntries(replayFields.map(field => [field, structuredClone(state[field])])) as Record<ReplayField, unknown>;
}

function legacyDelta(before: Record<string, unknown>, after: Record<string, unknown>) {
  return { patches: replayFields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(field => ({ path: [field], value: structuredClone(after[field]) })) };
}

function migrateLegacyEvents(state: BattleState): BattleState | null {
  if (!state.events.length || state.events.every(event => Object.hasOwn(event, "checkpoint") && Object.hasOwn(event, "delta"))) return state;
  if (!state.events.every(event => event.snapshot && typeof event.snapshot === "object")) return null;
  let previous = replayShape(state.events[0].snapshot as BattleState);
  state.events = state.events.map((event, index) => {
    const current = replayShape(event.snapshot as BattleState);
    const migrated = { ...event, checkpoint: index === 0 ? structuredClone(current) : null, delta: index === 0 ? { patches: [] } : legacyDelta(previous, current) };
    delete (migrated as Record<string, unknown>).snapshot;
    previous = current;
    return migrated as DomainEvent;
  });
  return state;
}

function legacyState(value: unknown): BattleState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BattleState>;
  if (typeof candidate.id !== "string" || !Array.isArray(candidate.units) || !Array.isArray(candidate.contents) || !Array.isArray(candidate.events) || !Number.isInteger(candidate.sequence)) return null;
  return migrateLegacyEvents(structuredClone(candidate) as BattleState);
}

function sameReplayState(state: BattleState, replayed: BattleState): boolean {
  return state.sequence === replayed.sequence && replayFields.every(field => JSON.stringify(state[field]) === JSON.stringify(replayed[field]));
}

function restore(value: unknown): BattleState | null {
  const wrapped = value && typeof value === "object" ? value as Partial<PersistedBattle> : null;
  const state = wrapped?.persistenceVersion === PERSISTENCE_VERSION ? structuredClone(wrapped.state) : legacyState(value);
  if (!state) return null;
  try {
    if (state.events.length) {
      freezeEventLog(state.events, state.id);
      const replayed = replayEventLog(state.events, state.id) as BattleState;
      if (!sameReplayState(state, replayed)) return null;
      const canonical = { ...state, ...Object.fromEntries(replayFields.map(field => [field, replayed[field]])), events: replayed.events, sequence: replayed.sequence } as BattleState;
      canonical._eventCheckpoint = structuredClone(replayed.events[0].checkpoint ?? {});
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

function persisted(state: BattleState): PersistedBattle {
  const snapshot = structuredClone(state);
  freezeEventLog(snapshot.events, snapshot.id);
  return { persistenceVersion: PERSISTENCE_VERSION, state: snapshot };
}

export function createMemoryPersistence(initial: BattleState | PersistedBattle | null = null): BattleStore {
  let snapshot: PersistedBattle | null = initial && "persistenceVersion" in initial ? initial as PersistedBattle : initial ? { persistenceVersion: PERSISTENCE_VERSION, state: initial as BattleState } : null;
  return {
    load: () => restore(snapshot),
    save(state) { snapshot = persisted(state); return structuredClone(snapshot.state); },
    clear() { snapshot = null; }
  };
}

export function createLocalPersistence(key = "v1-combat-state", storage: StorageLike | undefined = globalThis.localStorage): BattleStore {
  return {
    load() { const value = storage?.getItem(key); if (!value) return null; try { return restore(JSON.parse(value)); } catch { return null; } },
    save(state) { const snapshot = persisted(state); storage?.setItem(key, JSON.stringify(snapshot)); return structuredClone(snapshot.state); },
    clear() { storage?.removeItem(key); }
  };
}

export function createMemoryEventLogStore(initial: Record<string, DomainEvent[]> = {}): EventLogStore {
  const logs = new Map(Object.entries(initial).map(([id, events]) => [id, structuredClone(events)]));
  return {
    load: battleId => structuredClone(logs.get(battleId) ?? []),
    save(battleId, events) { freezeEventLog(events, battleId); logs.set(battleId, structuredClone(events)); return structuredClone(events); },
    clear: battleId => { logs.delete(battleId); }
  };
}

export function createLocalEventLogStore(prefix = "v1-combat-events", storage: StorageLike | undefined = globalThis.localStorage): EventLogStore {
  const key = (battleId: string) => `${prefix}:${battleId}`;
  return {
    load(battleId) { const value = storage?.getItem(key(battleId)); if (!value) return []; try { const events = JSON.parse(value) as DomainEvent[]; freezeEventLog(events, battleId); return events; } catch { return []; } },
    save(battleId, events) { freezeEventLog(events, battleId); storage?.setItem(key(battleId), JSON.stringify(events)); return structuredClone(events); },
    clear: battleId => { storage?.removeItem(key(battleId)); }
  };
}

export function createBattleStore({ persistence = createMemoryPersistence(), eventLog = createMemoryEventLogStore(), initial = {} }: { persistence?: BattleStore; eventLog?: EventLogStore; initial?: BattleInitialState } = {}): BattleStoreFacade {
  const stored = persistence.load();
  const battleId = stored?.id ?? initial.id ?? "battle-1";
  const loggedEvents = eventLog.load(battleId);
  let state = stored ?? createBattle(initial);
  if (loggedEvents.length) {
    try {
      freezeEventLog(loggedEvents, battleId);
      const replayed = replayEventLog(loggedEvents, battleId) as BattleState;
      if (!stored || sameReplayState(stored, replayed)) {
        state = { ...replayed, _eventCheckpoint: structuredClone(replayed.events[0].checkpoint ?? {}), _eventReplayState: replayShape(replayed) };
        freezeEventLog(state.events, state.id);
      }
    } catch {
      if (!stored) state = createBattle(initial);
    }
  }
  const listeners = new Set<Listener>();
  const persist = () => { persistence.save(state); eventLog.save(state.id, state.events); };
  const notify = () => { listeners.forEach(listener => listener(state)); return state; };
  const dispatch = <Result>(command: BattleCommand<Result>): Result => { const result = command(state); persist(); notify(); return result; };
  return {
    getState: () => state,
    dispatch,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    replace(next) { state = next; persist(); return notify(); },
    transact: dispatch,
    save() { persist(); return structuredClone(state); },
    reset(next = initial) { state = createBattle(next); persist(); return notify(); }
  };
}
