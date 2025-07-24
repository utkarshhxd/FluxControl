import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar, uuid, decimal, bigint, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for authentication
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User accounts for SaaS customers
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status").default("inactive"),
  subscriptionTier: varchar("subscription_tier").default("free"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// API keys for tenant access
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  prefix: varchar("prefix", { length: 20 }).notNull(),
  permissions: jsonb("permissions").default('["rate_limit"]'),
  rateLimit: integer("rate_limit").default(10000), // requests per hour
  isActive: boolean("is_active").default(true),
  lastUsed: timestamp("last_used"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// Subscription plans
export const subscriptionPlans = pgTable("subscription_plans", {
  id: varchar("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD"),
  billingInterval: varchar("billing_interval", { length: 20 }).notNull(), // monthly, yearly
  requestLimit: integer("request_limit").notNull(), // requests per month
  rateLimitConfigs: integer("rate_limit_configs").default(5),
  apiKeysLimit: integer("api_keys_limit").default(3),
  features: jsonb("features").default('[]'),
  stripeProductId: varchar("stripe_product_id"),
  stripePriceId: varchar("stripe_price_id"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Usage tracking for billing
export const usageMetrics = pgTable("usage_metrics", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  date: timestamp("date").notNull().defaultNow(),
  requestCount: integer("request_count").notNull().default(0),
  rateLimitedCount: integer("rate_limited_count").notNull().default(0),
  uniqueClients: integer("unique_clients").notNull().default(0),
  dataTransferred: bigint("data_transferred", { mode: "number" }).default(0),
});

// Tenant-specific rate limit configurations
export const rateLimitConfigs = pgTable("rate_limit_configs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  name: varchar("name", { length: 100 }).notNull().default("Default"),
  algorithm: text("algorithm").notNull(), // 'token-bucket', 'sliding-window', 'fixed-window'
  requestLimit: integer("request_limit").notNull(),
  timeWindow: text("time_window").notNull(), // '1s', '1m', '1h', '1d'
  clientIdType: text("client_id_type").notNull(), // 'ip', 'api-key', 'user-id'
  endpoints: jsonb("endpoints").default('["*"]'),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Rate limit violations with tenant context
export const rateLimitViolations = pgTable("rate_limit_violations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  clientId: text("client_id").notNull(),
  endpoint: text("endpoint").notNull(),
  attempts: integer("attempts").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  isBlocked: boolean("is_blocked").notNull().default(false),
  userAgent: varchar("user_agent", { length: 500 }),
  ipAddress: varchar("ip_address", { length: 45 }),
});

// Active rate limits with tenant context
export const activeRateLimits = pgTable("active_rate_limits", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  apiKeyId: uuid("api_key_id").references(() => apiKeys.id),
  clientId: text("client_id").notNull(),
  requestCount: integer("request_count").notNull().default(0),
  resetTime: timestamp("reset_time").notNull(),
  status: text("status").notNull(), // 'active', 'warning', 'blocked'
  lastRequest: timestamp("last_request").notNull().defaultNow(),
  algorithm: text("algorithm"),
}, (table) => [
  unique().on(table.clientId, table.userId),
]);

// System-wide statistics per tenant
export const systemStats = pgTable("system_stats", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id),
  totalRequests: bigint("total_requests", { mode: "number" }).notNull().default(0),
  rateLimitedRequests: bigint("rate_limited_requests", { mode: "number" }).notNull().default(0),
  activeClients: integer("active_clients").notNull().default(0),
  avgResponseTime: integer("avg_response_time").notNull().default(0),
  requestsToday: integer("requests_today").notNull().default(0),
  requestsThisMonth: integer("requests_this_month").notNull().default(0),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => [
  unique().on(table.userId),
]);

// Schema types and validators
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsed: true,
});

export const insertRateLimitConfigSchema = createInsertSchema(rateLimitConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertViolationSchema = createInsertSchema(rateLimitViolations).omit({
  id: true,
  timestamp: true,
});

export const insertActiveLimitSchema = createInsertSchema(activeRateLimits).omit({
  id: true,
  lastRequest: true,
});

export const insertSystemStatsSchema = createInsertSchema(systemStats).omit({
  id: true,
  timestamp: true,
});

export const insertUsageMetricsSchema = createInsertSchema(usageMetrics).omit({
  id: true,
  date: true,
});

// TypeScript types
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type UsageMetrics = typeof usageMetrics.$inferSelect;
export type InsertUsageMetrics = z.infer<typeof insertUsageMetricsSchema>;

export type RateLimitConfig = typeof rateLimitConfigs.$inferSelect;
export type InsertRateLimitConfig = z.infer<typeof insertRateLimitConfigSchema>;
export type RateLimitViolation = typeof rateLimitViolations.$inferSelect;
export type InsertRateLimitViolation = z.infer<typeof insertViolationSchema>;
export type ActiveRateLimit = typeof activeRateLimits.$inferSelect;
export type InsertActiveRateLimit = z.infer<typeof insertActiveLimitSchema>;
export type SystemStats = typeof systemStats.$inferSelect;
export type InsertSystemStats = z.infer<typeof insertSystemStatsSchema>;

// API response types
export type RateLimitStatus = {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
};

export type DashboardStats = {
  totalRequests: number;
  rateLimited: number;
  activeClients: number;
  avgResponseTime: number;
};

// SaaS specific types
export type TenantContext = {
  userId: string;
  apiKeyId?: string;
  subscriptionTier: string;
  requestLimit: number;
};

export type BillingUsage = {
  requestCount: number;
  rateLimitedCount: number;
  dataTransferred: number;
  period: 'daily' | 'monthly' | 'yearly';
};
