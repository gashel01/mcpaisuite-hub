"use client";
import { apiFetch, apiUrl } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import ConfirmDialog from "@/components/ui/confirm";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  FolderOpen,
  FileText,
  FileCode2,
  File,
  Upload,
  Trash2,
  Download,
  RefreshCw,
  ChevronRight,
  X,
  Save,
  Edit3,
  Clock,
  Database,
  Search,
  Eye,
  ArrowLeft,
  FolderPlus,
  Plus,
  HardDrive,
  AlertCircle,
  Menu,
} from "lucide-react";
import { useTenant } from "@/context/tenant";
import EmptyState from "@/components/empty-state";
import { renderMarkdown } from "@/components/markdown";


// ── Types ───────────────────────────────────────────────────────────────────

interface WsFile {
  path: string;
  size: number;
  is_dir: boolean;
  modified: string | null;
}

interface WsStats {
  available: boolean;
  total_files?: number;
  total_size?: number;
  languages?: Record<string, number>;
}

interface Checkpoint {
  id: string;
  label: string;
  file_path: string;
  created_at: string;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
}

interface UploadEntry {
  name: string;
  size: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function fileIcon(name: string, isDir: boolean) {
  if (isDir) return <FolderOpen size={16} className="text-violet-400" />;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["py", "js", "ts", "tsx", "jsx", "rs", "go", "java", "c", "cpp", "h", "rb", "sh", "yml", "yaml", "toml", "json", "css", "html"].includes(ext))
    return <FileCode2 size={16} className="text-sky-400" />;
  if (["md", "txt", "log", "csv", "xml", "env", "cfg", "ini", "conf"].includes(ext))
    return <FileText size={16} className="text-emerald-400" />;
  return <File size={16} className="text-slate-500" />;
}

