/**
 * Sabo Finance — API Type Contracts
 *
 * Copy this file into the frontend repository.
 * All types mirror the exact JSON shapes returned by the backend API.
 * Financial amounts are intentionally typed as `string` to preserve
 * precision (stored as numeric(18,2) in Postgres — never use JS floats).
 */

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export type Currency = 'NGN' | 'GBP' | 'USD' | 'CAD';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type UserRole = 'user' | 'admin' | 'super_admin';

export type TradeStatus = 'initiated' | 'escrowed' | 'confirmed' | 'completed' | 'cancelled' | 'disputed';

export type SabitStatus = 'active' | 'completed' | 'cancelled' | 'suspended';

export type SabitType = 'BUY' | 'SELL';

export type DepositStatus = 'initiated' | 'pending_review' | 'completed' | 'failed' | 'expired' | 'rejected';

export type WithdrawalStatus = 'requested' | 'approved' | 'processing' | 'completed' | 'failed';

export type DisputeStatus = 'open' | 'resolved' | 'closed';

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';

export type NotificationStatus = 'unread' | 'read';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export type LedgerType =
  | 'deposit'
  | 'withdrawal'
  | 'trade_debit'
  | 'trade_credit'
  | 'escrow_hold'
  | 'escrow_release'
  | 'reversal'
  | 'adjustment';

// ─────────────────────────────────────────────────────────────────────────────
// API ENVELOPE
// ─────────────────────────────────────────────────────────────────────────────

/** Every response from the Sabo Finance API is wrapped in this envelope. */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  meta: Record<string, unknown>;
  error: { code: string; message: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: UserRole;
  kyc_status: KycStatus;
  is_suspended: boolean;
  profile_picture_url: string | null;
  created_at: string;
}

export interface LoginResponse {
  message: string;
}

