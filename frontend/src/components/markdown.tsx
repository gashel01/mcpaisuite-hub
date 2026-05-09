"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-slate-500 hover:text-slate-300 transition-colors p-1"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!ref.current || rendered) return;
    import("mermaid").then((m) => {
      m.default.initialize({ startOnLoad: false, theme: "dark", themeVariables: {
        primaryColor: "#6366f1", primaryTextColor: "#e2e8f0", primaryBorderColor: "#4f46e5",
        lineColor: "#6366f1", secondaryColor: "#1e1b4b", tertiaryColor: "#0f172a",
        mainBkg: "#1e1b4b", nodeBorder: "#6366f1", clusterBkg: "#0f172a",
        fontSize: "14px",
      }});
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      m.default.render(id, code).then(({ svg }) => {
        if (ref.current) { ref.current.innerHTML = svg; setRendered(true); }
      }).catch(() => {});
    }).catch(() => {});
  }, [code, rendered]);

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-slate-700/60 bg-[#0d1117] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-slate-500 font-mono uppercase">diagram</span>
        <CopyButton text={code} />
      </div>
      <div ref={ref} className="flex justify-center overflow-x-auto" />
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  if (lang === "mermaid") return <MermaidBlock code={code} />;
  return (
    <div className="group relative my-2 rounded-lg overflow-hidden border border-slate-700/60 bg-[#0d1117]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/60">
        <span className="text-[10px] text-slate-500 font-mono uppercase">{lang || "text"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="px-4 py-3 overflow-x-auto text-[13px] leading-relaxed">
        <code className="text-slate-300 font-mono">{code}</code>
      </pre>
    </div>
  );
}

export function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(<CodeBlock key={key++} code={codeLines.join("\n")} lang={lang || undefined} />);
      continue;
    }

    if (line.startsWith("### ")) { elements.push(<h4 key={key++} className="text-sm font-semibold text-slate-100 mt-3 mb-1">{renderInline(line.slice(4))}</h4>); i++; continue; }
    if (line.startsWith("## ")) { elements.push(<h3 key={key++} className="text-base font-semibold text-slate-100 mt-4 mb-1">{renderInline(line.slice(3))}</h3>); i++; continue; }
    if (line.startsWith("# ")) { elements.push(<h2 key={key++} className="text-lg font-bold text-slate-100 mt-4 mb-2">{renderInline(line.slice(2))}</h2>); i++; continue; }

    if (/^[\s]*[-*]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i])) {
        items.push(<li key={key++} className="text-slate-300">{renderInline(lines[i].replace(/^[\s]*[-*]\s/, ""))}</li>);
        i++;
      }
      elements.push(<ul key={key++} className="list-disc list-inside space-y-0.5 my-1 ml-1">{items}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={key++} className="text-slate-300">{renderInline(lines[i].replace(/^\d+\.\s/, ""))}</li>);
        i++;
      }
      elements.push(<ol key={key++} className="list-decimal list-inside space-y-0.5 my-1 ml-1">{items}</ol>);
      continue;
    }

    if (/^---+$/.test(line.trim())) { elements.push(<hr key={key++} className="border-slate-700/50 my-3" />); i++; continue; }
    if (line.trim() === "") { i++; continue; }

    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !/^[\s]*[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !/^---+$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    elements.push(<p key={key++} className="text-slate-200 leading-relaxed my-1">{renderInline(paraLines.join("\n"))}</p>);
  }

  return elements;
}

export function renderInline(text: string): React.ReactNode[] {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<]+)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|~~([^~]+)~~/g;
  const elements: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let k = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) elements.push(text.slice(lastIdx, match.index));
    if (match[1] && match[2]) elements.push(<a key={k++} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 underline underline-offset-2 decoration-violet-500/50">{match[1]}</a>);
    else if (match[3]) { const url = match[3]; elements.push(<a key={k++} href={url} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 underline underline-offset-2 decoration-violet-500/50">{url.length > 60 ? url.slice(0, 57) + "..." : url}</a>); }
    else if (match[4]) elements.push(<strong key={k++} className="text-slate-100 font-semibold">{match[4]}</strong>);
    else if (match[5]) elements.push(<em key={k++} className="text-slate-300 italic">{match[5]}</em>);
    else if (match[6]) elements.push(<code key={k++} className="bg-slate-700/60 text-violet-300 px-1.5 py-0.5 rounded text-[13px] font-mono">{match[6]}</code>);
    else if (match[7]) elements.push(<del key={k++} className="text-slate-500">{match[7]}</del>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) elements.push(text.slice(lastIdx));
  return elements.length > 0 ? elements : [text];
}
