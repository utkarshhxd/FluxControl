import { ActiveLimitsTable } from "./active-limits-table";
import { ViolationsLog } from "./violations-log";
import { RealTimeChart } from "./real-time-chart";

export function MonitoringDashboard() {
  return (
    <div className="space-y-6">
      <RealTimeChart />
      <ActiveLimitsTable />
      <ViolationsLog />
    </div>
  );
}
