import {
  users,
  apiKeys,
  rateLimitConfigs,
  rateLimitViolations,
  activeRateLimits,
  systemStats,
  usageMetrics,
  type User,
  type UpsertUser,
  type ApiKey,
  type InsertApiKey,
  type RateLimitConfig,
  type InsertRateLimitConfig,
  type RateLimitViolation,
  type InsertRateLimitViolation,
  type ActiveRateLimit,
  type InsertActiveRateLimit,
  type SystemStats,
  type InsertSystemStats,
  type UsageMetrics,
  type InsertUsageMetrics,
  type DashboardStats,
  type TenantContext,
} from "@shared/schema";

export interface IStorage {
  // User operations (for SaaS customers)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // API key operations
  createApiKey(data: InsertApiKey & { key: string }): Promise<ApiKey>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined>;
  getUserApiKeys(userId: string): Promise<ApiKey[]>;
  updateApiKeyUsage(keyId: string): Promise<void>;
  
  // Rate limit configs (per tenant)
  getRateLimitConfig(tenantContext?: TenantContext): Promise<RateLimitConfig | undefined>;
  updateRateLimitConfig(config: InsertRateLimitConfig, tenantContext?: TenantContext): Promise<RateLimitConfig>;
  getUserRateLimitConfigs(userId: string): Promise<RateLimitConfig[]>;
  
  // Active rate limits (per tenant)
  getActiveRateLimit(clientId: string, tenantContext?: TenantContext): Promise<ActiveRateLimit | undefined>;
  upsertActiveRateLimit(limit: InsertActiveRateLimit, tenantContext?: TenantContext): Promise<ActiveRateLimit>;
  getAllActiveRateLimits(tenantContext?: TenantContext): Promise<ActiveRateLimit[]>;
  deleteActiveRateLimit(clientId: string, tenantContext?: TenantContext): Promise<void>;
  
  // Violations (per tenant)
  createViolation(violation: InsertRateLimitViolation, tenantContext?: TenantContext): Promise<RateLimitViolation>;
  getRecentViolations(limit?: number, tenantContext?: TenantContext): Promise<RateLimitViolation[]>;
  blockClient(clientId: string, tenantContext?: TenantContext): Promise<void>;
  
  // System stats (per tenant)
  getSystemStats(tenantContext?: TenantContext): Promise<DashboardStats>;
  updateSystemStats(stats: Partial<InsertSystemStats>, tenantContext?: TenantContext): Promise<void>;
  
  // Usage tracking for billing
  recordUsage(metrics: InsertUsageMetrics): Promise<UsageMetrics>;
  getUserUsage(userId: string, period: 'daily' | 'monthly'): Promise<UsageMetrics[]>;
  
  // Cleanup
  cleanupExpiredLimits(): Promise<void>;
}

export class MemStorage implements IStorage {
  private configs: Map<number, RateLimitConfig>;
  private activeLimits: Map<string, ActiveRateLimit>;
  private violations: RateLimitViolation[];
  private stats: SystemStats;
  private users: Map<string, User>;
  private apiKeys: Map<string, ApiKey>;
  private usageMetrics: UsageMetrics[];
  private currentId: number;

