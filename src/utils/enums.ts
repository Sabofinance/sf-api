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

export enum WithdrawalStatus {
  requested = 'requested',
  approved = 'approved',
  processing = 'processing',
  completed = 'completed',
  failed = 'failed',
}

export enum SabitType {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum SabitStatus {
  active = 'active',
  completed = 'completed',
  cancelled = 'cancelled',
  suspended = 'suspended',
}

export enum TradeStatus {
  initiated = 'initiated',
  escrowed = 'escrowed',
  confirmed = 'confirmed',
  completed = 'completed',
  cancelled = 'cancelled',
  disputed = 'disputed',
}

export enum DisputeStatus {
  open = 'open',
  resolved = 'resolved',
  closed = 'closed',
}

export enum NotificationStatus {
  unread = 'unread',
  read = 'read',
}

export enum NotificationType {
  info = 'info',
  success = 'success',
  warning = 'warning',
  error = 'error',
}

