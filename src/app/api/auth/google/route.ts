import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

function getRedirectUri(request: NextRequest) {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/callback`;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(new URL('/?view=gmail&auth_error=missing_google_client_id', request.url));
  }

  const state = randomBytes(24).toString('base64url');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', getRedirectUri(request));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GMAIL_SCOPES.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('gmail_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
