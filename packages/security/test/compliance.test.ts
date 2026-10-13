import { describe, expect, it } from 'vitest';
import {
  AsymmetricJwtHandler,
  OAuth2Provider,
  SamlSsoHandler,
  ScimProvisioner,
  PiiRedactor,
} from '../src/index.js';

describe('Security & Compliance (v0.7.0)', () => {
  describe('AsymmetricJwtHandler', () => {
    it('issues and verifies RS256 JWT tokens with keypairs', () => {
      const { publicKey, privateKey } = AsymmetricJwtHandler.generateKeyPair('rsa');
      const handler = new AsymmetricJwtHandler(privateKey, publicKey, 'test-issuer');

      const token = handler.issueRs256({ sub: 'admin-user', role: 'admin' }, 60);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const verified = handler.verifyRs256(token);
      expect(verified).not.toBeNull();
      expect(verified?.['sub']).toBe('admin-user');
      expect(verified?.['role']).toBe('admin');
      expect(verified?.['iss']).toBe('test-issuer');

      // Invalid signature check with alternative key
      const altKeys = AsymmetricJwtHandler.generateKeyPair('rsa');
      const invalidVerify = handler.verifyRs256(token, altKeys.publicKey);
      expect(invalidVerify).toBeNull();
    });

    it('issues and verifies EdDSA (Ed25519) JWT tokens', () => {
      const { publicKey, privateKey } = AsymmetricJwtHandler.generateKeyPair('ed25519');
      const handler = new AsymmetricJwtHandler(privateKey, publicKey, 'test-issuer');

      const token = handler.issueEdDsa({ sub: 'ed-user', scope: 'gateway:chat' }, 60);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);

      const verified = handler.verifyEdDsa(token);
      expect(verified).not.toBeNull();
      expect(verified?.['sub']).toBe('ed-user');
      expect(verified?.['scope']).toBe('gateway:chat');
    });
  });

  describe('OAuth2Provider', () => {
    it('handles client_credentials grant and token validation', () => {
      const oauth = new OAuth2Provider();
      oauth.registerClient({
        clientId: 'client-1',
        clientSecret: 'secret-xyz',
        scopes: ['gateway:chat', 'metrics:read'],
      });

      const res = oauth.handleTokenRequest({
        grant_type: 'client_credentials',
        client_id: 'client-1',
        client_secret: 'secret-xyz',
      });

      expect(res.access_token).toMatch(/^anx_at_/);
      expect(res.token_type).toBe('Bearer');
      expect(res.expires_in).toBe(3600);
      expect(res.scope).toBe('gateway:chat metrics:read');
      expect(oauth.validateToken(res.access_token)).toBe(true);
      expect(oauth.validateToken('invalid-token')).toBe(false);
    });

    it('handles authorization_code grant exchange', () => {
      const oauth = new OAuth2Provider();
      oauth.registerClient({
        clientId: 'client-web',
        clientSecret: 'secret-web',
      });

      const code = oauth.issueAuthCode('client-web', 'https://app.local/callback');
      expect(code).toMatch(/^code_/);

      const res = oauth.handleTokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'https://app.local/callback',
      });

      expect(res.access_token).toMatch(/^anx_at_/);
      expect(oauth.validateToken(res.access_token)).toBe(true);

      // Replay code fails
      expect(() => {
        oauth.handleTokenRequest({
          grant_type: 'authorization_code',
          code,
        });
      }).toThrow('Invalid or expired authorization code');
    });
  });

  describe('SamlSsoHandler', () => {
    it('generates AuthnRequest redirect URL with ID and ACS', () => {
      const saml = new SamlSsoHandler('https://idp.example.com/sso', 'urn:my-sp');
      const { url, requestId } = saml.generateAuthnRequest('https://sp.example.com/acs');

      expect(url).toContain('https://idp.example.com/sso?SAMLRequest=');
      expect(requestId).toMatch(/^_/);
    });

    it('parses SAML Response XML payload', () => {
      const saml = new SamlSsoHandler('https://idp.example.com/sso');
      const mockXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
            <saml:Subject>
              <saml:NameID>alice@enterprise.org</saml:NameID>
            </saml:Subject>
            <saml:AttributeStatement>
              <saml:Attribute Name="email">
                <saml:AttributeValue>alice@enterprise.org</saml:AttributeValue>
              </saml:Attribute>
              <saml:Attribute Name="department">
                <saml:AttributeValue>Engineering</saml:AttributeValue>
              </saml:Attribute>
            </saml:AttributeStatement>
          </saml:Assertion>
        </samlp:Response>
      `;
      const base64 = Buffer.from(mockXml, 'utf8').toString('base64');
      const parsed = saml.parseSamlResponse(base64);

      expect(parsed.nameId).toBe('alice@enterprise.org');
      expect(parsed.attributes['email']).toBe('alice@enterprise.org');
      expect(parsed.attributes['department']).toBe('Engineering');
    });
  });

  describe('ScimProvisioner', () => {
    it('supports user lifecycle CRUD operations', () => {
      const scim = new ScimProvisioner();

      const created = scim.createUser({
        userName: 'john.doe@example.com',
        active: true,
        roles: ['developer'],
      });

      expect(created.id).toMatch(/^usr_/);
      expect(scim.getUser(created.id)?.userName).toBe('john.doe@example.com');

      const updated = scim.updateUser(created.id, { active: false });
      expect(updated?.active).toBe(false);

      const list = scim.listUsers();
      expect(list.totalResults).toBe(1);
      expect(list.Resources[0]?.id).toBe(created.id);

      const deleted = scim.deleteUser(created.id);
      expect(deleted).toBe(true);
      expect(scim.getUser(created.id)).toBeUndefined();
    });
  });

  describe('PiiRedactor', () => {
    it('detects and redacts emails, SSNs, credit cards, phones, and IPs', () => {
      const redactor = new PiiRedactor();
      const text = 'User john@example.com with SSN 123-45-6789 card 4111-2222-3333-4444 call 555-867-5309 at 192.168.1.1';
      const result = redactor.redact(text);

      expect(result.piiDetected).toBe(true);
      expect(result.categories).toEqual(
        expect.arrayContaining(['email', 'ssn', 'credit_card', 'phone', 'ip_address'])
      );
      expect(result.redactedText).toContain('[EMAIL_REDACTED]');
      expect(result.redactedText).toContain('[SSN_REDACTED]');
      expect(result.redactedText).toContain('[CREDIT_CARD_REDACTED]');
      expect(result.redactedText).toContain('[PHONE_REDACTED]');
      expect(result.redactedText).toContain('[IP_REDACTED]');
      expect(result.redactedText).not.toContain('john@example.com');
      expect(result.redactedText).not.toContain('123-45-6789');
    });

    it('leaves clean text unaltered', () => {
      const redactor = new PiiRedactor();
      const text = 'Hello world, this is a clean query without any sensitive data.';
      const result = redactor.redact(text);
      expect(result.piiDetected).toBe(false);
      expect(result.categories).toHaveLength(0);
      expect(result.redactedText).toBe(text);
    });
  });
});
