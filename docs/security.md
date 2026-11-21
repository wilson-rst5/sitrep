# Security

Compose binds the web service to loopback and gives PostgreSQL and NATS no host port. Place an HTTPS reverse proxy in front of any LAN or remote deployment and configure exact Origin validation and secure cookies.

The application uses Argon2id for passwords, opaque session cookies with hashed tokens in PostgreSQL, a one-time administrator bootstrap condition protected by a random token, and role checks on administrator endpoints. Nginx bounds request sizes and rate limits authentication and API calls. Configure trusted client IP handling at your outer proxy if necessary.

Provider network requests are limited to fixed HTTPS endpoints with redirects disabled. Provider text renders as text. Health output contains classified failures. Private installation settings are stored in the database. The current deployment trusts containers attached to the Compose network, and the application database connection uses the installation database role. Restrict access to Docker administration.

Before publication, review the worktree and Git history with a secret scanner, audit dependencies and licences, and confirm the public build excludes private configuration and data.
