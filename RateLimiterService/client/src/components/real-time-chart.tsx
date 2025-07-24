import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStats } from "@shared/schema";

interface DataPoint {
  time: string;
  requests: number;
  rateLimited: number;
  timestamp: number;
}

export function RealTimeChart() {
  const [data, setData] = useState<DataPoint[]>([]);

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/stats'],
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (stats) {
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      setData(prevData => {
        const newData = [...prevData, {
          time: timeString,
          requests: stats.totalRequests,
          rateLimited: stats.rateLimited,
          timestamp: now.getTime()
        }];

        // Keep only last 20 data points (40 seconds of data)
        return newData.slice(-20);
      });
    }
  }, [stats]);

  // Calculate requests per second by looking at the difference
  const chartData = data.map((point, index) => {
    if (index === 0) {
      return {
        ...point,
        requestsPerSecond: 0,
        rateLimitedPerSecond: 0
      };
    }

    const prevPoint = data[index - 1];
    const timeDiff = (point.timestamp - prevPoint.timestamp) / 1000; // seconds
    const requestDiff = point.requests - prevPoint.requests;
    const rateLimitedDiff = point.rateLimited - prevPoint.rateLimited;

    return {
      ...point,
      requestsPerSecond: timeDiff > 0 ? Math.round(requestDiff / timeDiff) : 0,
      rateLimitedPerSecond: timeDiff > 0 ? Math.round(rateLimitedDiff / timeDiff) : 0
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Real-time Request Monitoring</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip 
                  labelFormatter={(value) => `Time: ${value}`}
                  formatter={(value: number, name: string) => [
                    value,
                    name === 'requestsPerSecond' ? 'Requests/sec' : 'Rate Limited/sec'
                  ]}
                />
                <Line 
                  type="monotone" 
                  dataKey="requestsPerSecond" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  name="requestsPerSecond"
                />
                <Line 
                  type="monotone" 
                  dataKey="rateLimitedPerSecond" 
                  stroke="#ef4444" 
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  name="rateLimitedPerSecond"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full bg-gray-50 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
              <div className="text-center">
                <div className="animate-pulse">
                  <div className="h-4 bg-gray-300 rounded w-32 mx-auto mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-24 mx-auto"></div>
                </div>
                <p className="text-gray-500 font-medium mt-2">Collecting data...</p>
                <p className="text-sm text-gray-400">Make some API requests to see the chart</p>
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-center space-x-6 text-sm">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
            <span className="text-gray-600">Requests per second</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
            <span className="text-gray-600">Rate limited per second</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}