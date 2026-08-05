/**
 * Branded type helper for nominal typing over primitives.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Strongly-typed identifier for a request lifecycle.
 */
export type RequestId = Brand<string, 'RequestId'>;
export const asRequestId = (s: string): RequestId => s as RequestId;

/**
 * Strongly-typed identifier for a provider endpoint.
 */
export type EndpointId = Brand<string, 'EndpointId'>;
export const asEndpointId = (s: string): EndpointId => s as EndpointId;

/**
 * Strongly-typed identifier for a user / API key holder.
 */
export type UserId = Brand<string, 'UserId'>;
export const asUserId = (s: string): UserId => s as UserId;

/**
 * Strongly-typed identifier for an audit log entry.
 */
export type AuditLogId = Brand<string, 'AuditLogId'>;
export const asAuditLogId = (s: string): AuditLogId => s as AuditLogId;

/**
 * Strongly-typed identifier for a plugin instance.
 */
export type PluginId = Brand<string, 'PluginId'>;
export const asPluginId = (s: string): PluginId => s as PluginId;
