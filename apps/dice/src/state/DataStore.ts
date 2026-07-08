import { action, makeObservable, observable } from 'mobx';
import type { CascadeDie, SpinResponse } from '@/domain/types';

// DataStore — the last server response, decoded.

export class DataStore {
  cascade: CascadeDie[] = [];
  multiplier = 0;
  totalWin = 0;

  constructor() {
    makeObservable(this, {
      cascade: observable.ref,
      multiplier: observable,
      totalWin: observable,
      setResponse: action,
      clear: action,
    });
  }

  setResponse(response: SpinResponse): void {
    this.cascade = response.cascade;
    this.multiplier = response.multiplier;
    this.totalWin = response.totalWin;
  }

  clear(): void {
    this.cascade = [];
    this.multiplier = 0;
    this.totalWin = 0;
  }
}
