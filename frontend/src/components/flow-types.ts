// Shared node-data and workflow types for the flow editor.

export type TriggerType = "manual" | "scheduled" | "cron" | "interval" | "watch" | "webhook";
export type WorkspaceMode = "user" | "isolated" | "persistent";

export interface AgentNodeData { agentType: string; role: string; label: string; maxTurns: number; instructions: string; [key: string]: unknown; }
export interface TriggerNodeData { triggerType: TriggerType; label: string; [key: string]: unknown; }
export interface ConditionNodeData { expression: string; label: string; [key: string]: unknown; }
export interface HumanNodeData { label: string; instructions: string; [key: string]: unknown; }
export interface WorkspaceNodeData { workspaceName: string; workspaceMode: WorkspaceMode; label: string; [key: string]: unknown; }
export interface EndNodeData { label: string; [key: string]: unknown; }
export interface WorkflowNodeData { templateId: string; templateName: string; label: string; agentCount: number; pattern: string; description: string; [key: string]: unknown; }
// Deterministic node: runs a governed tool (kind="tool") or sandboxed Python (kind="code"), no LLM.
export interface ToolNodeData { kind: "tool" | "code"; label: string; tool: string; args: string; code: string; [key: string]: unknown; }
