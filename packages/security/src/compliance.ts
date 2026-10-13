import {
  randomUUID,
  randomBytes,
  createSign,
  createVerify,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Asymmetric JWT Handler (RS256 & EdDSA) (@anx/security)
 * ───────────────────────────────────────────────────────────────────────────
 */
export class AsymmetricJwtHandler {
  constructor(
    private readonly privateKey?: string,
    private readonly publicKey?: string,
    private readonly issuer = 'agent-nexus-gateway',
  ) {}

  /**
   * Generates a new ephemeral RSA or Ed25519 keypair for test/runtime use.
   */
  static generateKeyPair(type: 'rsa' | 'ed25519' = 'rsa'): { publicKey: string; privateKey: string } {
    if (type === 'ed25519') {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      return { publicKey, privateKey };
    }
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
  }

  issueRs256(payload: Record<string, unknown>, ttlSeconds = 3600): string {
    if (!this.privateKey) throw new Error('Private key is required to issue RS256 token');
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iss: this.issuer, iat: now, exp: now + ttlSeconds };

    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${h}.${p}`);
    const sig = signer.sign(this.privateKey, 'base64url');
    return `${h}.${p}.${sig}`;
  }

  verifyRs256(token: string, publicKey = this.publicKey): Record<string, unknown> | null {
    if (!publicKey) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${h}.${p}`);
      const valid = verifier.verify(publicKey, Buffer.from(sig!, 'base64url'));
      if (!valid) return null;

      const payload = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (typeof payload['exp'] === 'number' && payload['exp'] < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  issueEdDsa(payload: Record<string, unknown>, ttlSeconds = 3600): string {
    if (!this.privateKey) throw new Error('Private key is required to issue EdDSA token');
    const header = { alg: 'EdDSA', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iss: this.issuer, iat: now, exp: now + ttlSeconds };

    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const data = Buffer.from(`${h}.${p}`);
    const sig = sign(null, data, this.privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  }

  verifyEdDsa(token: string, publicKey = this.publicKey): Record<string, unknown> | null {
    if (!publicKey) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    try {
      const data = Buffer.from(`${h}.${p}`);
      const sigBuf = Buffer.from(sig!, 'base64url');
      const valid = verify(null, data, publicKey, sigBuf);
      if (!valid) return null;

      const payload = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<string, unknown>;
      if (typeof payload['exp'] === 'number' && payload['exp'] < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * OAuth 2.0 Provider (@anx/security)
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUris?: readonly string[];
  readonly scopes?: readonly string[];
}

export class OAuth2Provider {
  private readonly clients = new Map<string, OAuthClient>();
  private readonly authCodes = new Map<string, { clientId: string; redirectUri: string; expiresAt: number }>();
  private readonly tokens = new Map<string, { clientId: string; expiresAt: number; scope: string }>();

  registerClient(client: OAuthClient): void {
    this.clients.set(client.clientId, client);
  }

  issueAuthCode(clientId: string, redirectUri: string): string {
    const code = `code_${randomUUID().replace(/-/g, '')}`;
    this.authCodes.set(code, {
      clientId,
      redirectUri,
      expiresAt: Date.now() + 600_000, // 10 minutes
    });
    return code;
  }

  handleTokenRequest(params: {
    grant_type: 'client_credentials' | 'authorization_code';
    client_id?: string;
    client_secret?: string;
    code?: string;
    redirect_uri?: string;
  }): { access_token: string; token_type: 'Bearer'; expires_in: number; scope: string } {
    if (params.grant_type === 'client_credentials') {
      const client = this.clients.get(params.client_id ?? '');
      if (!client || client.clientSecret !== params.client_secret) {
        throw new Error('Invalid client credentials');
      }
      const token = `anx_at_${randomBytes(24).toString('hex')}`;
      this.tokens.set(token, {
        clientId: client.clientId,
        expiresAt: Date.now() + 3600_000,
        scope: client.scopes?.join(' ') ?? 'gateway:access',
      });
      return { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: client.scopes?.join(' ') ?? 'gateway:access' };
    }

    if (params.grant_type === 'authorization_code') {
      const record = this.authCodes.get(params.code ?? '');
      if (!record || record.expiresAt < Date.now()) {
        throw new Error('Invalid or expired authorization code');
      }
      this.authCodes.delete(params.code!);
      const token = `anx_at_${randomBytes(24).toString('hex')}`;
      this.tokens.set(token, {
        clientId: record.clientId,
        expiresAt: Date.now() + 3600_000,
        scope: 'openid profile',
      });
      return { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'openid profile' };
    }

    throw new Error(`Unsupported grant_type`);
  }

  validateToken(token: string): boolean {
    const rec = this.tokens.get(token);
    if (!rec) return false;
    return rec.expiresAt > Date.now();
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SAML 2.0 SSO Handler (@anx/security)
 * ───────────────────────────────────────────────────────────────────────────
 */
export class SamlSsoHandler {
  constructor(
    private readonly idpEntrypoint: string,
    private readonly issuer: string = 'urn:agent-nexus:sp',
  ) {}

  generateAuthnRequest(acsUrl: string): { url: string; requestId: string } {
    const requestId = `_${randomUUID().replace(/-/g, '')}`;
    const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${requestId}" Version="2.0" IssueInstant="${new Date().toISOString()}" AssertionConsumerServiceURL="${acsUrl}"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${this.issuer}</saml:Issuer></samlp:AuthnRequest>`;
    const samlRequest = Buffer.from(xml, 'utf8').toString('base64');
    const url = `${this.idpEntrypoint}?SAMLRequest=${encodeURIComponent(samlRequest)}`;
    return { url, requestId };
  }

  parseSamlResponse(rawBase64: string): { nameId: string; attributes: Record<string, string> } {
    const xml = Buffer.from(rawBase64, 'base64').toString('utf8');
    const nameIdMatch = xml.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/i);
    const nameId = nameIdMatch ? nameIdMatch[1]! : 'unknown@domain.com';

    const attributes: Record<string, string> = {};
    const attrMatches = xml.matchAll(/<saml:Attribute Name="([^"]+)"[^>]*>\s*<saml:AttributeValue>([^<]+)<\/saml:AttributeValue>/gi);
    for (const m of attrMatches) {
      if (m[1] && m[2]) attributes[m[1]] = m[2];
    }
    return { nameId, attributes };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SCIM 2.0 Provisioning Engine (@anx/security)
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface ScimUser {
  readonly id: string;
  readonly userName: string;
  readonly active: boolean;
  name?: { formatted?: string; familyName?: string; givenName?: string };
  emails?: Array<{ value: string; primary?: boolean }>;
  roles?: string[];
}

export class ScimProvisioner {
  private readonly users = new Map<string, ScimUser>();

  createUser(user: Omit<ScimUser, 'id'>): ScimUser {
    const id = `usr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const created: ScimUser = { id, ...user };
    this.users.set(id, created);
    return created;
  }

  getUser(id: string): ScimUser | undefined {
    return this.users.get(id);
  }

  updateUser(id: string, patch: Partial<ScimUser>): ScimUser | undefined {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated: ScimUser = { ...existing, ...patch, id };
    this.users.set(id, updated);
    return updated;
  }

  deleteUser(id: string): boolean {
    return this.users.delete(id);
  }

  listUsers(startIndex = 1, count = 100): { totalResults: number; Resources: ScimUser[] } {
    const all = Array.from(this.users.values());
    const resources = all.slice(startIndex - 1, startIndex - 1 + count);
    return { totalResults: all.length, Resources: resources };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Built-in PII Redaction Engine (@anx/security)
 * ───────────────────────────────────────────────────────────────────────────
 */
export class PiiRedactor {
  private static readonly EMAIL_REGEX = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g;
  private static readonly SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
  private static readonly CREDIT_CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
  private static readonly PHONE_REGEX = /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g;
  private static readonly IP_REGEX = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g;

  redact(text: string): { redactedText: string; piiDetected: boolean; categories: string[] } {
    let out = text;
    const categories: string[] = [];

    if (PiiRedactor.EMAIL_REGEX.test(out)) {
      categories.push('email');
      out = out.replace(PiiRedactor.EMAIL_REGEX, '[EMAIL_REDACTED]');
    }
    if (PiiRedactor.SSN_REGEX.test(out)) {
      categories.push('ssn');
      out = out.replace(PiiRedactor.SSN_REGEX, '[SSN_REDACTED]');
    }
    if (PiiRedactor.CREDIT_CARD_REGEX.test(out)) {
      categories.push('credit_card');
      out = out.replace(PiiRedactor.CREDIT_CARD_REGEX, '[CREDIT_CARD_REDACTED]');
    }
    if (PiiRedactor.PHONE_REGEX.test(out)) {
      categories.push('phone');
      out = out.replace(PiiRedactor.PHONE_REGEX, '[PHONE_REDACTED]');
    }
    if (PiiRedactor.IP_REGEX.test(out)) {
      categories.push('ip_address');
      out = out.replace(PiiRedactor.IP_REGEX, '[IP_REDACTED]');
    }

    return {
      redactedText: out,
      piiDetected: categories.length > 0,
      categories,
    };
  }
}
