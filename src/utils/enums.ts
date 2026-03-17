export enum Currency {
  NGN = 'NGN',
  GBP = 'GBP',
  USD = 'USD',
  CAD = 'CAD',
}

export enum DepositStatus {
  initiated = 'initiated',
  pending_review = 'pending_review',
  completed = 'completed',
  failed = 'failed',
  rejected = 'rejected',
}

export enum KycStatus {
  unverified = 'unverified',
  pending = 'pending',
  verified = 'verified',
  rejected = 'rejected',
}

export enum LedgerType {
  deposit = 'deposit',
  withdrawal = 'withdrawal',
  trade_debit = 'trade_debit',
  trade_credit = 'trade_credit',
  escrow_hold = 'escrow_hold',
  escrow_release = 'escrow_release',
  reversal = 'reversal',
  adjustment = 'adjustment',
}

export enum UserRole {
  user = 'user',
  admin = 'admin',
}

