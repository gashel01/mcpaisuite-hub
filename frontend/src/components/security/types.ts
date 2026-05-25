export interface SecurityPosture {
  egress: { enabled: boolean; allowed_domains: string[]; pending_count: number };
  host: {
    approved_count: number;
    pending_count: number;
    blocked_count: number;
    auto_approve: boolean;
    approved_patterns: string[];
    blocked_patterns: string[];
    safe_patterns: string[];
  };
  validator: { reject_dangerous: boolean; auto_fix: boolean; disabled_patterns?: string[] };
  sandbox: { timeout: number; max_ram_mb: number };
  constitution: { rules_count: number; has_custom_rules: boolean; rules: string; effective: string; active_templates?: string[] };
  vault: { secret_count: number };
  dlp: { patterns_count: number; enabled: boolean; disabled_patterns?: string[] };
}

export interface SecurityAuditEvent {
  id: number;
  ts: number;
  source: string;
  type: string;
  detail: string;
  data: Record<string, unknown>;
}
