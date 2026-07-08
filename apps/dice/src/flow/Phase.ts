import type { NetworkManager } from '@/infrastructure/NetworkManager';
import type { Ticker } from '@/infrastructure/timing';
import type { DicePresenter } from '@/presenters/DicePresenter';
import type { RootStore } from '@/state/RootStore';
import type { FSM } from './fsm';

export interface PhaseContext {
  fsm: FSM;
  stores: RootStore;
  ticker: Ticker;
  network: NetworkManager;
  dice: DicePresenter;
}

export interface Phase {
  readonly name: string;
  enter(ctx: PhaseContext): void | Promise<void>;
  skip?(ctx: PhaseContext): void;
  exit?(ctx: PhaseContext): void;
}
