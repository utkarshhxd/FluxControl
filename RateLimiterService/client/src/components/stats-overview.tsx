import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ArrowLeftRight, Ban, Users, Clock } from "lucide-react";
import type { DashboardStats } from "@shared/schema";

export function StatsOverview() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/stats'],
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="p-6 animate-pulse">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
              <div className="ml-4 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-6 bg-gray-200 rounded w-16"></div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Requests",
      value: stats?.totalRequests?.toLocaleString() || "0",
      icon: ArrowLeftRight,
      bgColor: "bg-blue-100",
      iconColor: "text-blue-700",
    },
    {
      title: "Rate Limited",
      value: stats?.rateLimited?.toLocaleString() || "0",
      icon: Ban,
      bgColor: "bg-red-100",
      iconColor: "text-red-700",
    },
    {
      title: "Active Clients",
      value: stats?.activeClients?.toLocaleString() || "0",
      icon: Users,
      bgColor: "bg-orange-100",
      iconColor: "text-orange-700",
    },
    {
      title: "Avg Response Time",
      value: `${stats?.avgResponseTime || 0}ms`,
      icon: Clock,
      bgColor: "bg-green-100",
      iconColor: "text-green-700",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {statCards.map((stat, index) => (
        <Card key={index} className="p-6">
          <div className="flex items-center">
            <div className={`flex-shrink-0 w-8 h-8 ${stat.bgColor} rounded-lg flex items-center justify-center`}>
              <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">{stat.title}</p>
              <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
