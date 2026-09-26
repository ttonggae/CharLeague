import type { Button, CharacterData, CombatEventType, MoveData } from './data.ts';

export interface AbilityFighter {
  data: CharacterData;
  hp: number;
  stamina: number;
  ultimateProgress: number;
}

export interface CombatEvent {
  type: CombatEventType;
  move?: MoveData;
  value?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function applyPassive(fighter: AbilityFighter, event: CombatEvent): void {
  const passive = fighter.data.passive;
  if (passive.trigger !== event.type || (passive.skillId && passive.skillId !== event.move?.id)) return;
  for (const effect of passive.effects) {
    if (effect.type === 'restoreStamina') fighter.stamina = clamp(fighter.stamina + effect.amount, 0, fighter.data.maxStamina);
    else if (effect.type === 'restoreHealth') fighter.hp = clamp(fighter.hp + effect.amount, 0, fighter.data.maxHp);
    else if (effect.type === 'addUltimateProgress') addUltimateProgress(fighter, effect.amount);
  }
}

export function passiveDamageMultiplier(fighter: AbilityFighter, targetState: 'stun' | null): number {
  return fighter.data.passive.effects.reduce((multiplier, effect) =>
    effect.type === 'bonusDamageAgainstState' && effect.state === targetState ? multiplier * effect.multiplier : multiplier, 1);
}

export function addUltimateProgress(fighter: AbilityFighter, amount: number): void {
  const target = fighter.data.ultimate?.condition.target;
  if (target === undefined) return;
  fighter.ultimateProgress = clamp(fighter.ultimateProgress + amount, 0, target);
}

export function advanceUltimate(fighter: AbilityFighter, event: CombatEvent): void {
  const condition = fighter.data.ultimate?.condition;
  if (!condition) return;
  if (condition.type === 'landHits' && event.type === 'landHit') addUltimateProgress(fighter, 1);
  else if (condition.type === 'takeDamage' && event.type === 'takeDamage') addUltimateProgress(fighter, event.value ?? 0);
  else if (condition.type === 'spendStamina' && event.type === 'spendStamina') addUltimateProgress(fighter, event.value ?? 0);
}

export function isUltimateMove(fighter: AbilityFighter, move: MoveData): boolean {
  return fighter.data.ultimate?.moveId === move.id;
}

export function isUltimateReady(fighter: AbilityFighter): boolean {
  const target = fighter.data.ultimate?.condition.target;
  return target !== undefined && fighter.ultimateProgress >= target;
}

export function canUseMove(fighter: AbilityFighter, move: MoveData): boolean {
  return fighter.stamina >= move.staminaCost && (!isUltimateMove(fighter, move) || isUltimateReady(fighter));
}

export function spendForMove(fighter: AbilityFighter, move: MoveData): void {
  fighter.stamina = clamp(fighter.stamina - move.staminaCost, 0, fighter.data.maxStamina);
  applyPassive(fighter, { type: 'skillUse', move, value: move.staminaCost });
  applyPassive(fighter, { type: 'spendStamina', move, value: move.staminaCost });
  if (isUltimateMove(fighter, move)) fighter.ultimateProgress = 0;
  else advanceUltimate(fighter, { type: 'spendStamina', move, value: move.staminaCost });
}

export function ultimateStatus(fighter: AbilityFighter): string | null {
  const ultimate = fighter.data.ultimate;
  if (!ultimate) return null;
  return isUltimateReady(fighter) ? '궁극기 준비' : `궁 ${Math.floor(fighter.ultimateProgress)}/${ultimate.condition.target}`;
}

export function isSkillId(value: unknown): value is Button {
  return value === 'A' || value === 'S' || value === 'D' || value === 'Shift' || value === 'Space';
}
