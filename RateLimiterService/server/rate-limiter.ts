import { storage } from "./storage";
import type { RateLimitStatus, RateLimitConfig } from "@shared/schema";

export interface RateLimiterAlgorithm {
  checkLimit(clientId: string, config: RateLimitConfig): Promise<RateLimitStatus>;
}

export class TokenBucketLimiter implements RateLimiterAlgorithm {
  async checkLimit(clientId: string, config: RateLimitConfig): Promise<RateLimitStatus> {
    const activeLimit = await storage.getActiveRateLimit(clientId);
    const now = new Date();
    const windowMs = this.parseTimeWindow(config.timeWindow);
    
    if (!activeLimit) {
      // First request - create new bucket with full tokens
      const resetTime = new Date(now.getTime() + windowMs);
      await storage.upsertActiveRateLimit({
        clientId,
        requestCount: 1,
        resetTime,
        status: 'active',
      });
      
      return {
        allowed: true,
        remaining: config.requestLimit - 1,
        resetTime: resetTime.getTime(),
      };
    }
    
    // Check if bucket needs refill (time window has passed)
    if (now.getTime() >= activeLimit.resetTime.getTime()) {
      // Refill bucket - reset count and extend time window
      const resetTime = new Date(now.getTime() + windowMs);
      await storage.upsertActiveRateLimit({
        clientId,
        requestCount: 1,
        resetTime,
        status: 'active',
      });
      
      return {
        allowed: true,
        remaining: config.requestLimit - 1,
        resetTime: resetTime.getTime(),
      };
    }
    
    // Check if we have tokens available
    if (activeLimit.requestCount >= config.requestLimit) {
      // No tokens available, request denied
      return {
        allowed: false,
        remaining: 0,
        resetTime: activeLimit.resetTime.getTime(),
        retryAfter: Math.ceil((activeLimit.resetTime.getTime() - now.getTime()) / 1000),
      };
    }
    
    // Consume a token
    const newCount = activeLimit.requestCount + 1;
    const status = newCount >= config.requestLimit * 0.8 ? 'warning' : 'active';
    
    await storage.upsertActiveRateLimit({
      clientId,
      requestCount: newCount,
      resetTime: activeLimit.resetTime,
      status,
    });
    
    return {
      allowed: true,
      remaining: config.requestLimit - newCount,
      resetTime: activeLimit.resetTime.getTime(),
    };
  }
  
  private parseTimeWindow(timeWindow: string): number {
    const unit = timeWindow.slice(-1);
    const value = parseInt(timeWindow.slice(0, -1));
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000; // Default to 1 minute
    }
  }
}

export class SlidingWindowLimiter implements RateLimiterAlgorithm {
  private requestTimes: Map<string, number[]> = new Map();
  
  async checkLimit(clientId: string, config: RateLimitConfig): Promise<RateLimitStatus> {
    const now = Date.now();
    const windowMs = this.parseTimeWindow(config.timeWindow);
    const windowStart = now - windowMs;
    
    // Get request times for this client
    let times = this.requestTimes.get(clientId) || [];
    
    // Remove old requests outside the window
    times = times.filter(time => time > windowStart);
    
    // Check if limit exceeded
    if (times.length >= config.requestLimit) {
      const oldest = times[0];
      const retryAfter = Math.ceil((oldest - windowStart) / 1000);
      
      await storage.upsertActiveRateLimit({
        clientId,
        requestCount: times.length + 1,
        resetTime: new Date(oldest + windowMs),
        status: 'blocked',
      });
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: oldest + windowMs,
        retryAfter,
      };
    }
    
    // Add current request
    times.push(now);
    this.requestTimes.set(clientId, times);
    
    const remaining = config.requestLimit - times.length;
    const status = remaining <= config.requestLimit * 0.2 ? 'warning' : 'active';
    
    await storage.upsertActiveRateLimit({
      clientId,
      requestCount: times.length,
      resetTime: new Date(now + windowMs),
      status,
    });
    
