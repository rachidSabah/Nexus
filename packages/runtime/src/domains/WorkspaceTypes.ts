/**
 * Workspace Domain Types
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  settings: OrganizationSettings;
  quotas: ResourceQuota;
  usage: UsageMetrics;
}

export interface OrganizationSettings {
  maxProjects: number;
  maxTeams: number;
  maxUsers: number;
  allowedProviders: string[];
  allowedModels: string[];
  dataResidency: string;
  complianceLevel: string;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  members: TeamMember[];
  roles: string[];
  permissions: string[];
  createdAt: Date;
}

export interface TeamMember {
  userId: string;
  role: string;
  joinedAt: Date;
}

export interface Project {
  id: string;
  organizationId: string;
  teamId?: string;
  name: string;
  slug: string;
  description?: string;
  environments: Environment[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Environment {
  id: string;
  projectId: string;
  name: 'development' | 'testing' | 'staging' | 'production' | string;
  slug: string;
  namespace: Namespace;
  variables: Record<string, string>;
  secrets: string[];
  providers: string[];
  policies: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Workspace {
  id: string;
  organizationId: string;
  projectId?: string;
  environmentId?: string;
  name: string;
  type: 'personal' | 'team' | 'project' | 'environment';
  namespaces: Namespace[];
  resources: ResourceAllocation;
  createdAt: Date;
  updatedAt: Date;
}

export interface Namespace {
  id: string;
  name: string;
  isolation: 'soft' | 'hard';
  resourceLimits: ResourceQuota;
  networkPolicy?: NetworkPolicy;
}

export interface NetworkPolicy {
  allowedEgress: string[];
  allowedIngress: string[];
  isolated: boolean;
}

export interface ResourceQuota {
  maxProviders: number;
  maxModels: number;
  maxWorkflows: number;
  maxPlugins: number;
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  maxStorageGB: number;
  maxBandwidthGB: number;
}

export interface ResourceAllocation {
  providers: number;
  models: number;
  workflows: number;
  plugins: number;
  storageGB: number;
  bandwidthGB: number;
}

export interface UsageMetrics {
  requestsTotal: number;
  requestsToday: number;
  requestsThisMonth: number;
  tokensUsed: number;
  costUSD: number;
  storageUsedGB: number;
  bandwidthUsedGB: number;
  lastUpdated: Date;
}
