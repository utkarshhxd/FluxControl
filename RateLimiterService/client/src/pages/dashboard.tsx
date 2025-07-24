import { Header } from "@/components/header";
import { StatsOverview } from "@/components/stats-overview";
import { RateLimiterConfig } from "@/components/rate-limiter-config";
import { APITester } from "@/components/api-tester";
import { MonitoringDashboard } from "@/components/monitoring-dashboard";
import { AlertsBanner } from "@/components/alerts-banner";
import { useWebSocket } from "@/hooks/use-websocket";

export default function Dashboard() {
  const { isConnected } = useWebSocket();

  return (
    <div className="min-h-screen bg-gray-50">
      <Header isConnected={isConnected} />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <StatsOverview />
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <RateLimiterConfig />
            <APITester />
          </div>
          
          <div className="lg:col-span-2">
            <MonitoringDashboard />
          </div>
        </div>
        
        <AlertsBanner />
      </div>
    </div>
  );
}
