export type AccountStatus = 'active' | 'disabled';

export type AccountProfile = {
  userId: string;
  email: string;
  displayName: string;
  status: AccountStatus;
  mustChangePassword: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt?: string;
};

export type AdminAccountSummary = AccountProfile;

export type AccountErrorCode =
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_NOT_PROVISIONED'
  | 'ACCOUNT_SERVICE_UNAVAILABLE'
  | 'SESSION_INVALID';

export type AccountIssue = {
  kind: 'invalid' | 'unavailable';
  code: AccountErrorCode;
  message: string;
};

export type AccountMeResponse = {
  success: true;
  data: AccountProfile;
} | {
  success: false;
  code: AccountErrorCode;
  error: string;
};
