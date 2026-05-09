"use client";

import { useEffect, useState } from "react";
import { Save, ShieldCheck, Loader2 } from "lucide-react";
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";
const getConstitution = async () => { const r = await fetch(`${BASE_URL}/constitution`); return r.json(); };
const saveConstitution = async (rules: string) => { const r = await fetch(`${BASE_URL}/constitution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) }); return r.json(); };

export default function ConstitutionPage() {
  const [rules, setRules] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getConstitution()
      .then((c) => setRules(c.rules))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const c = await saveConstitution(rules);
      setRules(c.rules);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (_e) {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck size={24} className="text-violet-400" />
        <h1 className="text-2xl font-bold">Constitution</h1>
      </div>

      <p className="text-sm text-[#9090a8]">
        Define the PM rules that govern agent behaviour. These rules are
        injected as system-level constraints for every task.
      </p>

      <textarea
        rows={18}
        value={rules}
        onChange={(e) => setRules(e.target.value)}
        className="w-full font-mono text-sm"
        placeholder="Enter constitution rules..."
      />

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
          Save
        </button>
        {saved && (
          <span className="text-sm text-emerald-400">Saved successfully</span>
        )}
      </div>
    </div>
  );
}
