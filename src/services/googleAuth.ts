import { api } from './api';

const BASE = import.meta.env.BASE_URL;

/** Sends the browser to Google's sign-in page. Google redirects back to the app root with an ID token in the URL hash. */
export async function startGoogleSignIn(clientId: string) {
  const nonce = await api.googleNonce();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}${BASE}`,
    response_type: 'id_token',
    scope: 'openid email profile',
    prompt: 'select_account',
    nonce,
    state: window.location.pathname,
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/** If the page was loaded from Google's redirect, strips the token from the URL and returns it. */
export function takeGoogleRedirect(): { idToken: string } | { error: string } | null {
  if (!window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const idToken = params.get('id_token');
  const error = params.get('error');
  if (!idToken && !error) return null;

  const state = params.get('state') ?? '';
  const returnPath = state.startsWith(BASE) && /^[\w/-]*$/.test(state) ? state : BASE;
  window.history.replaceState(null, '', returnPath);

  if (idToken) return { idToken };
  return { error: error === 'access_denied' ? 'Sign-in was cancelled' : 'Google sign-in failed' };
}
