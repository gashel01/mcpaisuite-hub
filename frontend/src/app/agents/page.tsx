"use client";

import { useState, useEffect } from "react";
import { Bot, Play, Loader2, CheckCircle2, XCircle, Code, Globe, FolderOpen, Brain, Map, Wand2 } from "lucide-react";
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

interface AgentInfo { type: string; constitution: string; tools: string[]; max_turns: number; custom?: boolean; }
interface SubAgentResult { agent_type: string; task: string; success: boolean; output: string; turns_used: number; tokens_used: number; cost: number; error: string; }

async function listAgents(): Promise<AgentInfo[]> {
  const r = await fetch(`${BASE_URL}/agents`); const d = await r.json(); return d.agents || [];
}
async function spawnAgent(agent_type: string, task: string, max_turns = 5, constitution = "", tools: string[] = []): Promise<SubAgentResult> {
  const r = await fetch(`${BASE_URL}/agents/spawn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_type, task, max_turns, constitution, tools }) });
  return r.json();
}

const AGENT_ICONS: Record<string, typeof Code> = {
  code: Code,
  research: Globe,
  file: FolderOpen,
  memory: Brain,
  plan: Map,
  custom: Wand2,
};

const AGENT_COLORS: Record<string, string> = {
  code: "text-violet-400 bg-violet-900/30 border-violet-700/50",
  research: "text-cyan-400 bg-cyan-900/30 border-cyan-700/50",
  file: "text-amber-400 bg-amber-900/30 border-amber-700/50",
  memory: "text-emerald-400 bg-emerald-900/30 border-emerald-700/50",
  plan: "text-rose-400 bg-rose-900/30 border-rose-700/50",
  custom: "text-indigo-400 bg-indigo-900/30 border-indigo-700/50",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [task, setTask] = useState("");
  const [spawning, setSpawning] = useState(false);
  const [result, setResult] = useState<SubAgentResult | null>(null);

  // Custom agent state
  const [customConstitution, setCustomConstitution] = useState("You are a helpful AI agent. Accomplish the task using your tools. Be concise.");
  const [customTools, setCustomTools] = useState<Set<string>>(new Set(["execute_code", "read_file", "write_file"]));
  const [customMaxTurns, setCustomMaxTurns] = useState(5);

  const allTools = agents.find(a => a.type === "custom")?.tools || [];
  const isCustom = selectedAgent === "custom";

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSpawn = async () => {
    if (!selectedAgent || !task.trim()) return;
    setSpawning(true);
    setResult(null);
    try {
      const r = await spawnAgent(
        selectedAgent,
        task.trim(),
        isCustom ? customMaxTurns : undefined,
        isCustom ? customConstitution : "",
        isCustom ? Array.from(customTools) : [],
      );
      setResult(r);
    } catch (e) {
      setResult({
        agent_type: selectedAgent,
        task: task.trim(),
        success: false,
        output: "",
        turns_used: 0,
        tokens_used: 0,
        cost: 0,
        error: String(e),
      });
    } finally {
      setSpawning(false);
    }
  };

  const toggleTool = (tool: string) => {
    setCustomTools(prev => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Sub-Agents</h1>
        <p className="text-slate-400 text-sm mt-1">
          Specialized agents with focused constitutions and limited tool sets
        </p>
      </div>

      {/* Agent cards */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Loading agents...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const Icon = AGENT_ICONS[agent.type] || Bot;
            const colors = AGENT_COLORS[agent.type] || "text-slate-400 bg-slate-900/30 border-slate-700/50";
            const isSelected = selectedAgent === agent.type;
            return (
              <button
                key={agent.type}
                onClick={() => setSelectedAgent(isSelected ? null : agent.type)}
                className={`text-left rounded-xl border p-4 transition-all ${colors} ${
                  isSelected ? "ring-2 ring-violet-500 scale-[1.02]" : "hover:scale-[1.01]"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-5 w-5" />
                  <span className="font-semibold capitalize">{agent.type}Agent</span>
                  {agent.custom && <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">configurable</span>}
                  <span className="ml-auto text-xs opacity-60">{agent.max_turns} turns</span>
                </div>
                <p className="text-xs opacity-70 line-clamp-2 mb-3">
                  {agent.custom
                    ? "Define your own constitution, tools, and limits"
                    : agent.constitution.split("\n").find(l => l.trim() && !l.startsWith("You"))?.trim() || agent.constitution.slice(0, 100)}
                </p>
                <div className="flex flex-wrap gap-1">
                  {agent.custom ? (
                    <span className="text-[10px] opacity-50">all tools available</span>
                  ) : (
                    <>
                      {agent.tools.slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] bg-black/20 rounded px-1.5 py-0.5 font-mono">{t}</span>
                      ))}
                      {agent.tools.length > 4 && <span className="text-[10px] opacity-50">+{agent.tools.length - 4}</span>}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom agent config */}
      {isCustom && (
        <div className="bg-indigo-900/20 border border-indigo-700/40 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-semibold text-indigo-300 flex items-center gap-2">
            <Wand2 className="h-5 w-5" /> Configure Custom Agent
          </h2>

          {/* Constitution */}
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Constitution (system prompt)</label>
            <textarea
              value={customConstitution}
              onChange={(e) => setCustomConstitution(e.target.value)}
              rows={4}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              placeholder="You are a specialized agent that..."
            />
          </div>

          {/* Max turns */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400">Max turns:</label>
            <input
              type="number"
              value={customMaxTurns}
              onChange={(e) => setCustomMaxTurns(Math.max(1, Math.min(15, Number(e.target.value))))}
              min={1}
              max={15}
              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-600">({customTools.size} tools selected)</span>
          </div>

          {/* Tool picker */}
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Tools (click to toggle)</label>
            <div className="flex flex-wrap gap-1.5">
              {allTools.map((tool) => (
                <button
                  key={tool}
                  onClick={() => toggleTool(tool)}
                  className={`text-xs px-2 py-1 rounded-md font-mono transition-colors ${
                    customTools.has(tool)
                      ? "bg-indigo-600/40 text-indigo-200 border border-indigo-500/50"
                      : "bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-300"
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Spawn panel */}
      {selectedAgent && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-violet-400" />
            <h2 className="text-lg font-semibold text-slate-200">
              Spawn <span className="capitalize">{selectedAgent}</span>Agent
            </h2>
          </div>

          <div className="flex gap-3">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSpawn()}
              placeholder={`Describe the task for ${selectedAgent}Agent...`}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              disabled={spawning}
            />
            <button
              onClick={handleSpawn}
              disabled={spawning || !task.trim() || (isCustom && customTools.size === 0)}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {spawning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Spawn
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className={`rounded-lg border p-4 ${result.success ? "bg-green-900/20 border-green-700/50" : "bg-red-900/20 border-red-700/50"}`}>
              <div className="flex items-center gap-2 mb-2">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className={`text-sm font-medium ${result.success ? "text-green-400" : "text-red-400"}`}>
                  {result.success ? "Success" : "Failed"}
                </span>
                <span className="ml-auto text-xs text-slate-500">
                  {result.turns_used} turns | {result.tokens_used} tokens | ${result.cost.toFixed(4)}
                </span>
              </div>
              {result.error && (
                <p className="text-xs text-red-300 mb-2">{result.error}</p>
              )}
              {result.output && (
                <pre className="text-sm text-slate-300 bg-black/30 rounded-lg p-3 max-h-60 overflow-auto whitespace-pre-wrap">
                  {result.output}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Agent details (non-custom) */}
      {selectedAgent && !isCustom && agents.find(a => a.type === selectedAgent) && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-400 mb-3">Constitution</h3>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
            {agents.find(a => a.type === selectedAgent)!.constitution}
          </pre>
        </div>
      )}
    </div>
  );
}
