import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { storage } from "./storage";
import { rateLimiterService } from "./rate-limiter";
import { insertRateLimitConfigSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // WebSocket for real-time updates
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/ws'
  });
  
  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    
    ws.on('close', () => {
      console.log('Client disconnected from WebSocket');
    });
  });
  
  // Broadcast function for real-time updates
  const broadcast = (data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify(data));
      }
    });
  };
  
  // Rate limiting middleware
  app.use('/api/protected/*', async (req, res, next) => {
    try {
      const config = await storage.getRateLimitConfig();
      if (!config) {
        return next();
      }
      
      const clientId = rateLimiterService.getClientId(req, config);
      const result = await rateLimiterService.checkRateLimit(clientId, req.path);
      
      // Update total requests counter
      const stats = await storage.getSystemStats();
      await storage.updateSystemStats({ 
        totalRequests: stats.totalRequests + 1 
      });
      
      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': config.requestLimit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
      });
      
      if (result.retryAfter) {
        res.set('Retry-After', result.retryAfter.toString());
      }
      
      if (!result.allowed) {
        // Update rate limited counter
        await storage.updateSystemStats({ 
          rateLimitedRequests: stats.rateLimited + 1 
        });
        
        // Create violation record
        await storage.createViolation({
          clientId,
          endpoint: req.path,
          attempts: 1,
          isBlocked: false,
        });
        
        // Broadcast real-time update
        broadcast({
          type: 'stats_updated',
          stats: await storage.getSystemStats(),
        });
        
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests. Try again in ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter,
        });
      }
      
      // Broadcast real-time update for successful requests
      broadcast({
        type: 'rate_limit_update',
        clientId,
        remaining: result.remaining,
        resetTime: result.resetTime,
      });
      
      broadcast({
        type: 'stats_updated',
        stats: await storage.getSystemStats(),
      });
      
      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      next();
    }
  });
  
  // Get current rate limit configuration
  app.get('/api/config', async (req, res) => {
    try {
      const config = await storage.getRateLimitConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get configuration' });
    }
  });
  
  // Update rate limit configuration
  app.post('/api/config', async (req, res) => {
    try {
      const configData = insertRateLimitConfigSchema.parse(req.body);
      const config = await storage.updateRateLimitConfig(configData);
      
      broadcast({
        type: 'config_updated',
        config,
      });
      
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: 'Invalid configuration data' });
    }
  });
  
  // Get system statistics
  app.get('/api/stats', async (req, res) => {
    try {
      const stats = await storage.getSystemStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get statistics' });
    }
  });
  
  // Get active rate limits
  app.get('/api/active-limits', async (req, res) => {
    try {
      const limits = await storage.getAllActiveRateLimits();
      res.json(limits);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get active limits' });
    }
  });
  
  // Get recent violations
  app.get('/api/violations', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const violations = await storage.getRecentViolations(limit);
      res.json(violations);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get violations' });
    }
  });
  
  // Block a client
  app.post('/api/block/:clientId', async (req, res) => {
    try {
      const { clientId } = req.params;
      await storage.blockClient(clientId);
      
      broadcast({
        type: 'client_blocked',
        clientId,
      });
      
      res.json({ success: true, message: `Client ${clientId} has been blocked` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to block client' });
    }
  });
  
  // Test endpoint for rate limiting
  app.all('/api/protected/test', async (req, res) => {
    const start = Date.now();
    
    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    const responseTime = Date.now() - start;
    
    // Update average response time
    const stats = await storage.getSystemStats();
    const newAvg = Math.round((stats.avgResponseTime + responseTime) / 2);
    await storage.updateSystemStats({ avgResponseTime: newAvg });
    
    res.json({
      success: true,
      message: 'Request processed successfully',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      method: req.method,
      headers: req.headers,
    });
  });
  
  // Generic protected endpoint
  app.all('/api/protected/:endpoint', async (req, res) => {
    const start = Date.now();
    
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
    
    const responseTime = Date.now() - start;
    
    res.json({
      success: true,
      endpoint: req.params.endpoint,
      message: 'Protected endpoint accessed successfully',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
    });
  });
  
  // Clean up expired limits periodically
  setInterval(async () => {
    try {
      await storage.cleanupExpiredLimits();
      
      // Broadcast updated stats
      const stats = await storage.getSystemStats();
      broadcast({
        type: 'stats_updated',
        stats,
      });
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }, 30000); // Clean up every 30 seconds
  
  return httpServer;
}