  constructor() {
    this.configs = new Map();
    this.activeLimits = new Map();
    this.violations = [];
    this.users = new Map();
    this.apiKeys = new Map();
    this.usageMetrics = [];
    this.currentId = 1;
    
    // Initialize with default config
    const defaultConfig: RateLimitConfig = {
      id: 1,
      name: 'Default Config',
      algorithm: 'fixed-window',
      requestLimit: 100,
      timeWindow: '1m',
      clientIdType: 'ip',
      isActive: true,
      createdAt: new Date(),
      updatedAt: null,
      userId: null,
      apiKeyId: null,
      endpoints: null,
    };
    this.configs.set(1, defaultConfig);
    
    // Initialize stats
    this.stats = {
      id: 1,
      userId: null,
      totalRequests: 0,
      rateLimitedRequests: 0,
      activeClients: 0,
      avgResponseTime: 0,
      requestsToday: 0,
      requestsThisMonth: 0,
      timestamp: new Date(),
    };
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const user: User = {
      id: userData.id || `user_${this.currentId++}`,
      email: userData.email ?? null,
      firstName: userData.firstName ?? null,
      lastName: userData.lastName ?? null,
      profileImageUrl: userData.profileImageUrl ?? null,
      stripeCustomerId: userData.stripeCustomerId ?? null,
      stripeSubscriptionId: userData.stripeSubscriptionId ?? null,
      subscriptionStatus: userData.subscriptionStatus ?? null,
      subscriptionTier: userData.subscriptionTier ?? null,
      createdAt: userData.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  // API key operations
  async createApiKey(data: InsertApiKey & { key: string }): Promise<ApiKey> {
    const apiKey: ApiKey = {
      id: `key_${this.currentId++}`,
      name: data.name,
      userId: data.userId,
      keyHash: data.keyHash,
      prefix: data.prefix,
      permissions: data.permissions,
      rateLimit: data.rateLimit ?? null,
      isActive: data.isActive ?? null,
      lastUsed: null,
      expiresAt: data.expiresAt ?? null,
      createdAt: new Date(),
    };
    this.apiKeys.set(apiKey.keyHash, apiKey);
    return apiKey;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    return this.apiKeys.get(keyHash);
  }

  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    return Array.from(this.apiKeys.values()).filter(key => key.userId === userId);
  }

  async updateApiKeyUsage(keyId: string): Promise<void> {
    const apiKey = Array.from(this.apiKeys.values()).find(key => key.id === keyId);
    if (apiKey) {
      apiKey.lastUsed = new Date();
      this.apiKeys.set(apiKey.keyHash, apiKey);
    }
  }

  // Rate limit config operations
  async getUserRateLimitConfigs(userId: string): Promise<RateLimitConfig[]> {
    return Array.from(this.configs.values()).filter(config => config.userId === userId);
  }

  async getRateLimitConfig(): Promise<RateLimitConfig | undefined> {
    return Array.from(this.configs.values()).find(config => config.isActive);
  }

  async updateRateLimitConfig(configData: InsertRateLimitConfig): Promise<RateLimitConfig> {
    const id = this.currentId++;
    const config: RateLimitConfig = {
      id,
      name: configData.name ?? 'Default Config',
      algorithm: configData.algorithm,
      requestLimit: configData.requestLimit,
      timeWindow: configData.timeWindow,
      clientIdType: configData.clientIdType,
      isActive: configData.isActive ?? true,
      createdAt: new Date(),
      updatedAt: null,
      userId: configData.userId ?? null,
      apiKeyId: configData.apiKeyId ?? null,
      endpoints: configData.endpoints ?? null,
    };
    
    // Deactivate old configs
    Array.from(this.configs.entries()).forEach(([key, oldConfig]) => {
      this.configs.set(key, { ...oldConfig, isActive: false });
    });
    
    // Clear all active limits when configuration changes
    this.activeLimits.clear();
    
    this.configs.set(id, config);
    return config;
  }

  async getActiveRateLimit(clientId: string): Promise<ActiveRateLimit | undefined> {
    return this.activeLimits.get(clientId);
  }

  async upsertActiveRateLimit(limitData: InsertActiveRateLimit): Promise<ActiveRateLimit> {
    const existing = this.activeLimits.get(limitData.clientId);
    const id = existing ? existing.id : this.currentId++;
    
    const limit: ActiveRateLimit = {
      id,
      userId: limitData.userId ?? null,
      status: limitData.status,
      apiKeyId: limitData.apiKeyId ?? null,
      algorithm: limitData.algorithm ?? null,
      clientId: limitData.clientId,
      requestCount: limitData.requestCount ?? 0,
      resetTime: limitData.resetTime,
      lastRequest: new Date(),
    };
    
    this.activeLimits.set(limitData.clientId, limit);
    return limit;
  }

  async getAllActiveRateLimits(): Promise<ActiveRateLimit[]> {
    return Array.from(this.activeLimits.values()).sort(
      (a, b) => b.lastRequest.getTime() - a.lastRequest.getTime()
    );
  }

  async deleteActiveRateLimit(clientId: string): Promise<void> {
    this.activeLimits.delete(clientId);
  }

  async createViolation(violationData: InsertRateLimitViolation): Promise<RateLimitViolation> {
    const id = this.currentId++;
    const violation: RateLimitViolation = {
      id,
      userId: violationData.userId ?? null,
      apiKeyId: violationData.apiKeyId ?? null,
      clientId: violationData.clientId,
      endpoint: violationData.endpoint,
      attempts: violationData.attempts,
      timestamp: new Date(),
      isBlocked: violationData.isBlocked ?? false,
      userAgent: violationData.userAgent ?? null,
      ipAddress: violationData.ipAddress ?? null,
    };
    
    this.violations.unshift(violation);
    
    // Keep only the last 100 violations
    if (this.violations.length > 100) {
      this.violations = this.violations.slice(0, 100);
    }
    
    return violation;
  }

  async getRecentViolations(limit: number = 50): Promise<RateLimitViolation[]> {
    return this.violations.slice(0, limit);
  }

  async blockClient(clientId: string): Promise<void> {
    const activeLimit = this.activeLimits.get(clientId);
    if (activeLimit) {
      this.activeLimits.set(clientId, {
        ...activeLimit,
        status: 'blocked',
      });
    }
    
    // Mark recent violations as blocked
    this.violations = this.violations.map(violation =>
      violation.clientId === clientId
        ? { ...violation, isBlocked: true }
        : violation
    );
  }

  async getSystemStats(): Promise<DashboardStats> {
    return {
      totalRequests: this.stats.totalRequests,
      rateLimited: this.stats.rateLimitedRequests,
      activeClients: this.activeLimits.size,
      avgResponseTime: this.stats.avgResponseTime,
    };
  }

  async updateSystemStats(statsData: Partial<InsertSystemStats>): Promise<void> {
    this.stats = {
      ...this.stats,
      ...statsData,
      timestamp: new Date(),
    };
  }

  async recordUsage(metrics: InsertUsageMetrics): Promise<UsageMetrics> {
    const usage: UsageMetrics = {
      id: `usage_${this.currentId++}`,
      userId: metrics.userId,
      date: new Date(),
      requestCount: metrics.requestCount ?? 0,
      rateLimitedCount: metrics.rateLimitedCount ?? 0,
      dataTransferred: metrics.dataTransferred ?? null,
      uniqueClients: metrics.uniqueClients ?? 0,
    };
    this.usageMetrics.push(usage);
    return usage;
  }

  async getUserUsage(userId: string, period: 'daily' | 'monthly'): Promise<UsageMetrics[]> {
    const days = period === 'daily' ? 1 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.usageMetrics
      .filter(metric => metric.userId === userId && metric.date >= since)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  async cleanupExpiredLimits(): Promise<void> {
    const now = new Date();
    Array.from(this.activeLimits.entries()).forEach(([clientId, limit]) => {
      if (limit.resetTime.getTime() < now.getTime()) {
        this.activeLimits.delete(clientId);
      }
    });
  }
}

export const storage = new MemStorage();