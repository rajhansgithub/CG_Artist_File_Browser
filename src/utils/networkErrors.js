// The backend starts an error message with this marker when a network share needs a username and password.
const SIGN_IN_MARK = '[sign-in] ';

// Splits a backend error into the text to show and whether to offer a "Sign in" button.
export function parseNetworkError(message) {
  const text = String(message || '');
  if (text.startsWith(SIGN_IN_MARK)) {
    return { text: text.slice(SIGN_IN_MARK.length), needsSignIn: true };
  }
  return { text, needsSignIn: false };
}
