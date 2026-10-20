# Google sign-in setup

FILM.UZ uses the official Google Identity Services authorization-code flow in popup mode. The browser sends the short-lived code to the backend with Google's recommended CSRF header. The backend exchanges the code using the client secret, verifies Google's signed ID token, then creates or retrieves the profile and sets an HTTP-only session cookie. The Client ID is public and is sent to the page; the Client Secret stays in server environment variables.

The website uses OAuth 2.0 through Google Identity Services. Google does not provide an “OAuth 3.0” flow.

## Google Cloud settings

Create or select a Google OAuth client with application type **Web application**, then configure the OAuth consent screen/Google Auth Platform branding and audience.

Add the exact site origins under **Authorized JavaScript origins**:

- Local: `http://127.0.0.1:8765`
- If you open the site with `localhost`: `http://localhost:8765`
- Production: `https://filmuz.app`
- Add `https://www.filmuz.app` too only if the site is served from that hostname.

Origins include the scheme and port, have no path, and must match the address used in the browser. If `PORT` is changed locally, add that port's origin as well. Do not use wildcard origins.

For popup mode, add the same site origins under **Authorized JavaScript origins** and leave **Authorized redirect URIs** empty; this flow has no separate callback page. Google GIS uses the calling page's origin as `redirect_uri` for the backend token exchange. If you later switch to redirect mode, add that exact callback URL under **Authorized redirect URIs**. Google recommends popup code mode for this flow and instructs that popup requests be checked with the `X-Requested-With` header. [Google GIS code model guide](https://developers.google.com/identity/oauth2/web/guides/use-code-model?hl=en), [Google GIS OAuth error guide](https://developers.google.com/identity/oauth2/web/guides/error?hl=en).

For local testing, add the Google account as a test user if the consent screen is in testing mode.

## Environment variables

Copy `.env.example` to `.env` for local development and set:

| Variable | Required | Purpose |
| --- | --- | --- |
| `FILMUZ_GOOGLE_CLIENT_ID` | Yes | The Web application client ID from Google Cloud. It is public; never put a Client Secret in the browser. |
| `FILMUZ_GOOGLE_CLIENT_SECRET` | Yes | The matching Web application client secret. Server only; keep it in `.env` locally and the host's secret environment settings in production. |
| `FILMUZ_SESSION_SECRET` | Yes for production; recommended locally | Random server-only value of at least 32 characters used to sign session cookies. Keep it stable between production restarts. |
| `PORT` | No | HTTP port; defaults to `8765`. |
| `FILMUZ_USERS_FILE` | No | Path for the JSON profile store; defaults to `.filmuz-users.json` in the project directory. Use a persistent disk path on hosts with ephemeral filesystems. |

Generate a session secret locally with Node.js, then paste the result into `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The `.env` file and profile store are ignored by Git. In production, define the variables in the hosting provider's server-side environment settings. Do not commit `.env`, the user profile store, or any Google Client Secret. The Client Secret is used only by the backend during Google's authorization-code exchange and is never sent to the browser.

## Run and sign in locally

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env`, set `FILMUZ_GOOGLE_CLIENT_ID`, `FILMUZ_GOOGLE_CLIENT_SECRET`, and `FILMUZ_SESSION_SECRET`. Use the secret belonging to the same OAuth Web client as the Client ID. If a secret was exposed in a chat or committed file, rotate it in Google Cloud and use the replacement.
3. From this folder, run `npm start`.
4. Open `http://127.0.0.1:8765/` (or the exact `localhost` origin you added in Google Cloud).
5. Open the account/profile control and select **Continue with Google**. Complete Google's sign-in prompt.
6. After sign-in, the account name and email should appear in the profile. Reload the page to confirm the session is restored, then use **Выйти** to confirm logout.

The Google account must be permitted by the consent screen's audience settings. If Google reports `origin_mismatch`, add the exact browser origin (including port) to **Authorized JavaScript origins**. Popup mode exchanges the code using that page origin; it does not navigate to a separate redirect page.

User profiles are stored by Google's stable account subject (`sub`) in `FILMUZ_USERS_FILE`; saved locations, routes, and projects remain in the website's existing browser local storage.
