"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, BarChart3, Bell, Palette } from "lucide-react";

import EventsPanel, { type AuditEvent } from "./EventsPanel";
import TraceWaterfall from "./TraceWaterfall";
import ReviewQueue from "./ReviewQueue";
import InsightsPanel from "./InsightsPanel";
import ImprovePanel from "./ImprovePanel";
import { AlertsPanel } from "../../app/observability/alerts";
import { ConstitutionStudio, RegressionPanel } from "../../app/observability/studio";

// ── Types ──────────────────────────────────────────────────────────────────

type MainTab = "live" | "analytics" | "alerts" | "studio";

interface Props {
  tab: MainTab;
  setTab: (t: MainTab) => void;
  width: number;
  isLive: boolean;
  // Live
  executionEvents: any[];
  auditEvents: AuditEvent[];
  viewMode: "task" | "all";
  setViewMode: (v: "task" | "all") => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  textFilter: string;
  setTextFilter: (v: string) => void;
  onEventClick: (id: string) => void;
  onLoadTrace: (evt: AuditEvent) => void;
  activeEventId: string | null;
  taskId: string;
  tenant: string;
  // Analytics
  analytics: any;
  stats: any;
  tenantHeaders: Record<string, string>;
  // Queue
  onSelectTask: (id: string) => void;
}

const TABS: { id: MainTab; label: string; icon: typeof Radio }[] = [
  { id: "live", label: "Live", icon: Radio },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "studio", label: "Studio", icon: Palette },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function RightPanel(props: Props) {
  const { tab, setTab, width, isLive } = props;

  // Sub-tab state (local to each main tab)
  const [liveSub, setLiveSub] = useState<"events" | "traces">("events");
  const [analyticsSub, setAnalyticsSub] = useState<"insights" | "improve">("insights");
  const [alertsSub, setAlertsSub] = useState<"rules" | "queue">("rules");

  return (
    <div style={{ width }} className="shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">

      {/* ── Main tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.04] bg-white/[0.01] shrink-0">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                isActive ? "text-violet-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="w-3 h-3" />
              {t.label}
              {isActive && (
                <motion.div
                  layoutId="panel-tab-bg"
                  className="absolute inset-0 bg-violet-500/10 border border-violet-500/20 rounded-md -z-10"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}

        {/* Live indicator — always visible when streaming */}
        {isLive && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-auto flex items-center gap-1"
          >
            <motion.div
              className="h-1.5 w-1.5 rounded-full bg-green-400"
              animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            <span className="text-[9px] text-green-400/60">live</span>
          </motion.div>
        )}
      </div>

      {/* ── Sub-tabs (contextual per main tab) ────────────────── */}
      {tab === "live" && (
        <SubTabs
          items={[
            { id: "events", label: "Events" },
            { id: "traces", label: "Spans" },
          ]}
          active={liveSub}
          onSelect={(v) => setLiveSub(v as "events" | "traces")}
        />
      )}
      {tab === "analytics" && (
        <SubTabs
          items={[
            { id: "insights", label: "Insights" },
            { id: "improve", label: "Improve" },
          ]}
          active={analyticsSub}
          onSelect={(v) => setAnalyticsSub(v as "insights" | "improve")}
        />
      )}
      {tab === "alerts" && (
        <SubTabs
          items={[
            { id: "rules", label: "Rules & History" },
            { id: "queue", label: "Review Queue" },
          ]}
          active={alertsSub}
          onSelect={(v) => setAlertsSub(v as "rules" | "queue")}
        />
      )}

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {/* Live > Events */}
          {tab === "live" && liveSub === "events" && (
            <PanelSlide key="events">
              <EventsPanel
                events={props.executionEvents}
                auditEvents={props.auditEvents}
                viewMode={props.viewMode}
                setViewMode={props.setViewMode}
                sourceFilter={props.sourceFilter}
                setSourceFilter={props.setSourceFilter}
                textFilter={props.textFilter}
                setTextFilter={props.setTextFilter}
                onEventClick={props.onEventClick}
                onLoadTrace={props.onLoadTrace}
                activeEventId={props.activeEventId}
              />
            </PanelSlide>
          )}

          {/* Live > Traces */}
          {tab === "live" && liveSub === "traces" && (
            <PanelSlide key="traces" scroll>
              <TraceWaterfall taskId={props.taskId} namespace={props.tenant} />
            </PanelSlide>
          )}

          {/* Analytics > Insights */}
          {tab === "analytics" && analyticsSub === "insights" && (
            <PanelSlide key="insights" scroll>
              <InsightsPanel analytics={props.analytics} stats={props.stats} />
            </PanelSlide>
          )}

          {/* Analytics > Improve */}
          {tab === "analytics" && analyticsSub === "improve" && (
            <PanelSlide key="improve" scroll>
              <ImprovePanel analytics={props.analytics} tenantHeaders={props.tenantHeaders} />
            </PanelSlide>
          )}

          {/* Alerts > Rules & History */}
          {tab === "alerts" && alertsSub === "rules" && (
            <PanelSlide key="alerts" scroll>
              <AlertsPanel />
            </PanelSlide>
          )}

          {/* Alerts > Review Queue */}
          {tab === "alerts" && alertsSub === "queue" && (
            <PanelSlide key="queue">
              <ReviewQueue namespace={props.tenant} onSelectTask={props.onSelectTask} />
            </PanelSlide>
          )}

          {/* Studio */}
          {tab === "studio" && (
            <PanelSlide key="studio" scroll>
              <div className="flex flex-col gap-3 p-2">
                <ConstitutionStudio namespace={props.tenant} />
                <RegressionPanel namespace={props.tenant} />
              </div>
            </PanelSlide>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Sub-tabs bar ───────────────────────────────────────────────────────────

function SubTabs({ items, active, onSelect }: {
  items: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-white/[0.03] shrink-0">
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`px-2 py-0.5 text-[9px] font-medium rounded transition-colors ${
            active === item.id
              ? "text-slate-300 bg-white/[0.04]"
              : "text-slate-600 hover:text-slate-400"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Panel slide animation wrapper ──────────────────────────────────────────

function PanelSlide({ children, scroll }: { children: React.ReactNode; scroll?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.15 }}
      className={`h-full ${scroll ? "overflow-y-auto" : ""}`}
    >
      {children}
    </motion.div>
  );
}
