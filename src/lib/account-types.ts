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

export type AccountMeResponse = {
  success: true;
  data: AccountProfile;
};