export interface VerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RegisterResponse {
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN AUTH
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminLoginResponse {
  message: string;
}

export interface AdminVerifyOtpResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    kyc_status: KycStatus;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────────────────────────────────────

export interface Wallet {
  id: string;
  user_id: string;
  currency: Currency;
  balance: string;           // numeric string, e.g. "1500.00"
  locked_balance: string;
  escrow_balance: string;
  created_at: string;
}

export interface WalletsResponse {
  wallets: Wallet[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TRADES
// ─────────────────────────────────────────────────────────────────────────────

export interface Trade {
  id: string;
  sabit_id: string;
  buyer_id: string;
  seller_id: string;
  currency: Currency;
  amount: string;
  rate: string;
  total_ngn: string;
  status: TradeStatus;
  pin_confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradeWithParticipants extends Trade {
  buyer_name: string;
  seller_name: string;
}

export interface TradesResponse {
  trades: Trade[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SABITS (P2P LISTINGS)
// ─────────────────────────────────────────────────────────────────────────────

export interface Sabit {
  id: string;
  user_id: string;
  type: SabitType;
  currency: Currency;
  amount: string;
  rate: string;
  min_order: string | null;
  max_order: string | null;
  note: string | null;
  status: SabitStatus;
  created_at: string;
  updated_at: string;
}

export interface SabitsResponse {
  sabits: Sabit[];
}

// ─────────────────────────────────────────────────────────────────────────────
// BIDS
// ─────────────────────────────────────────────────────────────────────────────

export interface Bid {
  id: string;
  sabit_id: string;
  bidder_id: string;
  amount: string;
  proposed_rate: string;
  status: BidStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPOSITS
// ─────────────────────────────────────────────────────────────────────────────

export interface Deposit {
  id: string;
  user_id: string;
  currency: Currency;
  amount: string;
  status: DepositStatus;
  proof_url: string | null;
  rejection_reason: string | null;
  flutterwave_tx_ref: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KYC
// ─────────────────────────────────────────────────────────────────────────────

export interface KycSubmission {
  id: string;
  user_id: string;
  document_type: string;
  document_url: string;
  selfie_url: string;
  status: KycStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface KycSubmissionsResponse {
  submissions: KycSubmission[];
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPUTES
// ─────────────────────────────────────────────────────────────────────────────

export interface Dispute {
  id: string;
  trade_id: string;
  raised_by: string;
  reason: string;
  status: DisputeStatus;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: UserRole;
  kyc_status: KycStatus;
  is_suspended: boolean;
  profile_picture_url: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ListUsersResponse {
  users: AdminUser[];
}

export interface GetUserResponse {
  user: AdminUser;
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  profile_picture_url: string | null;
  created_at: string;
}

export interface AdminListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  label: string;  // e.g. "Mon", "Tue"
  value: string;  // count as string from DB
}

export interface VolumeByCurrency {
  currency: Currency;
  total_volume: string;
}

export interface TradeVolumeByCity {
  currency: Currency;
  total_foreign_volume: string;
  total_ngn_volume: string;
  total_trades: string;
}

export interface EscrowTVLEntry {
  currency: Currency;
  total_locked: string;
}

export interface AdminDashboardResponse {
  users: {
    total: string;
    active: string;
    suspended: string;
  };
  kyc: {
    total: string;
    pending: string;
    verified: string;
    rejected: string;
  };
  marketplace: {
    sabits: {
      total: string;
      active: string;
      completed: string;
    };
    disputes: {
      total: string;
      open: string;
      resolved: string;
    };
  };
  financials: {
    depositVolumes: VolumeByCity[];
    withdrawalVolumes: VolumeByCity[];
    tradeVolumes: TradeVolumeByCity[];
    escrowTVL: EscrowTVLEntry[];
  };
  pendingDeposits: Array<{
    id: string;
    amount: string;
    currency: Currency;
    rejection_reason: string | null;
    created_at: string;
  }>;
  recentKyc: Array<{
    id: string;
    status: KycStatus;
    document_type: string;
    user_name: string;
    user_username: string;
    user_profile_picture: string | null;
  }>;
  charts: {
    kycSubmissions: ChartDataPoint[];
    deposits: ChartDataPoint[];
    trades: ChartDataPoint[];
  };
}

export type VolumeByCity = VolumeByCurrency;

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — IMPACT ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

export interface ImpactAnalyticsResponse {
  scale: {
    allTimeLedgerVolume: Array<{
      currency: Currency;
      total_processed: string;
    }>;
  };
  traction: {
    userGrowth30Days: {
      recent_count: string;
      prev_count: string;
      growth_percentage: string;
    };
  };
  trustAndSafety: {
    tradeSafety: {
      total_trades: string;
      successful_trades: string;
      disputed_trades: string;
      dispute_rate_percentage: string;
    };
  };
  efficiency: {
    adminActions30Days: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — METRICS ANALYTICS  (GET /admin/analytics/metrics)
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeByCurrency {
  currency: Currency;
  total_trades: number;
  completed_trades: number;
  cancelled_trades: number;
  disputed_trades: number;
  /** NGN equivalent of completed volume, numeric string */
  lifetime_ngn_volume: string;
  /** Foreign currency volume of completed trades, numeric string */
  lifetime_foreign_volume: string;
  /** Average NGN trade size, numeric string */
  avg_trade_size_ngn: string;
  /** Average hours from trade creation to completion, null if no completed trades */
  avg_settlement_hours: string | null;
}

export interface DepositByCurrency {
  currency: Currency;
  total_deposits: number;
  completed_deposits: number;
  rejected_deposits: number;
  pending_deposits: number;
  /** Sum of completed deposit amounts, numeric string */
  total_volume: string;
}

export interface EscrowTvlEntry {
  currency: Currency;
  /** Current escrow balance locked in wallets, numeric string */
  locked_value: string;
}

export type MetricsGranularity = 'day' | 'week' | 'month';

export interface MonthlyUserGrowth {
  /**
   * Human-readable label for the bucket:
   * - day:   "Mon", "Tue", "Wed" ...
   * - week:  "Week 1", "Week 2" ...
   * - month: "Jan 26", "Feb 26" ...
   */
  label: string;
  new_users: number;
  cumulative_users: number;
}

export interface MonthlyTradeVolume {
  /** Same label format as MonthlyUserGrowth */
  label: string;
  completed_trades: number;
  /** New NGN volume for completed trades in this period only, numeric string */
  ngn_volume: string;
  /**
   * Running total NGN volume from the very beginning of history through this
   * period (includes all trades before the chart window via a baseline CTE).
   * Use this for a cumulative area/line chart — it never shows ₦0 for the
   * current (incomplete) month since it carries forward the prior total.
   */
  cumulative_ngn_volume: string;
}

export interface MetricsAnalyticsResponse {
  /** ISO 8601 timestamp of when this response was generated */
  generated_at: string;

  window: {
    /** ISO 8601 — start of analytics window */
    from: string;
    /** ISO 8601 — end of analytics window */
    to: string;
  };

  /** Controls how growth chart data is bucketed and labelled */
  granularity: MetricsGranularity;

  /** ISO 8601 — reference date used for "users_at_launch" */
  launch_date: string;

  users: {
    /** All-time platform snapshot — cumulative registrations */
    total_registered: number;
    /** KYC-verified AND not suspended (able to trade) */
    total_active: number;
    total_suspended: number;
    /** Users who registered on or before launch_date */
    users_at_launch: number;
    /** Users who registered within the analytics window */
    new_registrations: number;
    /** Distinct users with a completed ledger entry in the last 30 days (rolling, not window-scoped) */
    monthly_active_users: number;
    kyc: {
      verified: number;
      /** Percentage of total_registered who are KYC-verified */
      verified_pct: number;
      pending: number;
      rejected: number;
      unverified: number;
    };
  };

  kyc: {
    /** Total KYC submission rows (all attempts, all statuses) */
    total_submissions: number;
    verified_submissions: number;
    rejected_submissions: number;
    pending_submissions: number;
    /** Average hours between KYC submission and admin review. null if no reviewed records exist yet. */
    avg_verification_hours: number | null;
    /** Median hours between submission and admin review. null if no reviewed records exist yet. */
    median_verification_hours: number | null;
    /** Human-readable note when avg_verification_hours is null */
    avg_verification_hours_note: string | null;
    dropoff: {
      total_users: number;
      /** Users who registered but never submitted any KYC document */
      never_submitted: number;
      dropoff_rate_pct: number;
    };
    first_attempt: {
      /** Users who submitted at least one KYC document */
      total_submitted: number;
      first_attempt_verified: number;
      first_attempt_rejected: number;
      first_attempt_pending: number;
      /** % of users whose first KYC submission was approved */
      success_rate_pct: number;
    };
  };

  trades: {
    total_initiated: number;
    total_completed: number;
    total_cancelled: number;
    total_disputed: number;
    success_rate_pct: number;
    cancellation_rate_pct: number;
    /** All-time NGN volume from completed trades, numeric string */
    lifetime_ngn_volume: string;
    /** Average NGN value per completed trade, numeric string */
    avg_trade_size_ngn: string;
    /** Average hours from initiation to completion. null if no completed trades. */
    avg_settlement_hours: number | null;
    /** Breakdown per foreign currency (GBP / USD / CAD) */
    by_currency: TradeByCurrency[];
  };

  p2p: {
    active_listings: number;
    completed_listings: number;
    cancelled_listings: number;
    /** Distinct users who have ever created a sabit (listing) */
    total_sellers: number;
    /** Distinct users who have ever initiated a trade as buyer */
    total_buyers: number;
    /** Users with more than one completed trade (buyer or seller) */
    repeat_traders: number;
    /** Total users with at least one completed trade */
    users_who_traded: number;
    /** repeat_traders / users_who_traded * 100 */
    repeat_rate_pct: number;
    /** total disputes / completed trades * 100 */
    dispute_rate_pct: number;
    disputes: {
      total: number;
      open: number;
      resolved: number;
    };
  };

  escrow: {
    /** NGN value of all completed escrow cycles, numeric string */
    total_volume_ngn: string;
    completion_rate_pct: number;
    timeout_rate_pct: number;
    /** Number of trades currently in 'escrowed' status */
    currently_escrowed_trades: number;
    /** Current escrow balances locked in wallets, broken out by currency */
    live_tvl_by_currency: EscrowTvlEntry[];
  };

  deposits: {
    by_currency: DepositByCurrency[];
  };

  growth: {
    /** Last 12 calendar months of user registrations */
    user_growth_monthly: MonthlyUserGrowth[];
    /** Last 12 calendar months of P2P trade volume */
    trade_volume_monthly: MonthlyTradeVolume[];
  };

  platform: {
    pin_confirmation_window_minutes: number;
    bid_expiry_hours: number;
    background_jobs_count: number;
    supported_currencies: Currency[];
    kyc_process: string;
    deposit_ngn_provider: string;
    deposit_foreign_process: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN LOGS
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminLog {
  id: string;
  admin_id: string;
  action: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminLogsResponse {
  logs: AdminLog[];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCHANGE RATES
// ─────────────────────────────────────────────────────────────────────────────

export interface ExchangeRate {
  id: string;
  currency: Currency;
  buy_rate: string;
  sell_rate: string;
  updated_at: string;
}

export interface ExchangeRatesResponse {
  rates: ExchangeRate[];
}

export interface CompanyRate {
  id: string;
  currency: string;
  rate_ngn: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyRatesResponse {
  rates: CompanyRate[];
}

export interface CompanyRateResponse {
  rate: CompanyRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  status: NotificationStatus;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  user_id: string;
  wallet_id: string;
  type: LedgerType;
  amount: string;
  currency: Currency;
  status: 'completed' | 'pending' | 'reversed';
  reference_id: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface ConversionQuote {
  from_currency: Currency;
  to_currency: Currency;
  amount: string;
  converted_amount: string;
  rate: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// RATINGS
// ─────────────────────────────────────────────────────────────────────────────

export interface Rating {
  id: string;
  trade_id: string;
  rater_id: string;
  ratee_id: string;
  score: number;
  comment: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// BENEFICIARIES
// ─────────────────────────────────────────────────────────────────────────────

export interface Beneficiary {
  id: string;
  user_id: string;
  currency: Currency;
  account_name: string;
  account_number: string;
  bank_name: string;
  bank_code: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN SECURITY INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────────────

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SecurityEventType =
  | 'auth_failed'
  | 'invalid_token'
  | 'expired_token'
  | 'suspended_account_attempt'
  | 'forbidden'
  | 'unauthorized_admin'
  | 'invalid_otp'
  | 'otp_replay'
  | 'otp_rate_limited'
  | 'webhook_invalid_signature'
  | 'webhook_replay'
  | 'webhook_malformed'
  | 'rate_limited'
  | 'permission_denied'
  | 'account_locked'
  | string;

export interface SecurityEvent {
  id: string;
  event_type: string;
  severity: SecuritySeverity | string;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  path: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SecurityThreatWindow {
  from: string;
  to: string;
  total: number;
  high_severity: number;
  detection_rate: number;
  /** Share of actionable/structured event types (webhook/IAM/lockout/rate-limit). */
  actionable_share_pct?: number;
}

export interface SecurityThreatMetricsResponse {
  baseline: SecurityThreatWindow;
  current: SecurityThreatWindow;
  /**
   * Relative change in actionable-event share.
   * Positive = more structured detection mix (not “more attacks”).
   */
  improvement_pct: number;
  /** Relative change in HIGH+CRITICAL share — factual, not a quality score. */
  high_severity_share_delta_pct?: number;
  improvement_definition?: string;
  by_type: Array<{ event_type: string; count: number }>;
  generated_at: string;
}

export interface SecurityEventsListResponse {
  events: SecurityEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface SecurityAuditExtractResponse {
  admin_logs: Array<Record<string, unknown>>;
  security_events: Array<Record<string, unknown>>;
  permission_violations: Array<Record<string, unknown>>;
  from: string;
  to: string;
  generated_at: string;
}

export interface PermissionMatrixResponse {
  matrix: Array<{ permission: string; roles: UserRole[] }>;
}

export interface PlatformKpisResponse {
  period: {
    baseline_from: string;
    baseline_to: string;
    current_from: string;
    current_to: string;
  };
  uptime_30d_pct: number | null;
  transaction_success_pct: number | null;
  detection_improvement_pct: number;
  detection_method: 'actionable_share';
  intrusions_neutralized: number;
  vulnerability_gaps_closed: number;
  definitions: Record<string, string>;
  breakdown: Record<string, unknown>;
  synthetic: boolean;
  generated_at: string;
  snapshot_id?: string;
}

export interface PlatformKpiSnapshotsResponse {
  snapshots: Array<{
    id: string;
    period_from: string;
    period_to: string;
    uptime_30d_pct: number;
    transaction_success_pct: number;
    detection_improvement_pct: number;
    detection_method: string;
    intrusions_neutralized: number;
    vulnerability_gaps_closed: number;
    synthetic: boolean;
    generated_at: string;
    era: 'pre_jan_2025' | 'post_jan_2025';
    era_label: 'Before architecture' | 'After architecture';
  }>;
}
