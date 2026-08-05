---
name: Security Policy
about: How to report security vulnerabilities in Agent Nexus Gateway
---

# Security Policy

## Supported Versions

We provide security updates for the latest minor release line. Older versions receive critical fixes only.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately using one of these channels:

1. **Preferred**: Use [GitHub Private Security Advisories](https://github.com/rachidSabah/codingghosts/security/advisories/new)
2. Email: `security@agent-nexus-gateway.dev` (if available)

Include the following in your report:

- Description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept)
- Affected versions
- Suggested mitigation or fix (optional)

We will acknowledge receipt within 48 hours and provide an initial assessment within 5 business days.

## Disclosure Policy

- We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure).
- We will credit reporters in release notes unless they prefer to remain anonymous.
- We request a 90-day embargo before public disclosure, but this is flexible for good-faith reports.

## Security Features

Agent Nexus Gateway implements:

- **Encrypted credential vault** (AES-256-GCM at rest, scrypt-derived master key)
- **RBAC** with wildcard permission matching
- **JWT authentication** (HS256 today; RS256/EdDSA planned)
- **Audit logging** of all authorization decisions
- **Zero Trust** architecture — no implicit trust between services
- **Input validation** on every HTTP endpoint (Zod schemas)
- **Rate limiting** (pluggable; adapter-level + global)
- **TLS** termination at the ingress layer
- **Secrets management** via env vars / vault — never logged

## Security Best Practices for Operators

1. **Never expose the gateway directly to the internet** without authentication. Always go through an authenticated ingress.
2. **Rotate your `AGENT_NEXUS_VAULT_KEY`** periodically. Lost keys mean lost secrets.
3. **Use the principle of least privilege** when assigning roles to API keys.
4. **Enable audit logging** and ship logs to a SIEM.
5. **Pin your Docker image** to a specific version, not `latest`.
6. **Run as a non-root user** in containers (the default Dockerfile does this).
7. **Use a reverse proxy** (nginx, Caddy, Cloudflare) for TLS termination.

## Threat Model

| Threat | Mitigation |
|---|---|
| Stolen API key | RBAC scopes limit blast radius; rotate via vault |
| Credential leak at rest | AES-256-GCM encryption with scrypt-derived key |
| Replay attack | JWT `exp` claim + nonce support (planned) |
| Supply chain compromise | Dependency review CI, lockfile pinning, CodeQL |
| DDoS | Rate limiting, circuit breakers, graceful degradation |
| SSRF | Network sandbox — outbound calls only through `NetworkPort` |
