import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import type { ActiveRateLimit, RateLimitConfig } from "@shared/schema";

export function AlertsBanner() {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  const { data: limits } = useQuery<ActiveRateLimit[]>({
    queryKey: ['/api/active-limits'],
    refetchInterval: 5000,
  });

  const { data: config } = useQuery<RateLimitConfig>({
    queryKey: ['/api/config'],
  });

  // Find clients with high usage (>80%)
  const highUsageClients = limits?.filter(limit => {
    const maxRequests = config?.requestLimit || 100;
    const usagePercentage = (limit.requestCount / maxRequests) * 100;
    return usagePercentage > 80 && 
           limit.status === 'warning' &&
           !dismissedAlerts.has(limit.clientId);
  }) || [];

  const dismissAlert = (clientId: string) => {
    setDismissedAlerts(prev => new Set(Array.from(prev).concat([clientId])));
  };

  if (highUsageClients.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 space-y-4">
      {highUsageClients.map((client) => (
        <div key={client.id} className="bg-orange-50 border border-orange-200 rounded-md p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-orange-700" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-orange-800">
                <strong>High Traffic Alert:</strong> Client {client.clientId} has used{' '}
                {client.requestCount}/{config?.requestLimit || 100} requests (80%+ of rate limit). Consider monitoring for potential abuse.
              </p>
            </div>
            <div className="ml-auto pl-3">
              <button
                onClick={() => dismissAlert(client.clientId)}
                className="text-orange-600 hover:text-orange-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
