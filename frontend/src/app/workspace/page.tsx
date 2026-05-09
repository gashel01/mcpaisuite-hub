"use client";

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
  Loader2,
  Search,
  Eye,
  ArrowLeft,
  FolderPlus,
  Plus,
} from "lucide-react";
import { useTenant } from "@/context/tenant";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8007";

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
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const headers: Record<string, string> = activeTenant
    ? { "X-Tenant-Id": activeTenant }
    : {};

  // ── Data fetching ─────────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    try {
      const res = await fetch(
        `${BASE}/workspace/files?path=${encodeURIComponent(currentPath)}&recursive=false`,
        { headers }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      // Sort: dirs first, then alphabetical
      const sorted = (data.files || []).sort((a: WsFile, b: WsFile) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return fileName(a.path).localeCompare(fileName(b.path));
      });
      setFiles(sorted);
    } catch (_e) {
      setFiles([]);
    }
  }, [currentPath, activeTenant]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/workspace/stats`, { headers });
      const data = await res.json();
      setStats(data);
    } catch (_e) {
      setStats(null);
    }
  }, [activeTenant]);

  const loadCheckpoints = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/workspace/checkpoints`, { headers });
      const data = await res.json();
      setCheckpoints(data.checkpoints || []);
    } catch (_e) {
      setCheckpoints([]);
    }
  }, [activeTenant]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([loadFiles(), loadStats(), loadCheckpoints()]).finally(() =>
      setLoading(false)
    );
  }, [loadFiles, loadStats, loadCheckpoints]);

  // Auto-refresh every 10s
  useEffect(() => {
    const id = setInterval(() => {
      loadFiles();
      loadStats();
    }, 10000);
    return () => clearInterval(id);
  }, [loadFiles, loadStats]);

  // ── File operations ───────────────────────────────────────────────────────

  const openFile = async (path: string) => {
    try {
      const res = await fetch(
        `${BASE}/workspace/file?path=${encodeURIComponent(path)}`,
        { headers }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
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
      const res = await fetch(`${BASE}/workspace/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ path: selectedFile.path, content: editContent }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSelectedFile({ ...selectedFile, content: editContent, size: data.size });
      setEditMode(false);
      loadFiles();
      loadStats();
    } catch (_e) {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      await fetch(`${BASE}/workspace/folder`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: fullPath }),
      });
      setNewFolderName("");
      setShowNewFolder(false);
      loadFiles();
    } catch (_e) { /* ignore */ }
  };

  const deleteFile = async (path: string) => {
    try {
      await fetch(`${BASE}/workspace/file?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
        headers,
      });
      if (selectedFile?.path === path) setSelectedFile(null);
      setDeleteConfirm(null);
      loadFiles();
      loadStats();
    } catch (_e) {
      // ignore
    }
  };

  const downloadFile = async (path: string) => {
    try {
      const res = await fetch(
        `${BASE}/workspace/file?path=${encodeURIComponent(path)}`,
        { headers }
      );
      const data = await res.json();
      const blob = new Blob([data.content || ""], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(path);
      a.click();
      URL.revokeObjectURL(url);
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
        const res = await fetch(`${BASE}/workspace/upload`, {
          method: "POST",
          headers,
          body: form,
        });
        if (!res.ok) throw new Error(await res.text());
        setUploads((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, status: "done" } : u))
        );
        loadFiles();
        loadStats();
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
    [headers, loadFiles, loadStats]
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
      await fetch(`${BASE}/workspace/checkpoints/${id}/restore`, {
        method: "POST",
        headers,
      });
      loadFiles();
    } catch (_e) {
      // ignore
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
    <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FolderOpen className="h-5 w-5 md:h-6 md:w-6 text-violet-500" />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-100">
              Workspace
            </h1>
            <p className="text-xs text-slate-500">
              {stats?.available
                ? `${stats.total_files ?? 0} files \u00b7 ${formatSize(stats.total_size ?? 0)}`
                : "Workspace not connected"}
              {stats?.languages && Object.keys(stats.languages).length > 0 && (
                <span className="ml-1.5 text-slate-600">
                  {Object.keys(stats.languages).slice(0, 4).join(", ")}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* New Folder */}
          <button
            onClick={() => setShowNewFolder(!showNewFolder)}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            <FolderPlus size={14} />
            <span className="hidden sm:inline">New Folder</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => {
              loadFiles();
              loadStats();
              loadCheckpoints();
            }}
            className="flex items-center gap-1.5 bg-[#16161e] border border-[#2a2a3a] hover:border-violet-600 text-slate-400 hover:text-slate-200 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* New Folder inline form */}
      {showNewFolder && (
        <div className="flex gap-2 items-center bg-[#16161e] border border-violet-600/50 rounded-xl px-4 py-3">
          <FolderPlus size={18} className="text-violet-400 shrink-0" />
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
            placeholder={currentPath ? `New folder in ${currentPath}/...` : "New folder name..."}
            className="flex-1 bg-transparent border-none outline-none text-sm text-slate-100 placeholder-slate-500"
          />
          <button onClick={createFolder} disabled={!newFolderName.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg px-3 py-1 text-xs transition-colors">
            Create
          </button>
          <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Upload drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-violet-500 bg-violet-950/30"
            : "border-[#2a2a3a] hover:border-violet-700 hover:bg-[#1a1a24]"
        }`}
      >
        <Upload
          className={`h-6 w-6 mx-auto mb-2 ${
            dragOver ? "text-violet-400" : "text-slate-600"
          }`}
        />
        <p className="text-sm text-slate-400">
          Drop files here or{" "}
          <span className="text-violet-400 underline">browse</span>
        </p>
        <p className="text-xs text-slate-600 mt-0.5">
          Files will be saved to{" "}
          {currentPath ? `/${currentPath}` : "workspace root"}
        </p>
        <input
          ref={fileRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          {uploads.slice(0, 5).map((u, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-[#16161e] border border-[#2a2a3a] rounded-lg px-3 py-2"
            >
              <FileText className="h-4 w-4 text-slate-500 shrink-0" />
              <span className="text-sm text-slate-300 flex-1 truncate">
                {u.name}
              </span>
              <span className="text-xs text-slate-600">
                {formatSize(u.size)}
              </span>
              {u.status === "uploading" && (
                <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
              )}
              {u.status === "done" && (
                <span className="text-xs text-emerald-400">Done</span>
              )}
              {u.status === "error" && (
                <span className="text-xs text-red-400" title={u.error}>
                  Failed
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Breadcrumbs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <nav className="flex items-center gap-1 text-sm overflow-x-auto">
          <button
            onClick={() => navigateTo("")}
            className={`px-1.5 py-0.5 rounded transition-colors shrink-0 ${
              !currentPath
                ? "text-violet-400 font-medium"
                : "text-slate-400 hover:text-slate-200"
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

        {/* Search filter */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files..."
            className="bg-[#16161e] border border-[#2a2a3a] rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500 w-full sm:w-48"
          />
        </div>
      </div>

      {/* File browser + Preview */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* File list */}
        <div
          className={`bg-[#16161e] border border-[#2a2a3a] rounded-xl overflow-hidden flex-1 transition-all ${
            selectedFile ? "lg:w-1/2" : "w-full"
          }`}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <FolderOpen className="h-10 w-10 text-slate-700 mb-3" />
              <p className="text-sm text-slate-500 text-center">
                {searchQuery
                  ? "No files match your filter"
                  : "No files yet. Upload files or use the chat to create them."}
              </p>
            </div>
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

                    {filteredFiles.map((f) => (
                      <tr
                        key={f.path}
                        onClick={() => {
                          if (f.is_dir) navigateTo(f.path);
                          else openFile(f.path);
                        }}
                        className={`cursor-pointer hover:bg-[#1e1e2a] transition-colors border-b border-[#2a2a3a]/50 ${
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
                          {!f.is_dir && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadFile(f.path);
                                }}
                                className="p-1 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-slate-300 transition-colors"
                                title="Download"
                              >
                                <Download size={14} />
                              </button>
                              {deleteConfirm === f.path ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteFile(f.path);
                                  }}
                                  className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs transition-colors"
                                >
                                  Confirm
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirm(f.path);
                                    setTimeout(
                                      () => setDeleteConfirm(null),
                                      3000
                                    );
                                  }}
                                  className="p-1 rounded hover:bg-[#2a2a3a] text-slate-500 hover:text-red-400 transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
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

                {filteredFiles.map((f) => (
                  <div
                    key={f.path}
                    onClick={() => {
                      if (f.is_dir) navigateTo(f.path);
                      else openFile(f.path);
                    }}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1e1e2a] transition-colors ${
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
                            if (deleteConfirm === f.path) deleteFile(f.path);
                            else {
                              setDeleteConfirm(f.path);
                              setTimeout(() => setDeleteConfirm(null), 3000);
                            }
                          }}
                          className={`p-1.5 rounded hover:bg-[#2a2a3a] transition-colors ${
                            deleteConfirm === f.path
                              ? "text-red-400"
                              : "text-slate-500"
                          }`}
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

        {/* File preview panel */}
        {selectedFile && (
          <div className="bg-[#16161e] border border-[#2a2a3a] rounded-xl overflow-hidden lg:w-1/2 animate-in slide-in-from-right-4 duration-200">
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
                        <Loader2 size={14} className="animate-spin" />
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
            <div className="max-h-[60vh] overflow-auto">
              {editMode ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-[55vh] bg-transparent text-sm text-slate-300 font-mono p-4 focus:outline-none resize-none leading-relaxed"
                  spellCheck={false}
                />
              ) : (
                <div className="relative">
                  <div className="flex text-sm font-mono leading-relaxed">
                    {/* Line numbers */}
                    <div className="select-none px-3 py-4 text-right text-slate-700 border-r border-[#2a2a3a] bg-[#12121a] shrink-0">
                      {(selectedFile.content || "")
                        .split("\n")
                        .map((_, i) => (
                          <div key={i} className="h-[1.625rem]">
                            {i + 1}
                          </div>
                        ))}
                    </div>
                    {/* Code */}
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
