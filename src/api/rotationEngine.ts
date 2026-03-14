import { accountCanSatisfyRequirement } from './capabilityFetcher';
import { AccountSelectionRequirements, AccountSession, RotationStrategy } from './types';

/**
 * Rotation engine that distributes requests across multiple Perplexity accounts.
 */
export class RotationEngine {
  private strategy: RotationStrategy = 'round-robin';
  private lastUsedIndex = -1;

  setStrategy(strategy: RotationStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): RotationStrategy {
    return this.strategy;
  }

  selectAccount(
    accounts: AccountSession[],
    requirement?: AccountSelectionRequirements
  ): AccountSession | null {
    const available = accounts.filter((account) =>
      this._isAvailable(account) && accountCanSatisfyRequirement(account, requirement)
    );

    if (available.length === 0) {
      return null;
    }

    switch (this.strategy) {
      case 'least-used':
        return this._leastUsed(available);
      case 'failover-only':
        return this._failoverOnly(available);
      case 'round-robin':
      default:
        return this._roundRobin(available, accounts, requirement);
    }
  }

  markUsed(account: AccountSession): void {
    account.lastUsedAt = new Date().toISOString();
    account.queriestoday += 1;
    account.queriesTotalLifetime += 1;
    account.errorCount = 0;
    account.status = 'active';
  }

  markFailed(account: AccountSession, isRateLimit: boolean): void {
    account.errorCount += 1;

    if (isRateLimit) {
      account.status = 'rate_limited';
      account.cooldownUntil = new Date(Date.now() + 60_000).toISOString();
      return;
    }

    if (account.errorCount >= 3) {
      account.status = 'error';
    }
  }

  markExpired(account: AccountSession): void {
    account.status = 'expired';
  }

  getFailoverAccount(
    accounts: AccountSession[],
    excludeId: string,
    requirement?: AccountSelectionRequirements
  ): AccountSession | null {
    const available = accounts.filter((account) =>
      account.id !== excludeId &&
      this._isAvailable(account) &&
      accountCanSatisfyRequirement(account, requirement)
    );

    if (available.length === 0) {
      return null;
    }

    return available.sort((left, right) => left.queriestoday - right.queriestoday)[0];
  }

  resetDailyCounts(accounts: AccountSession[]): void {
    for (const account of accounts) {
      account.queriestoday = 0;
      if (account.status === 'rate_limited') {
        account.status = 'active';
        account.cooldownUntil = undefined;
      }
    }
  }

  private _isAvailable(account: AccountSession): boolean {
    if (account.status === 'disabled' || account.status === 'expired' || account.status === 'error') {
      return false;
    }

    if (account.status === 'rate_limited' && account.cooldownUntil) {
      if (new Date(account.cooldownUntil) > new Date()) {
        return false;
      }
      account.status = 'active';
      account.cooldownUntil = undefined;
    }

    return true;
  }

  private _roundRobin(
    available: AccountSession[],
    allAccounts: AccountSession[],
    requirement?: AccountSelectionRequirements
  ): AccountSession {
    this.lastUsedIndex = (this.lastUsedIndex + 1) % allAccounts.length;

    for (let index = 0; index < allAccounts.length; index += 1) {
      const candidateIndex = (this.lastUsedIndex + index) % allAccounts.length;
      const account = allAccounts[candidateIndex];
      if (this._isAvailable(account) && accountCanSatisfyRequirement(account, requirement)) {
        this.lastUsedIndex = candidateIndex;
        return account;
      }
    }

    return available[0];
  }

  private _leastUsed(available: AccountSession[]): AccountSession {
    return [...available].sort((left, right) => left.queriestoday - right.queriestoday)[0];
  }

  private _failoverOnly(available: AccountSession[]): AccountSession {
    return available[0];
  }
}
