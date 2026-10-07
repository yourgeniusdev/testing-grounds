export type Side = "left" | "right";
export type Lifecycle = "DeploymentLeft" | "DeploymentRight" | "RoundStart" | "WaitDecision" | "ActivationStart" | "SystemActions" | "Maneuver" | "Attack" | "EndActivation" | "RoundEnd" | "Finished";
export type Rng = () => number;
export interface Position { q: number; r: number }
export interface Bounds { minCol: number; maxCol: number; minRow: number; maxRow: number }
export interface Entity {
  id?: string;
  side?: string;
  sideId?: string;
  kind?: string;
  type?: string;
  role?: string;
  name?: string;
  position?: Position | null;
  heading?: number;
  initiative?: number;
  integrity?: number;
  shield?: number;
  armor?: number;
  mass?: number;
  speed?: number;
  baseSpeed?: number;
  currentSpeed?: number;
  energy?: number;
  maxEnergy?: number;
  maneuver?: number;
  turnsSpent?: number;
  evasion?: number;
  stationaryTurnEvasion?: number;
  disengagementEvasion?: number;
  hasActivated?: boolean;
  hasWaited?: boolean;
  interception?: boolean;
  interceptRange?: number;
  engagedWith?: string[];
  disengagedLinks?: string[];
  stack?: number;
  count?: number;
  unitHealth?: number;
  size?: string;
  cover?: string;
  movementCost?: number;
  onEnterDamage?: number;
  onEnterEffects?: OnEnterEffect[];
  activationStartEffects?: ActivationStartEffect[];
  weapons?: Entity[];
  weaponSlots?: Entity[];
  weapon?: Entity;
  ammo?: number;
  ready?: boolean;
  destroyed?: boolean;
  overwatchEligible?: boolean;
  overwatch?: boolean;
  overwatchRound?: number;
  overwatchTargets?: string[];
  accuracy?: number;
  damage?: number;
  shots?: number;
  minRange?: number;
  maxRange?: number;
  arc?: string;
  profile?: string;
  critChance?: number;
  key?: string;
  unitIds?: string[];
  creators?: string[];
}
export type OnEnterEffect = { type: "damage"; amount: number } | { type: "modify-unit"; field: "currentSpeed" | "evasion"; amount: number };
export type ActivationStartEffect = { type: "damage"; amount: number; sourceId?: string };
export type EntityArray = Entity[];
export interface DomainEvent {
  eventId: string;
  battleId: string;
  round: number;
  phase: Lifecycle;
  sequence: number;
  actorId: string | null;
  subjectIds: string[];
  causeEventId: string | null;
  action: string;
  checkpoint: Record<string, unknown> | null;
  delta: { patches: Array<{ path: Array<string | number>; value?: unknown; remove?: true }> };
  position?: Position | null;
  heading?: number | null;
  side?: Side;
  kind?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown> | string;
  result?: Record<string, unknown>;
  random?: Record<string, number>;
  lost?: number;
  snapshot?: BattleState;
  [key: string]: unknown;
}
export type EventArray = DomainEvent[];
export interface BattleState {
  id: string;
  units: EntityArray;
  contents: EntityArray;
  bounds: Bounds | null;
  lifecycle: Lifecycle;
  deployment: Record<Side, boolean>;
  round: number;
  queue: string[];
  activeUnitId: string | null;
  activationStage: Lifecycle | null;
  attackSpentBy: string | null;
  winner: Side | null;
  events: EventArray;
  sequence: number;
  interceptionLinks: EntityArray;
  roundKeys: Record<string, number>;
  _eventCheckpoint: Record<string, unknown>;
  _eventReplayState: Record<string, unknown>;
}
export interface BattleInitialState {
  id?: string;
  units?: Entity[];
  bounds?: Bounds | null;
  contents?: Entity[];
  round?: number;
}
export interface RandomOptions { random: Rng; causeEventId?: string | null }
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}
