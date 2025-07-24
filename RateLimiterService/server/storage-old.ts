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
// import { db } from "./db"; // Commented out since we're using MemStorage
import { eq, and, desc, sql } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";

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

export class DatabaseStorage {
  // Commented out since we're using MemStorage - keeping for reference
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // API key operations
  async createApiKey(data: InsertApiKey & { key: string }): Promise<ApiKey> {
    const keyHash = createHash('sha256').update(data.key).digest('hex');
    const prefix = data.key.substring(0, 8);
    
    const [apiKey] = await db
      .insert(apiKeys)
      .values({
        ...data,
        keyHash,
        prefix,
      })
      .returning();
    return apiKey;
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));
    return apiKey;
  }

  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    return await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId));
  }

  async updateApiKeyUsage(keyId: string): Promise<void> {
    await db
      .update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.id, keyId));
  }

  // Rate limit configs - fallback to demo mode for now
  async getRateLimitConfig(tenantContext?: TenantContext): Promise<RateLimitConfig | undefined> {
    // Try to get from database first
    let whereClause = eq(rateLimitConfigs.isActive, true);
    
    if (tenantContext?.userId) {
      whereClause = and(
        eq(rateLimitConfigs.isActive, true),
        eq(rateLimitConfigs.userId, tenantContext.userId)
      );
    }
    
    const [config] = await db
      .select()
      .from(rateLimitConfigs)
      .where(whereClause)
      .limit(1);
    
    // If no config exists, create default demo config
    if (!config) {
      const defaultConfig = {
        name: "Demo Configuration",
        algorithm: "fixed-window" as const,
        requestLimit: 100,
        timeWindow: "60s",
        clientIdType: "ip" as const,
        endpoints: ["*"],
        isActive: true,
        userId: tenantContext?.userId || null,
        apiKeyId: tenantContext?.apiKeyId || null,
      };
      
      const [newConfig] = await db
        .insert(rateLimitConfigs)
        .values(defaultConfig)
        .returning();
      
      return newConfig;
    }
    
    return config;
  }

  async updateRateLimitConfig(configData: InsertRateLimitConfig, tenantContext?: TenantContext): Promise<RateLimitConfig> {
    const data = {
      ...configData,
      userId: tenantContext?.userId || null,
      apiKeyId: tenantContext?.apiKeyId || null,
      name: configData.name || "Default",
      updatedAt: new Date(),
    };

    // First, deactivate existing configs for this tenant
    if (tenantContext?.userId) {
      await db
        .update(rateLimitConfigs)
        .set({ isActive: false })
        .where(eq(rateLimitConfigs.userId, tenantContext.userId));
    } else {
      await db
        .update(rateLimitConfigs)
        .set({ isActive: false })
        .where(sql`${rateLimitConfigs.userId} IS NULL`);
    }

    // Insert new config
    const [config] = await db
      .insert(rateLimitConfigs)
      .values(data)
      .returning();
    
    return config;
  }

  async getUserRateLimitConfigs(userId: string): Promise<RateLimitConfig[]> {
    return await db
      .select()
      .from(rateLimitConfigs)
      .where(eq(rateLimitConfigs.userId, userId));
  }

  // Active rate limits
  async getActiveRateLimit(clientId: string, tenantContext?: TenantContext): Promise<ActiveRateLimit | undefined> {
    let whereCondition = eq(activeRateLimits.clientId, clientId);
    
    if (tenantContext?.userId) {
      whereCondition = and(
        eq(activeRateLimits.clientId, clientId),
        eq(activeRateLimits.userId, tenantContext.userId)
      ) as any;
    }
    
    const [limit] = await db.select().from(activeRateLimits).where(whereCondition);
    return limit;
  }

  async upsertActiveRateLimit(limitData: InsertActiveRateLimit, tenantContext?: TenantContext): Promise<ActiveRateLimit> {
    const data = {
      ...limitData,
      userId: tenantContext?.userId || null,
      apiKeyId: tenantContext?.apiKeyId || null,
    };

    const [limit] = await db
      .insert(activeRateLimits)
      .values(data)
      .onConflictDoUpdate({
        target: [activeRateLimits.clientId, activeRateLimits.userId],
        set: { 
          ...data,
          lastRequest: new Date(),
        },
      })
      .returning();
    return limit;
  }

  async getAllActiveRateLimits(tenantContext?: TenantContext): Promise<ActiveRateLimit[]> {
    if (tenantContext?.userId) {
      return await db.select().from(activeRateLimits).where(eq(activeRateLimits.userId, tenantContext.userId));
    }
    
    return await db.select().from(activeRateLimits);
  }

  async deleteActiveRateLimit(clientId: string, tenantContext?: TenantContext): Promise<void> {
    if (tenantContext?.userId) {
      await db.delete(activeRateLimits).where(and(
        eq(activeRateLimits.clientId, clientId),
        eq(activeRateLimits.userId, tenantContext.userId)
      ));
    } else {
      await db.delete(activeRateLimits).where(eq(activeRateLimits.clientId, clientId));
    }
  }

  // Violations
  async createViolation(violationData: InsertRateLimitViolation, tenantContext?: TenantContext): Promise<RateLimitViolation> {
    const data = {
      ...violationData,
      userId: tenantContext?.userId || null,
      apiKeyId: tenantContext?.apiKeyId || null,
      userAgent: null,
      ipAddress: null,
    };

    const [violation] = await db
      .insert(rateLimitViolations)
      .values(data)
      .returning();
    return violation;
  }

  async getRecentViolations(limit: number = 50, tenantContext?: TenantContext): Promise<RateLimitViolation[]> {
    let query = db.select().from(rateLimitViolations);
    
    if (tenantContext?.userId) {
      query = query.where(eq(rateLimitViolations.userId, tenantContext.userId));
    }
    
    return await query
      .orderBy(desc(rateLimitViolations.timestamp))
      .limit(limit);
  }

  async blockClient(clientId: string, tenantContext?: TenantContext): Promise<void> {
    let updateQuery = db
      .update(activeRateLimits)
      .set({ status: "blocked" })
      .where(eq(activeRateLimits.clientId, clientId));
    
    if (tenantContext?.userId) {
      updateQuery = updateQuery.where(and(
        eq(activeRateLimits.clientId, clientId),
        eq(activeRateLimits.userId, tenantContext.userId)
      ));
    }
    
    await updateQuery;
  }

  // System stats
  async getSystemStats(tenantContext?: TenantContext): Promise<DashboardStats> {
    let query = db.select().from(systemStats);
    
    if (tenantContext?.userId) {
      query = query.where(eq(systemStats.userId, tenantContext.userId));
    }
    
    const [stats] = await query.limit(1);
    
    if (!stats) {
      // Create default stats entry
      const defaultStats = {
        totalRequests: 0,
        rateLimitedRequests: 0,
        activeClients: 0,
        avgResponseTime: 0,
        requestsToday: 0,
        requestsThisMonth: 0,
        userId: tenantContext?.userId || null,
      };
      
      await db.insert(systemStats).values(defaultStats);
      
      return {
        totalRequests: 0,
        rateLimited: 0,
        activeClients: 0,
        avgResponseTime: 0,
      };
    }

    return {
      totalRequests: Number(stats.totalRequests),
      rateLimited: Number(stats.rateLimitedRequests),
      activeClients: stats.activeClients,
      avgResponseTime: stats.avgResponseTime,
    };
  }

  async updateSystemStats(statsData: Partial<InsertSystemStats>, tenantContext?: TenantContext): Promise<void> {
    const userId = tenantContext?.userId || null;
    
    // First try to find existing stats
    let query = db.select().from(systemStats);
    if (userId) {
      query = query.where(eq(systemStats.userId, userId));
    } else {
      query = query.where(sql`${systemStats.userId} IS NULL`);
    }
    
    const [existingStats] = await query.limit(1);
    
    if (existingStats) {
      // Update existing stats
      let updateQuery = db.update(systemStats).set({
        ...statsData,
        timestamp: new Date(),
      });
      
      if (userId) {
        updateQuery = updateQuery.where(eq(systemStats.userId, userId));
      } else {
        updateQuery = updateQuery.where(sql`${systemStats.userId} IS NULL`);
      }
      
      await updateQuery;
    } else {
      // Insert new stats
      await db.insert(systemStats).values({
        totalRequests: 0,
        rateLimitedRequests: 0,
        activeClients: 0,
        avgResponseTime: 0,
        requestsToday: 0,
        requestsThisMonth: 0,
        ...statsData,
        userId,
        timestamp: new Date(),
      });
    }
  }

  // Usage tracking
  async recordUsage(metrics: InsertUsageMetrics): Promise<UsageMetrics> {
    const [usage] = await db
      .insert(usageMetrics)
      .values(metrics)
      .returning();
    return usage;
  }

  async getUserUsage(userId: string, period: 'daily' | 'monthly'): Promise<UsageMetrics[]> {
    const days = period === 'daily' ? 1 : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    return await db
      .select()
      .from(usageMetrics)
      .where(and(
        eq(usageMetrics.userId, userId),
        sql`${usageMetrics.date} >= ${since}`
      ))
      .orderBy(desc(usageMetrics.date));
  }

  // Cleanup
  async cleanupExpiredLimits(): Promise<void> {
    const now = new Date();
    await db
      .delete(activeRateLimits)
      .where(sql`${activeRateLimits.resetTime} < ${now}`);
  }
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
      email: userData.email || null,
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      profileImageUrl: userData.profileImageUrl || null,
      stripeCustomerId: userData.stripeCustomerId || null,
      stripeSubscriptionId: userData.stripeSubscriptionId || null,
      subscriptionStatus: userData.subscriptionStatus || null,
      subscriptionTier: userData.subscriptionTier || null,
      createdAt: userData.createdAt || new Date(),
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
      rateLimit: data.rateLimit || null,
      isActive: data.isActive || null,
      lastUsed: null,
      expiresAt: data.expiresAt || null,
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
      name: configData.name || 'Default Config',
      algorithm: configData.algorithm,
      requestLimit: configData.requestLimit,
      timeWindow: configData.timeWindow,
      clientIdType: configData.clientIdType,
      isActive: configData.isActive ?? true,
      createdAt: new Date(),
      updatedAt: null,
      userId: configData.userId || null,
      apiKeyId: configData.apiKeyId || null,
      endpoints: configData.endpoints || null,
    };
    
    // Deactivate old configs
    Array.from(this.configs.entries()).forEach(([key, oldConfig]) => {
      this.configs.set(key, { ...oldConfig, isActive: false });
    });
    
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
      userId: limitData.userId || null,
      status: limitData.status,
      apiKeyId: limitData.apiKeyId || null,
      algorithm: limitData.algorithm || null,
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
      ...violationData,
      id,
      timestamp: new Date(),
      isBlocked: violationData.isBlocked ?? false,
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
