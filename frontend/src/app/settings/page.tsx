"use client";

import { useEffect, useState } from "react";
import { Settings, Save, Loader2 } from "lucide-react";
import { getSettings, saveSettings, type LLMConfig } from "@/lib/api";

const DEFAULTS: LLMConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  api_key: "",
  base_url: "",
  routing_enabled: true,
  max_turns: 25,
  max_tokens: 4096,
};

export default function SettingsPage() {
  const [cfg, setCfg] = useState<LLMConfig>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setCfg)
      .catch(() => {});
  }, []);

  const update = <K extends keyof LLMConfig>(key: K, val: LLMConfig[K]) =>
    setCfg((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await saveSettings(cfg);
      setCfg(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-violet-400" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="space-y-5 rounded-xl border border-[#2a2a3a] bg-[#16161e] p-6">
        {/* Provider */}
        <Field label="Provider">
          <select
            value={cfg.provider}
            onChange={(e) => update("provider", e.target.value)}
            className="w-full"
          >
            <option value="echo">None (no LLM)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama (local)</option>
            <option value="openai_compatible">OpenAI-compatible</option>
          </select>
        </Field>

        {/* Model */}
        <Field label="Model">
          <input
            type="text"
            value={cfg.model}
            onChange={(e) => update("model", e.target.value)}
            className="w-full"
          />
        </Field>

        {/* API Key */}
        <Field label="API Key">
          <input
            type="password"
            value={cfg.api_key}
            onChange={(e) => update("api_key", e.target.value)}
            className="w-full"
            placeholder="sk-..."
          />
        </Field>

        {/* Base URL */}
        <Field label="Base URL">
          <input
            type="text"
            value={cfg.base_url}
            onChange={(e) => update("base_url", e.target.value)}
            className="w-full"
            placeholder="https://api.example.com/v1"
          />
        </Field>

        {/* Routing toggle */}
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[#9090a8]">
            Routing Enabled
          </label>
          <button
            type="button"
            onClick={() => update("routing_enabled", !cfg.routing_enabled)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              cfg.routing_enabled ? "bg-violet-600" : "bg-[#2a2a3a]"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                cfg.routing_enabled ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>

        {/* Max turns */}
        <Field label="Max Turns">
          <input
            type="number"
            min={1}
            max={100}
            value={cfg.max_turns}
            onChange={(e) => update("max_turns", Number(e.target.value))}
            className="w-full"
          />
        </Field>

        {/* Max tokens */}
        <Field label="Max Tokens">
          <input
            type="number"
            min={256}
            max={200000}
            value={cfg.max_tokens}
            onChange={(e) => update("max_tokens", Number(e.target.value))}
            className="w-full"
          />
        </Field>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Settings
        </button>
        {saved && (
          <span className="text-sm text-emerald-400">Saved successfully</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[#9090a8]">{label}</label>
      {children}
    </div>
  );
}
