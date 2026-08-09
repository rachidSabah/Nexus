/**
 * Gateway version — read from package.json at build time.
 * This is the single source of truth for the version string.
 * All endpoints (health, root, MCP server, marketplace) should use this.
 */
import pkg from '../package.json' with { type: 'json' };

export const GATEWAY_VERSION = pkg.version;
export const GATEWAY_DESCRIPTION = pkg.description;
