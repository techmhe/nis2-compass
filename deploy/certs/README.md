# Custom CA certificates

Place PEM files of your internal certificate authority here (not committed to git).

- `acme-ca-root.pem`: root (and intermediate) certificate of your internal ACME CA. Caddy uses it to trust the ACME
  directory when `TLS_ISSUER=acme` or `acme_eab`. Another file name can be set with `ACME_CA_ROOT`.
- Every `*.pem` / `*.crt` file here is also added to the app's trust store, so the app can reach an OIDC issuer,
  AI endpoint or SMTP server whose certificates are issued by the internal CA.

Only public certificates belong here, never private keys.
