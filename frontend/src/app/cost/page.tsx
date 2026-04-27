"use client";

import { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { getCost, type CostSummary } from "@/lib/api";

export default function CostPage() {
  const [cost, setCost] = useState<CostSummary | null>(null);

  useEffect(() => {
    getCost()
      .then(setCost)
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign size={24} className="text-violet-400" />
        <h1 className="text-2xl font-bold">Cost Tracker</h1>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          label="Total Tokens"
          value={cost ? cost.total_tokens.toLocaleString() : "--"}
        />
        <Card
          label="Total Cost"
          value={cost ? `$${cost.total_cost_usd.toFixed(4)}` : "--"}
        />
        <Card
          label="Prompt / Completion"
          value={
            cost
              ? `${cost.prompt_tokens.toLocaleString()} / ${cost.completion_tokens.toLocaleString()}`
              : "--"
          }
        />
      </div>

      {/* Model breakdown */}
      {cost && Object.keys(cost.model_breakdown).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Model Breakdown</h2>
          <div className="overflow-hidden rounded-xl border border-[#2a2a3a]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a3a] bg-[#16161e] text-left text-xs text-[#9090a8]">
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(cost.model_breakdown).map(([model, data]) => (
                  <tr
                    key={model}
                    className="border-b border-[#2a2a3a] last:border-0"
                  >
                    <td className="px-4 py-3 font-mono text-violet-400">
                      {model}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {data.tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      ${data.cost_usd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!cost && (
        <p className="text-sm text-[#9090a8]">
          No cost data available yet. Run a task to start tracking.
        </p>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#2a2a3a] bg-[#16161e] p-5">
      <div className="text-xs text-[#9090a8]">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
