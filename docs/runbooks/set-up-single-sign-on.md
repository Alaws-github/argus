# Set up single sign-on

**Who:** an admin. **You need:** an app registration with your identity provider (Microsoft Entra ID, Google Workspace, Okta or any OpenID Connect provider): its issuer URL, a client ID and a client secret.

1. Go to **People and roles** (account menu). Scroll to **Single sign-on**.
2. Copy the **redirect URI** shown and register it with the provider.
3. Fill in the button label (for example "Microsoft"), the issuer URL, the client ID and the client secret. Optionally limit sign-in to your email domains.
4. Tick **Turn on single sign-on** and save. The harness checks it can read the provider's settings.
5. Make sure each person who will use it has an account here with the same email. Single sign-on never creates accounts or changes roles.
6. Sign out and try **Sign in with ...** on the sign-in page.
7. Once it works for everyone, you can untick **People other than admins may still sign in with a password**. Admins always keep a password, so a broken provider can't lock everyone out.

This is a first version: no SAML, and signing out here doesn't sign you out of the provider. Multi-factor sign-in comes from the provider.
