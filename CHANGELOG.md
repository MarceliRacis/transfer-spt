# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-06-17

### Added
- **Helmet**: Integrated security headers (CSP, HSTS, etc.) for express.
- **Rate Limiting**: Added `express-rate-limit` to protect `/api` routes from brute-force and abuse.
- **OAuth State Parameter**: Implemented `state` parameter in the Spotify login flow to prevent CSRF during authorization.
- **Secure Sessions**: 
  - Session cookies are now `httpOnly` and `sameSite: 'lax'`.
  - Cookies are forced to `secure` in production.
  - Custom session cookie name `__spt_session`.
- **Production Safety**: The server now refuses to start in production if the default `SESSION_SECRET` is used.

### Changed
- **Error Handling**: Raw server errors are no longer leaked to the client; they are logged server-side, while clients receive generic error messages.
- **Trust Proxy**: Now conditionally enabled only when `NODE_ENV=production`.

### Fixed
- **Input Validation**: Added validation for job creation (types, intervals) and playlist creation (names).
- **Redis Initialization**: Wrapped Redis store calls to prevent errors if sessions are accessed before the Redis client is fully connected.
