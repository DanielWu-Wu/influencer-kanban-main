export type AccountFailureKind = 'invalid' | 'unavailable';

export function isTransientAccountStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function classifyAccountFailure(status: number): AccountFailureKind {
  return isTransientAccountStatus(status) ? 'unavailable' : 'invalid';
}

export function classifyAuthVerificationError(status: number | undefined): AccountFailureKind {
  return status && status >= 400 && status < 500 && !isTransientAccountStatus(status)
    ? 'invalid'
    : 'unavailable';
}

export function shouldRefreshAccountSession(
  failure: AccountFailureKind,
  issueCode: string,
) {
  return failure === 'invalid' && issueCode === 'SESSION_INVALID';
}

export function shouldPreserveLastAccount(
  failure: AccountFailureKind,
  currentAccountId: string | null,
  expectedAccountId: string,
) {
  return failure === 'unavailable' && currentAccountId === expectedAccountId;
}