    return {
      allowed: true,
      remaining,
      resetTime: now + windowMs,
    };
  }
  
  private parseTimeWindow(timeWindow: string): number {
    const unit = timeWindow.slice(-1);
    const value = parseInt(timeWindow.slice(0, -1));
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }
}

export class FixedWindowLimiter implements RateLimiterAlgorithm {
  async checkLimit(clientId: string, config: RateLimitConfig): Promise<RateLimitStatus> {
    const now = new Date();
    const windowMs = this.parseTimeWindow(config.timeWindow);
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const windowEnd = new Date(windowStart.getTime() + windowMs);
    
    const activeLimit = await storage.getActiveRateLimit(clientId);
    
    if (!activeLimit || activeLimit.resetTime.getTime() <= now.getTime()) {
      // New window or expired
      await storage.upsertActiveRateLimit({
        clientId,
        requestCount: 1,
        resetTime: windowEnd,
        status: 'active',
      });
      
      return {
        allowed: true,
        remaining: config.requestLimit - 1,
        resetTime: windowEnd.getTime(),
      };
    }
    
    // Check if limit exceeded
    if (activeLimit.requestCount >= config.requestLimit) {
      await storage.upsertActiveRateLimit({
        clientId,
        requestCount: activeLimit.requestCount + 1,
        resetTime: activeLimit.resetTime,
        status: 'blocked',
      });
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: activeLimit.resetTime.getTime(),
        retryAfter: Math.ceil((activeLimit.resetTime.getTime() - now.getTime()) / 1000),
      };
    }
    
    // Increment counter
    const newCount = activeLimit.requestCount + 1;
    const status = newCount >= config.requestLimit * 0.8 ? 'warning' : 'active';
    
    await storage.upsertActiveRateLimit({
      clientId,
      requestCount: newCount,
      resetTime: activeLimit.resetTime,
      status,
    });
    
    return {
      allowed: true,
      remaining: config.requestLimit - newCount,
      resetTime: activeLimit.resetTime.getTime(),
    };
  }
  
  private parseTimeWindow(timeWindow: string): number {
    const unit = timeWindow.slice(-1);
    const value = parseInt(timeWindow.slice(0, -1));
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }
}

export class RateLimiterService {
  private algorithms: Map<string, RateLimiterAlgorithm>;
  
  constructor() {
    this.algorithms = new Map();
    this.algorithms.set('token-bucket', new TokenBucketLimiter());
    this.algorithms.set('sliding-window', new SlidingWindowLimiter());
    this.algorithms.set('fixed-window', new FixedWindowLimiter());
  }
  
  async checkRateLimit(clientId: string, endpoint: string): Promise<RateLimitStatus> {
    const config = await storage.getRateLimitConfig();
    if (!config) {
      throw new Error('No rate limit configuration found');
    }
    
    const algorithm = this.algorithms.get(config.algorithm);
    if (!algorithm) {
      throw new Error(`Unknown algorithm: ${config.algorithm}`);
    }
    
    const result = await algorithm.checkLimit(clientId, config);
    
    // Update system stats
    await storage.updateSystemStats({
      totalRequests: (await storage.getSystemStats()).totalRequests + 1,
    });
    
    if (!result.allowed) {
      // Log violation
      await storage.createViolation({
        clientId,
        endpoint,
        attempts: 1,
        isBlocked: false,
      });
      
      // Update rate limited counter
      await storage.updateSystemStats({
        rateLimitedRequests: (await storage.getSystemStats()).rateLimited + 1,
      });
    }
    
    return result;
  }
  
  getClientId(req: any, config: { clientIdType: string }): string {
    switch (config.clientIdType) {
      case 'ip':
        return req.ip || 
               req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.connection.remoteAddress || 
               '127.0.0.1';
      case 'api-key':
        return req.headers['x-api-key'] || 
               req.headers['authorization']?.replace('Bearer ', '') || 
               'anonymous-api';
      case 'user-id':
        return req.user?.id || 
               req.headers['x-user-id'] || 
               req.headers['user-id'] || 
               'anonymous-user';
      default:
        return req.ip || '127.0.0.1';
    }
  }
}

export const rateLimiterService = new RateLimiterService();