function fileName(path: string): string {
  const parts = path.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || path;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  const [files, setFiles] = useState<WsFile[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [stats, setStats] = useState<WsStats | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const { tenant: activeTenant } = useTenant();
  // Optional ?ns= override: opened from a run's "View workspace" in Observability. Scopes
  // THIS tab to a run's isolated/named workspace namespace WITHOUT mutating the global
  // tenant (localStorage), so the run workspace is viewed without disturbing the user's
  // selected tenant elsewhere.
  const [nsOverride, setNsOverride] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("ns");
    if (p) setNsOverride(p);
  }, []);
  const effectiveTenant = nsOverride || activeTenant;
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Data fetching ─────────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    try {
      const data = await apiFetch<any>(
        `/workspace/files?path=${encodeURIComponent(currentPath)}&recursive=false`,
        { tenant: effectiveTenant }
      );
      // Sort: dirs first, then alphabetical
      const sorted = (data.files || []).sort((a: WsFile, b: WsFile) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return fileName(a.path).localeCompare(fileName(b.path));
      });
      setFiles(sorted);
    } catch (_e) {
      setFiles([]);
      setError("Failed to load files");
    }
  }, [currentPath, effectiveTenant]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await apiFetch<WsStats>("/workspace/stats", { tenant: effectiveTenant }));
    } catch (_e) {
      setStats(null);
    }
  }, [effectiveTenant]);

  const loadCheckpoints = useCallback(async () => {
    try {
      const data = await apiFetch<any>("/workspace/checkpoints", { tenant: effectiveTenant });
      setCheckpoints(data.checkpoints || []);
    } catch (_e) {
      setCheckpoints([]);
    }
  }, [effectiveTenant]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([loadFiles(), loadStats(), loadCheckpoints()]).finally(() =>
      setLoading(false)
    );
  }, [loadFiles, loadStats, loadCheckpoints]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => {
      loadFiles();
      loadStats();
    }, 60000);
    return () => clearInterval(id);
  }, [loadFiles, loadStats]);

  // ── File operations ───────────────────────────────────────────────────────

  const openFile = async (path: string) => {
    try {
      const data = await apiFetch<FileContent>(`/workspace/file?path=${encodeURIComponent(path)}`, { tenant: effectiveTenant });
      setSelectedFile(data);
      setEditMode(false);
      setEditContent(data.content || "");
    } catch (_e) {
      // ignore
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const data = await apiFetch<any>("/workspace/file", {
        method: "POST", tenant: effectiveTenant,
        body: { path: selectedFile.path, content: editContent },
      });
      setSelectedFile({ ...selectedFile, content: editContent, size: data.size });
      setEditMode(false);
      loadFiles();
      loadStats();
      showToast("File saved");
    } catch (_e) {
      showToast("Failed to save file", "error");
    } finally {
      setSaving(false);
    }
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      await apiFetch("/workspace/folder", { method: "POST", tenant: effectiveTenant, body: { name: fullPath } });
      setNewFolderName("");
      setShowNewFolder(false);
      loadFiles();
      showToast("Folder created");
    } catch (_e) { showToast("Failed to create folder", "error"); }
  };

  const deleteFile = async (path: string) => {
    try {
      await apiFetch(`/workspace/file?path=${encodeURIComponent(path)}`, { method: "DELETE", tenant: effectiveTenant });
      if (selectedFile?.path === path) setSelectedFile(null);
      loadFiles();
      loadStats();
      showToast("File deleted");
    } catch (_e) {
      showToast("Failed to delete", "error");
    }
  };

  const downloadFile = async (path: string, isDir = false) => {
    try {
      if (isDir) {
        // Download folder as ZIP
        const res = await apiFetch<Response>(
          `/workspace/download-folder?path=${encodeURIComponent(path)}`,
          { tenant: effectiveTenant, raw: true }
        );
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName(path)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await apiFetch<any>(`/workspace/file?path=${encodeURIComponent(path)}`, { tenant: effectiveTenant });
        const blob = new Blob([data.content || ""], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName(path);
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (_e) {
      // ignore
    }
  };

  const uploadFile = useCallback(
    async (file: globalThis.File) => {
      const entry: UploadEntry = { name: file.name, size: file.size, status: "uploading" };
      setUploads((prev) => [entry, ...prev]);
      setUploading(true);

      try {
        const form = new FormData();
        form.append("file", file);
        await apiFetch("/workspace/upload", { method: "POST", tenant: effectiveTenant, body: form });
        setUploads((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, status: "done" } : u))
        );
        loadFiles();
        loadStats();
        showToast(`Uploaded ${file.name}`);
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.name === file.name ? { ...u, status: "error", error: String(err) } : u
          )
        );
      } finally {
        setUploading(false);
      }
    },
    [effectiveTenant, loadFiles, loadStats]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      Array.from(e.dataTransfer.files).forEach(uploadFile);
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      Array.from(e.target.files || []).forEach(uploadFile);
      if (fileRef.current) fileRef.current.value = "";
    },
    [uploadFile]
  );

  const restoreCheckpoint = async (id: string) => {
    try {
      const data = await apiFetch<any>(`/workspace/checkpoints/${id}/restore`, { method: "POST", tenant: effectiveTenant });
      // Return to root: the current folder may have been emptied/removed by the
      // restore, and restored files often live in subfolders.
      setSelectedFile(null);
      setCurrentPath("");
      loadFiles();
      loadStats();
      loadCheckpoints();
      const n = typeof data.files === "number" ? data.files : null;
      showToast(n !== null ? `Checkpoint restored · ${n} file${n === 1 ? "" : "s"}` : "Checkpoint restored");
    } catch (_e) {
      showToast("Failed to restore checkpoint", "error");
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setSelectedFile(null);
  };

  const breadcrumbs = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filteredFiles = searchQuery
    ? files.filter((f) =>
        fileName(f.path).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : files;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="obs-page flex flex-col -mx-4 -mb-4 -mt-16 md:-m-5 h-[calc(100%+5rem)] md:h-[calc(100%+2.5rem)] relative overflow-hidden" onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl border text-xs font-medium animate-slide-in shadow-xl  ${
          toast.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"
        }`}>{toast.message}</div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete file"
        message={pendingDelete ? `"${fileName(pendingDelete)}" will be permanently deleted.` : ""}
        onConfirm={() => { if (pendingDelete) deleteFile(pendingDelete); setPendingDelete(null); }}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-violet-950/60  flex items-center justify-center">
          <div className="text-center"><Upload className="h-10 w-10 text-violet-400 mx-auto mb-3 animate-bounce" /><p className="text-lg font-medium text-violet-300">Drop files here</p></div>
        </div>
      )}

      {/* Header bar */}
      <div className="shrink-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-1.5 border-b border-white/[0.04]">
        <button
          onClick={() => {
            const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Open menu"]');
            if (btn) btn.click();
          }}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-white/[0.04] transition-all touch-target shrink-0 md:hidden"
          aria-label="Navigation"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-violet-600/15 to-violet-800/8 border border-violet-500/15 flex items-center justify-center shrink-0">
          <FolderOpen className="h-4 w-4 text-violet-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-slate-100 leading-tight">Workspace</h1>
          <p className="text-[10px] sm:text-[11px] text-slate-500 truncate hidden sm:block">Files, checkpoints & artifacts</p>
        </div>

        {/* Stats pills */}
        {stats && (
          <div className="flex items-center gap-1.5 ml-2">
            <div className="flex items-center gap-1 px-2 py-0.5 bg-violet-500/8 border border-violet-500/15 rounded-md">
              <FileText className="h-2.5 w-2.5 text-violet-400" />
              <span className="text-[9px] font-medium text-violet-300">{stats.total_files ?? 0}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/8 border border-emerald-500/15 rounded-md">
              <HardDrive className="h-2.5 w-2.5 text-emerald-400" />
              <span className="text-[9px] font-medium text-emerald-300">{formatSize(stats.total_size ?? 0)}</span>
            </div>
            {checkpoints.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/8 border border-amber-500/15 rounded-md">
                <Clock className="h-2.5 w-2.5 text-amber-400" />
                <span className="text-[9px] font-medium text-amber-300">{checkpoints.length} cp</span>
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Actions */}
        <button onClick={() => setShowNewFolder(!showNewFolder)} className="flex items-center gap-1 px-2 py-1.5 text-[10px] sm:text-[11px] font-medium text-slate-400 hover:text-violet-300 bg-white/[0.03] hover:bg-violet-500/8 border border-white/[0.06] rounded-lg transition-all touch-target">
          <FolderPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New Folder</span>
        </button>
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 px-2 py-1.5 text-[10px] sm:text-[11px] font-medium text-slate-400 hover:text-violet-300 bg-white/[0.03] hover:bg-violet-500/8 border border-white/[0.06] rounded-lg transition-all touch-target">
          <Upload className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Upload</span>
        </button>
        <RefreshButton onRefresh={() => Promise.all([loadFiles(), loadStats(), loadCheckpoints()])} className="p-1.5 text-slate-600 hover:text-slate-300 transition-colors" />
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { Array.from(e.target.files || []).forEach(f => uploadFile(f)); if (fileRef.current) fileRef.current.value = ""; }} />
      </div>

      {/* Run-workspace banner — viewing an isolated/named run workspace via ?ns= (opened from Observability) */}
      {nsOverride && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-violet-500/20 bg-violet-500/[0.06] text-[10px] text-violet-200">
          <FolderOpen className="h-3 w-3 text-violet-400 shrink-0" />
          <span className="truncate">
            Viewing a run&rsquo;s workspace — <code className="text-violet-300">{nsOverride}</code>. This is scoped to this tab and does not change your selected namespace.
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-red-500/10 bg-red-500/[0.03] text-[10px] text-red-300">
          <AlertCircle className="h-3 w-3" /><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X size={12} /></button>
        </div>
      )}

      {/* New Folder inline form */}
      {showNewFolder && (
        <div className="shrink-0 flex gap-2 items-center px-4 py-2 border-b border-violet-500/20 bg-violet-500/[0.03] animate-fade-in">
          <FolderPlus size={14} className="text-violet-400 shrink-0" />
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
            placeholder={currentPath ? `New folder in ${currentPath}/...` : "New folder name..."}
            className="flex-1 bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-600" />
          <button onClick={createFolder} disabled={!newFolderName.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md px-2.5 py-1 text-[10px] transition-colors">Create</button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-slate-600 hover:text-slate-300"><X size={12} /></button>
        </div>
      )}

      {/* Upload progress */}
      {uploads.length > 0 && uploads[0].status === "uploading" && (
        <div className="shrink-0 px-4 py-1.5 border-b border-violet-500/10 bg-violet-500/[0.02]">
          {uploads.slice(0, 3).map((u, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <FileText className="h-3 w-3 text-slate-500 shrink-0" />
              <span className="text-slate-300 flex-1 truncate">{u.name}</span>
              <span className="text-slate-600">{formatSize(u.size)}</span>
              {u.status === "uploading" && <Spinner className="h-3 w-3 text-violet-400" />}
              {u.status === "done" && <span className="text-emerald-400">Done</span>}
              {u.status === "error" && <span className="text-red-400">Failed</span>}
            </div>
          ))}
        </div>
      )}

      {/* Breadcrumbs + Search bar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-white/[0.04]">
        <nav className="flex items-center gap-1 text-[11px] overflow-x-auto flex-1">
          <button onClick={() => navigateTo("")}
            className={`px-1.5 py-0.5 rounded transition-colors shrink-0 ${
              !currentPath ? "text-violet-400 font-medium" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Home
          </button>
          {breadcrumbs.map((seg, i) => {
            const path = breadcrumbs.slice(0, i + 1).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={path} className="flex items-center gap-1 shrink-0">
                <ChevronRight size={12} className="text-slate-600" />
                <button
                  onClick={() => navigateTo(path)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    isLast
                      ? "text-violet-400 font-medium"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>

        {/* Search */}
        <div className="relative shrink-0">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter..."
            className="w-32 pl-7 pr-2 py-1 bg-white/[0.02] border border-white/[0.06] rounded-lg text-[10px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-violet-500/30 focus:w-48 transition-all" />
        </div>
      </div>

      {/* File browser + Preview — full height */}
      <div className="flex flex-1 min-h-0">
        {/* File list — on mobile it gives way fully to the preview when a file is open */}
        <div className={`border-r border-white/[0.04] overflow-y-auto transition-all ${selectedFile ? "hidden md:block md:w-1/2" : "flex-1"}`}>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="h-6 w-6 text-violet-400" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No files yet" description="Files created by the agent (code, reports, exports) appear here automatically." action={{ label: "Open Chat", href: "/chat" }} />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2a2a3a] text-left">
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider w-24">
                        Size
                      </th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider w-28">
                        Modified
                      </th>
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider w-24 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Go back row */}
                    {currentPath && (
                      <tr
                        onClick={() => {
                          const parts = currentPath.split("/").filter(Boolean);
                          parts.pop();
                          navigateTo(parts.join("/"));
                        }}
                        className="cursor-pointer hover:bg-[#1e1e2a] transition-colors border-b border-[#2a2a3a]/50"
                      >
                        <td className="px-4 py-2.5 flex items-center gap-2.5">
                          <ArrowLeft size={16} className="text-slate-500" />
                          <span className="text-slate-500">..</span>
                        </td>
                        <td />
                        <td />
                        <td />
                      </tr>
                    )}

                    {filteredFiles.map((f, fi) => (
                      <tr
                        key={f.path}
                        style={{ animationDelay: `${fi * 20}ms` }}
                        onClick={() => {
                          if (f.is_dir) navigateTo(f.path);
                          else openFile(f.path);
                        }}
                        className={`animate-stagger cursor-pointer hover:bg-[#1e1e2a] transition-colors border-b border-[#2a2a3a]/50 ${
                          selectedFile?.path === f.path
                            ? "bg-violet-600/10"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            {fileIcon(fileName(f.path), f.is_dir)}
                            <span className="text-slate-200 truncate max-w-[200px] lg:max-w-[300px]">
                              {fileName(f.path)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">
                          {f.is_dir ? "—" : formatSize(f.size)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">
                          {timeAgo(f.modified)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {(
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadFile(f.path, f.is_dir);
                                }}
                                className="p-1 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-slate-300 transition-colors"
                                title={f.is_dir ? "Download as ZIP" : "Download"}
                              >
                                <Download size={14} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPendingDelete(f.path);
                                }}
                                className="p-1 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-red-400 transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-[#2a2a3a]/50">
                {currentPath && (
                  <button
                    onClick={() => {
                      const parts = currentPath.split("/").filter(Boolean);
                      parts.pop();
                      navigateTo(parts.join("/"));
                    }}
                    className="flex items-center gap-2.5 w-full px-4 py-3 hover:bg-[#1e1e2a] transition-colors"
                  >
                    <ArrowLeft size={16} className="text-slate-500" />
                    <span className="text-sm text-slate-500">..</span>
                  </button>
                )}

                {filteredFiles.map((f, fi) => (
                  <div
                    key={f.path}
                    style={{ animationDelay: `${fi * 20}ms` }}
                    onClick={() => {
                      if (f.is_dir) navigateTo(f.path);
                      else openFile(f.path);
                    }}
                    className={`animate-stagger flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1e1e2a] transition-colors ${
                      selectedFile?.path === f.path ? "bg-violet-600/10" : ""
                    }`}
                  >
                    {fileIcon(fileName(f.path), f.is_dir)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">
                        {fileName(f.path)}
                      </p>
                      <p className="text-xs text-slate-600">
                        {f.is_dir ? "Folder" : formatSize(f.size)}
                        {f.modified && ` \u00b7 ${timeAgo(f.modified)}`}
                      </p>
                    </div>
                    {!f.is_dir && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadFile(f.path);
                          }}
                          className="p-1.5 rounded hover:bg-[#2a2a3a] text-slate-500"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(f.path);
                          }}
                          className="p-1.5 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* File preview panel — full width on mobile, half on desktop */}
        {selectedFile && (
          <div className="w-full md:w-1/2 flex flex-col min-h-0 overflow-hidden animate-slide-in-right">
            {/* Preview header */}
            <div className="flex items-center justify-between border-b border-[#2a2a3a] px-4 py-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {fileIcon(fileName(selectedFile.path), false)}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {fileName(selectedFile.path)}
                  </p>
                  <p className="text-xs text-slate-600">
                    {formatSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {editMode ? (
                  <>
                    <button
                      onClick={saveFile}
                      disabled={saving}
                      className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-sm transition-colors"
                    >
                      {saving ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : (
                        <Save size={14} />
                      )}
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditMode(false);
                        setEditContent(selectedFile.content || "");
                      }}
                      className="p-1.5 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditMode(true);
                        setEditContent(selectedFile.content || "");
                      }}
                      className="flex items-center gap-1.5 bg-[#2a2a3a] hover:bg-[#353548] text-slate-300 rounded-lg px-3 py-1.5 text-sm transition-colors"
                    >
                      <Edit3 size={14} />
                      Edit
                    </button>
                    <button
                      onClick={() => downloadFile(selectedFile.path)}
                      className="p-1.5 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-slate-300 transition-colors"
                      title="Download"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="p-1.5 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Preview content */}
            <div className="flex-1 min-h-0 overflow-auto">
              {editMode ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-[55vh] bg-transparent text-sm text-slate-300 font-mono p-4 focus:outline-none resize-none leading-relaxed"
                  spellCheck={false}
                />
              ) : selectedFile.path.endsWith(".md") || selectedFile.path.endsWith(".mdx") ? (
                <div className="p-4 prose-kernel text-sm">
                  {renderMarkdown(selectedFile.content || "")}
                </div>
              ) : selectedFile.path.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i) ? (
                <div className="p-4 flex items-center justify-center">
                  <img src={apiUrl(`/workspace/file?path=${encodeURIComponent(selectedFile.path)}&raw=true`)} alt={fileName(selectedFile.path)} className="max-h-[50vh] rounded-lg" />
                </div>
              ) : selectedFile.path.endsWith(".json") ? (
                <pre className="p-4 text-sm text-slate-300 font-mono whitespace-pre overflow-x-auto">
                  {(() => { try { return JSON.stringify(JSON.parse(selectedFile.content || ""), null, 2); } catch { return selectedFile.content; } })()}
                </pre>
              ) : (
                <div className="relative">
                  <div className="flex text-sm font-mono leading-relaxed">
                    <div className="select-none px-3 py-4 text-right text-slate-700 border-r border-[#2a2a3a] bg-[#12121a] shrink-0">
                      {(selectedFile.content || "").split("\n").map((_, i) => (
                        <div key={i} className="h-[1.625rem]">{i + 1}</div>
                      ))}
                    </div>
                    <pre className="flex-1 p-4 overflow-x-auto text-slate-300 whitespace-pre">
                      {selectedFile.content || "(empty file)"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Checkpoints */}
      {checkpoints.length > 0 && (
        <div className="bg-[#16161e] border border-[#2a2a3a] rounded-xl overflow-hidden">
          <button
            onClick={() => setCheckpointsOpen(!checkpointsOpen)}
            className="flex items-center justify-between w-full px-4 py-3 hover:bg-[#1e1e2a] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-slate-500" />
              <span className="text-sm font-medium text-slate-400">
                Checkpoints
              </span>
              <span className="text-xs text-slate-600 bg-[#2a2a3a] rounded-full px-2 py-0.5">
                {checkpoints.length}
              </span>
            </div>
            <ChevronRight
              size={14}
              className={`text-slate-600 transition-transform ${
                checkpointsOpen ? "rotate-90" : ""
              }`}
            />
          </button>

          {checkpointsOpen && (
            <div className="border-t border-[#2a2a3a] divide-y divide-[#2a2a3a]/50">
              {checkpoints.map((cp) => (
                <div
                  key={cp.id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-[#1e1e2a] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-300 truncate">
                      {cp.label || cp.file_path}
                    </p>
                    <p className="text-xs text-slate-600">
                      {timeAgo(cp.created_at)}
                      {cp.file_path && ` \u00b7 ${cp.file_path}`}
                    </p>
                  </div>
                  <button
                    onClick={() => restoreCheckpoint(cp.id)}
                    className="shrink-0 ml-3 text-xs bg-[#2a2a3a] hover:bg-violet-600/30 hover:text-violet-400 text-slate-400 rounded-lg px-2.5 py-1 transition-colors"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
