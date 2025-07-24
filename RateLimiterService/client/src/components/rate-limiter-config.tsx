import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { RateLimitConfig, InsertRateLimitConfig } from "@shared/schema";

export function RateLimiterConfig() {
  const { toast } = useToast();
  const [config, setConfig] = useState<InsertRateLimitConfig>({
    algorithm: 'fixed-window',
    requestLimit: 100,
    timeWindow: '1m',
    clientIdType: 'ip',
    isActive: true,
  });

  const { data: currentConfig, isLoading } = useQuery<RateLimitConfig>({
    queryKey: ['/api/config'],
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (newConfig: InsertRateLimitConfig) => {
      const response = await apiRequest('POST', '/api/config', newConfig);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/config'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Configuration Updated",
        description: "Rate limiter configuration has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to update rate limiter configuration.",
        variant: "destructive",
      });
    },
  });

  // Sync with current config when loaded
  useEffect(() => {
    if (currentConfig && !isLoading) {
      const { id, createdAt, ...configData } = currentConfig;
      setConfig(configData);
    }
  }, [currentConfig, isLoading]);

  const handleSubmit = () => {
    updateConfigMutation.mutate(config);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate Limiter Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Algorithm</Label>
          <Select
            value={config.algorithm}
            onValueChange={(value) => setConfig({ ...config, algorithm: value as any })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="token-bucket">Token Bucket</SelectItem>
              <SelectItem value="sliding-window">Sliding Window</SelectItem>
              <SelectItem value="fixed-window">Fixed Window</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Request Limit</Label>
          <Input
            type="number"
            value={config.requestLimit}
            onChange={(e) => setConfig({ ...config, requestLimit: parseInt(e.target.value) || 0 })}
            min="1"
          />
        </div>

        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Time Window</Label>
          <Select
            value={config.timeWindow}
            onValueChange={(value) => setConfig({ ...config, timeWindow: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1s">1 Second</SelectItem>
              <SelectItem value="1m">1 Minute</SelectItem>
              <SelectItem value="1h">1 Hour</SelectItem>
              <SelectItem value="1d">1 Day</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">Client Identification</Label>
          <Select
            value={config.clientIdType}
            onValueChange={(value) => setConfig({ ...config, clientIdType: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ip">IP Address</SelectItem>
              <SelectItem value="api-key">API Key</SelectItem>
              <SelectItem value="user-id">User ID</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={updateConfigMutation.isPending}
          className="w-full bg-blue-700 hover:bg-blue-800"
        >
          {updateConfigMutation.isPending ? 'Updating...' : 'Update Configuration'}
        </Button>
      </CardContent>
    </Card>
  );
}
