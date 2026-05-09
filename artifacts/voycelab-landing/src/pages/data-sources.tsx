import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  ArrowLeft,
  Database,
  FileText,
  Loader2,
  Mail,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

/**
 * Data Sources — backend connectors for the General Business Assistant.
 *
 *  - Knowledge: upload text, PDF, or DOCX files. Embedded server-side and
 *    searched via the search_knowledge voice tool.
 *  - Database: a read-only Postgres connection string. Exposed to the
 *    query_database tool. Stored encrypted at rest.
 *  - Email: a Resend API key + from-address. Powers the send_email tool.
 *
 * All three are scoped to the signed-in user.
 */

type Doc = {
  id: string;
  title: string;
  sourceType: string;
  sourceUri: string | null;
  byteCount: number;
  chunkCount: number;
  createdAt: string;
};

type DbConn = {
  id: string;
  label: string;
  kind: string;
  schemaHint: string | null;
  createdAt: string;
};

type EmailConfig = {
  id: string;
  provider: string;
  fromAddress: string;
  fromName: string | null;
  createdAt: string;
} | null;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getHeaders(extra: Record<string, string> = {}) {
  const token = localStorage.getItem("voycelab_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("voycelab_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function DataSources() {
  const [, setLocation] = useLocation();
  const { data: auth, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !auth?.user) setLocation("/login");
  }, [auth, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-vl-brass2)" }} />
      </div>
    );
  }
  if (!auth?.user) return null;

  return (
    <div className="flex-1 pt-20 sm:pt-24 pb-16">
      <div className="w-full max-w-[960px] mx-auto px-4 sm:px-6 lg:px-10">
      <Link
        href="/command"
        className="inline-flex items-center gap-2 text-sm mb-6"
        style={{ color: "rgba(10,10,11,0.62)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Back to command
      </Link>
      <h1 className="text-[34px] font-semibold tracking-tight mb-2" style={{ color: "var(--color-vl-ink)" }}>Data sources</h1>
      <p className="text-[14px] mb-10" style={{ color: "rgba(10,10,11,0.62)" }}>
        Connect the systems your General Business Assistant should reach for: a knowledge base it can quote
        from, a read-only database it can query, and an email account it can send from.
      </p>

      <div className="space-y-10">
        <KnowledgeSection />
        <DatabaseSection />
        <EmailSection />
      </div>
      </div>
    </div>
  );
}

// ── Knowledge ────────────────────────────────────────────────────────────────

function KnowledgeSection() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/documents", { headers: getAuthHeader() });
      const data = await res.json();
      setDocs(data.documents ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submitText = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/knowledge/documents", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ title: title.trim(), text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setMsg({ tone: "ok", text: `Indexed “${data.title}” (${data.chunkCount} chunks).` });
      setTitle("");
      setText("");
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const submitFile = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", file.name);
      const res = await fetch("/api/v1/knowledge/documents/upload", {
        method: "POST",
        headers: getAuthHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setMsg({ tone: "ok", text: `Indexed “${data.title}” (${data.chunkCount} chunks).` });
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this document and all its chunks?")) return;
    await fetch(`/api/v1/knowledge/documents/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    await load();
  };

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-[0_1px_2px_rgba(10,10,11,0.04),0_8px_24px_-12px_rgba(10,10,11,0.10)]">
      <div className="flex items-center gap-3 mb-4">
        <FileText className="w-5 h-5" style={{ color: "var(--color-vl-accent)" }} />
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-vl-ink)" }}>Knowledge base</h2>
      </div>
      <p className="text-[14px] mb-6" style={{ color: "rgba(10,10,11,0.62)" }}>
        Upload PDFs, Word docs, or paste text. The assistant will use <code className="rounded px-1" style={{ color: "var(--color-vl-ink)", background: "rgba(10,10,11,0.06)" }}>search_knowledge</code> to
        quote from these when relevant.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <form onSubmit={submitText} className="space-y-3">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35"
          />
          <textarea
            placeholder="Paste text here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35 resize-y"
          />
          <button
            type="submit"
            disabled={busy || !title.trim() || !text.trim()}
            className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add text
          </button>
        </form>

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-black/[0.12] rounded-lg p-6 cursor-pointer hover:border-black/[0.25] bg-[var(--color-vl-cream)]/50">
          <Upload className="w-6 h-6 mb-2" style={{ color: "var(--color-vl-accent)" }} />
          <div className="text-sm" style={{ color: "var(--color-vl-ink)" }}>Upload a file</div>
          <div className="text-xs mt-1" style={{ color: "rgba(10,10,11,0.52)" }}>PDF, DOCX, TXT, MD, HTML - up to 10 MB</div>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/html,text/markdown"
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) submitFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {msg && (
        <div
          className={`text-sm mb-4 ${msg.tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}
          role={msg.tone === "error" ? "alert" : undefined}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>Loading...</div>
      ) : docs.length === 0 ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>No documents yet.</div>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm" style={{ color: "var(--color-vl-ink)" }}>{d.title}</div>
                <div className="text-xs" style={{ color: "rgba(10,10,11,0.52)" }}>
                  {d.chunkCount} chunks · {fmtBytes(d.byteCount)} · {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => remove(d.id)}
                className="p-2 rounded-md text-black/45 hover:text-rose-600 hover:bg-black/[0.04]"
                aria-label="Delete document"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Database ─────────────────────────────────────────────────────────────────

function DatabaseSection() {
  const [conns, setConns] = useState<DbConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [label, setLabel] = useState("default");
  const [connectionString, setConnectionString] = useState("");
  const [schemaHint, setSchemaHint] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/database-connections", { headers: getAuthHeader() });
      const data = await res.json();
      setConns(data.connections ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!connectionString.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/knowledge/database-connections", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          label: label.trim() || "default",
          connectionString: connectionString.trim(),
          schemaHint: schemaHint.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMsg({ tone: "ok", text: "Connection saved." });
      setConnectionString("");
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this database connection?")) return;
    await fetch(`/api/v1/knowledge/database-connections/${id}`, {
      method: "DELETE",
      headers: getAuthHeader(),
    });
    await load();
  };

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-[0_1px_2px_rgba(10,10,11,0.04),0_8px_24px_-12px_rgba(10,10,11,0.10)]">
      <div className="flex items-center gap-3 mb-4">
        <Database className="w-5 h-5" style={{ color: "var(--color-vl-accent)" }} />
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-vl-ink)" }}>Database</h2>
      </div>
      <p className="text-[14px] mb-2" style={{ color: "rgba(10,10,11,0.62)" }}>
        Read-only Postgres. The assistant gets a <code className="rounded px-1" style={{ color: "var(--color-vl-ink)", background: "rgba(10,10,11,0.06)" }}>query_database</code> tool that runs SELECT
        statements (capped at 100 rows, 8 second timeout). The connection string is encrypted at rest.
      </p>
      <p className="text-xs mb-6" style={{ color: "#8A6318" }}>
        <strong>Recommended:</strong> create a dedicated read-only role on your database and use its credentials here.
        Example: <code style={{ color: "#76520B" }}>CREATE ROLE voycelab_ro LOGIN PASSWORD '...'; GRANT CONNECT ON DATABASE
        mydb TO voycelab_ro; GRANT USAGE ON SCHEMA public TO voycelab_ro; GRANT SELECT ON ALL TABLES IN SCHEMA public TO
        voycelab_ro;</code>
      </p>

      <form onSubmit={save} className="space-y-3 mb-6">
        <div className="grid md:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Label (e.g. analytics)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35"
          />
          <input
            type="text"
            placeholder="postgres://user:pass@host:5432/db"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            className="md:col-span-2 bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm font-mono text-[color:var(--color-vl-ink)] placeholder:text-black/35"
          />
        </div>
        <textarea
          placeholder="Optional schema hint shown to the assistant (table names, columns, joins)…"
          value={schemaHint}
          onChange={(e) => setSchemaHint(e.target.value)}
          rows={3}
          className="w-full bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35 resize-y"
        />
        <button
          type="submit"
          disabled={busy || !connectionString.trim()}
          className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save connection
        </button>
      </form>

      {msg && (
        <div className={`text-sm mb-4 ${msg.tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>Loading...</div>
      ) : conns.length === 0 ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>No connections configured.</div>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {conns.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-mono" style={{ color: "var(--color-vl-ink)" }}>{c.label}</div>
                <div className="text-xs" style={{ color: "rgba(10,10,11,0.52)" }}>
                  {c.kind}
                  {c.schemaHint ? ` · ${c.schemaHint.slice(0, 80)}${c.schemaHint.length > 80 ? "…" : ""}` : ""}
                </div>
              </div>
              <button
                onClick={() => remove(c.id)}
                className="p-2 rounded-md text-black/45 hover:text-rose-600 hover:bg-black/[0.04]"
                aria-label="Delete connection"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Email ────────────────────────────────────────────────────────────────────

function EmailSection() {
  const [config, setConfig] = useState<EmailConfig>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [provider, setProvider] = useState<"resend" | "gmail_oauth">("gmail_oauth");
  const [apiKey, setApiKey] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/knowledge/email", { headers: getAuthHeader() });
      const data = await res.json();
      setConfig(data.email ?? null);
      if (data.email) {
        setFromAddress(data.email.fromAddress ?? "");
        setFromName(data.email.fromName ?? "");
        if (data.email.provider === "gmail_oauth" || data.email.provider === "resend") {
          setProvider(data.email.provider);
        }
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const saveResend = async (e: FormEvent) => {
    e.preventDefault();
    if (!fromAddress.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/knowledge/email", {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          provider: "resend",
          apiKey: apiKey.trim() || undefined,
          fromAddress: fromAddress.trim(),
          fromName: fromName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMsg({ tone: "ok", text: "Email config saved." });
      setApiKey("");
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  };

  const connectGmail = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const params = new URLSearchParams();
      if (fromName.trim()) params.set("fromName", fromName.trim());
      const res = await fetch(`/api/oauth/google/start?${params}`, { headers: getAuthHeader() });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Failed to start Gmail OAuth");

      // Clear any stale signal then open the popup.
      try { localStorage.removeItem("voycelab_gmail_oauth_result"); } catch {}
      const popup = window.open(data.url, "gmail-oauth", "width=520,height=640");
      if (!popup) throw new Error("Popup blocked. Allow popups and try again.");
      const popupRef = popup;

      // Poll localStorage (works even if the popup ends up cross-origin temporarily).
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const onMessage = (ev: MessageEvent) => {
          if (ev.data?.type === "gmail-oauth-result") {
            cleanup();
            ev.data.ok ? resolve() : reject(new Error(ev.data.error || "Authorization failed"));
          }
        };
        window.addEventListener("message", onMessage);
        const interval = window.setInterval(() => {
          try {
            const raw = localStorage.getItem("voycelab_gmail_oauth_result");
            if (raw) {
              localStorage.removeItem("voycelab_gmail_oauth_result");
              const payload = JSON.parse(raw);
              cleanup();
              payload.ok ? resolve() : reject(new Error(payload.error || "Authorization failed"));
              return;
            }
          } catch {}
          if (popupRef.closed && Date.now() - start > 1500) {
            cleanup();
            reject(new Error("Popup was closed before authorization completed."));
          }
          if (Date.now() - start > 5 * 60 * 1000) {
            cleanup();
            reject(new Error("Authorization timed out."));
          }
        }, 500);
        function cleanup() {
          window.removeEventListener("message", onMessage);
          window.clearInterval(interval);
          try { popupRef.close(); } catch {}
        }
      });

      setMsg({ tone: "ok", text: "Gmail connected." });
      await load();
    } catch (err) {
      setMsg({ tone: "error", text: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Disconnect email?")) return;
    await fetch("/api/v1/knowledge/email", { method: "DELETE", headers: getAuthHeader() });
    setConfig(null);
    setApiKey("");
    setFromAddress("");
    setFromName("");
  };

  const isGmailConnected = config?.provider === "gmail_oauth";
  const isResendConnected = config?.provider === "resend";

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-6 shadow-[0_1px_2px_rgba(10,10,11,0.04),0_8px_24px_-12px_rgba(10,10,11,0.10)]">
      <div className="flex items-center gap-3 mb-4">
        <Mail className="w-5 h-5" style={{ color: "var(--color-vl-accent)" }} />
        <h2 className="text-xl font-semibold" style={{ color: "var(--color-vl-ink)" }}>Email</h2>
      </div>
      <p className="text-[14px] mb-4" style={{ color: "rgba(10,10,11,0.62)" }}>
        Choose how outbound mail is sent. The <code className="rounded px-1" style={{ color: "var(--color-vl-ink)", background: "rgba(10,10,11,0.06)" }}>send_email</code> tool delivers from this address — the assistant always reads the recipient and subject back to you before sending.
      </p>

      {loading ? (
        <div className="text-sm" style={{ color: "rgba(10,10,11,0.52)" }}>Loading...</div>
      ) : (
        <>
          <div className="flex gap-2 mb-4" role="tablist" aria-label="Email provider">
            <button
              type="button"
              role="tab"
              aria-selected={provider === "gmail_oauth"}
              onClick={() => setProvider("gmail_oauth")}
              className={`px-3 py-1.5 text-sm rounded-full border transition ${provider === "gmail_oauth" ? "bg-[color:var(--color-vl-ink)] text-white border-transparent" : "border-black/[0.12] text-[color:var(--color-vl-ink)]"}`}
            >
              Gmail
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={provider === "resend"}
              onClick={() => setProvider("resend")}
              className={`px-3 py-1.5 text-sm rounded-full border transition ${provider === "resend" ? "bg-[color:var(--color-vl-ink)] text-white border-transparent" : "border-black/[0.12] text-[color:var(--color-vl-ink)]"}`}
            >
              Resend
            </button>
          </div>

          {provider === "gmail_oauth" ? (
            <div className="space-y-3">
              <p className="text-[13px]" style={{ color: "rgba(10,10,11,0.55)" }}>
                Sign in with Google to grant VoyceLab the <code className="rounded px-1" style={{ background: "rgba(10,10,11,0.06)" }}>gmail.send</code> scope. Mail is sent from your Gmail address — no app password, no SMTP setup. Daily limit ≈ 500 emails. You can revoke access any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--color-vl-accent)" }}>your Google Account</a>.
              </p>

              {isGmailConnected ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm flex items-center justify-between">
                  <span style={{ color: "var(--color-vl-ink)" }}>Connected as <strong>{config?.fromAddress}</strong></span>
                </div>
              ) : null}

              <input
                type="text"
                placeholder="From name (optional, e.g. Acme Bar)"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                className="w-full bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35"
              />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={connectGmail}
                  disabled={busy}
                  className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isGmailConnected ? "Reconnect Gmail" : "Connect Gmail"}
                </button>
                {config && (
                  <button
                    type="button"
                    onClick={remove}
                    className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Disconnect
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={saveResend} className="space-y-3">
              <p className="text-[13px]" style={{ color: "rgba(10,10,11,0.55)" }}>
                Plug in a <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--color-vl-accent)" }}>Resend</a> API key. Best for sending from a verified custom domain.
              </p>
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  type="email"
                  placeholder="From address (e.g. ops@yourdomain.com)"
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  className="bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35"
                  required
                />
                <input
                  type="text"
                  placeholder="From name (optional)"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  className="bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm text-[color:var(--color-vl-ink)] placeholder:text-black/35"
                />
              </div>
              <input
                type="password"
                placeholder={isResendConnected ? "Resend API key (leave blank to keep current)" : "Resend API key (re_…)"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-white border border-black/[0.12] rounded-lg px-3 py-2 text-sm font-mono text-[color:var(--color-vl-ink)] placeholder:text-black/35"
                autoComplete="new-password"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={busy || !fromAddress.trim() || (!isResendConnected && !apiKey.trim())}
                  className="vl-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isResendConnected ? "Update" : "Save"}
                </button>
                {config && (
                  <button
                    type="button"
                    onClick={remove}
                    className="vl-btn-outline inline-flex items-center gap-2 px-4 py-2 text-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Disconnect
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}

      {msg && (
        <div className={`text-sm mt-4 ${msg.tone === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</div>
      )}
    </section>
  );
}
