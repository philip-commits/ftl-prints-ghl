"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { DashboardData, ActionItem, SentStatus } from "@/lib/ghl/types";

const PIPELINE_STAGES = [
  { id: "29fcf7b0-289c-44a4-ad25-1d1a0aea9063", name: "New Lead" },
  { id: "5ee824df-7708-4aba-9177-d5ac02dd6828", name: "In Progress" },
  { id: "336a5bee-cad2-400f-83fd-cae1bc837029", name: "Quote Sent" },
  { id: "259ee5f4-5667-4797-948e-f36ec28c70a0", name: "Invoice Sent" },
  { id: "1ab155c2-282d-45eb-bd43-1052489eb2a1", name: "Sale" },
  { id: "7ec748b8-920d-4bdb-bf09-74dd22d27846", name: "Cooled Off" },
  { id: "b909061c-9141-45d7-b1e2-fd37432c3596", name: "Unqualified" },
];

const STAGE_NAME_TO_ID: Record<string, string> = {};
const STAGE_ID_TO_NAME: Record<string, string> = {};
for (const s of PIPELINE_STAGES) {
  STAGE_NAME_TO_ID[s.name] = s.id;
  STAGE_ID_TO_NAME[s.id] = s.name;
}

function fmtPhone(p: string): string {
  if (!p) return "";
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1")
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return p;
}

function textToHtml(text: string): string {
  return (
    "<p>" +
    text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") +
    "</p>"
  );
}

// --- Inline Styles ---
const styles = {
  root: { lineHeight: 1.6, padding: 24, maxWidth: 1000, margin: "0 auto" } as React.CSSProperties,
  dateLine: { color: "#94a3b8", fontSize: "0.9rem", marginBottom: 24 } as React.CSSProperties,
  statsBar: { display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" as const } as React.CSSProperties,
  statPill: { background: "#1e293b", border: "1px solid #334155", borderRadius: 20, padding: "8px 16px", fontSize: "0.85rem" } as React.CSSProperties,
  card: { background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "16px 20px", marginBottom: 12, transition: "opacity 0.3s", scrollMarginTop: 20 } as React.CSSProperties,
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } as React.CSSProperties,
  badge: { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase" as const } as React.CSSProperties,
  contactName: { fontWeight: 600, fontSize: "1rem" } as React.CSSProperties,
  context: { color: "#94a3b8", fontSize: "0.85rem", marginBottom: 8 } as React.CSSProperties,
  input: { width: "100%", marginBottom: 6, background: "#334155", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 4, padding: 6, fontSize: "0.85rem", boxSizing: "border-box" as const } as React.CSSProperties,
  textarea: { width: "100%", background: "#334155", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 4, padding: 8, fontFamily: "inherit", fontSize: "0.85rem", boxSizing: "border-box" as const } as React.CSSProperties,
  composeArea: { background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "12px 16px", marginTop: 10 } as React.CSSProperties,
  composeHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } as React.CSSProperties,
  composeLabel: { fontSize: "0.8rem", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.04em" } as React.CSSProperties,
  section: { background: "#1e293b", borderRadius: 10, border: "1px solid #334155", marginBottom: 20, overflow: "hidden", scrollMarginTop: 20 } as React.CSSProperties,
  sectionHeader: { padding: "16px 20px", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", userSelect: "none" as const, color: "#94a3b8" } as React.CSSProperties,
  priorityLabel: { fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: 12 } as React.CSSProperties,
  noActionItem: { padding: "6px 0", fontSize: "0.85rem", color: "#94a3b8", borderBottom: "1px solid #334155" } as React.CSSProperties,
  inactiveBar: { display: "flex", gap: 24, padding: "12px 0" } as React.CSSProperties,
  loading: { textAlign: "center" as const, padding: "60px 0", color: "#94a3b8", fontSize: "1.1rem" } as React.CSSProperties,
  iconBtn: { background: "none", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", cursor: "pointer", padding: "5px 7px", lineHeight: 1, display: "inline-flex", alignItems: "center", transition: "all 0.15s" } as React.CSSProperties,
  dismissBtn: { background: "none", border: "none", color: "#94a3b8", fontSize: "1.2rem", cursor: "pointer", padding: "2px 6px", lineHeight: 1, opacity: 0.4 } as React.CSSProperties,
  checkBadge: { position: "absolute", bottom: -4, right: -4, background: "#16a34a", color: "#fff", fontSize: "0.55rem", fontWeight: 700, borderRadius: "50%", width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", lineHeight: 1 } as React.CSSProperties,
  sidebar: { position: "fixed", top: 0, left: 0, width: 220, height: "100vh", background: "#0b1120", borderRight: "1px solid #1e293b", overflowY: "auto", padding: "16px 0", zIndex: 100, boxSizing: "border-box" } as React.CSSProperties,
  sidebarGroupLabel: { fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 16px 4px", color: "#475569" } as React.CSSProperties,
  sidebarItem: { display: "block", width: "100%", padding: "6px 16px", fontSize: "0.8rem", color: "#94a3b8", background: "none", border: "none", borderLeftWidth: 2, borderLeftStyle: "solid", borderLeftColor: "transparent", textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "all 0.15s", boxSizing: "border-box" } as React.CSSProperties,
  sidebarItemActive: { color: "#f1f5f9", borderLeftColor: "#38bdf8" } as React.CSSProperties,
};

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  "New Lead": { bg: "#450a0a", color: "#ef4444" },
  "In Progress": { bg: "#422006", color: "#eab308" },
  "Quote Sent": { bg: "#1e3a5f", color: "#60a5fa" },
  "Invoice Sent": { bg: "#052e16", color: "#22c55e" },
  Sale: { bg: "#052e16", color: "#22c55e" },
  "Cooled Off": { bg: "#1e1b4b", color: "#818cf8" },
  Unqualified: { bg: "#334155", color: "#94a3b8" },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444",
  medium: "#eab308",
  low: "#94a3b8",
};

// --- SVG Icons ---
const EmailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 7L2 7" />
  </svg>
);
const SmsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const NoteIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);
const MoveIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);
const PhoneIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

// --- Button Component ---
function SendButton({
  label,
  sentLabel,
  status,
  onClick,
  variant = "default",
}: {
  label: string;
  sentLabel: string;
  status: "ready" | "sending" | "sent" | "failed";
  onClick: () => void;
  variant?: "default" | "move";
}) {
  const baseStyle: React.CSSProperties = {
    padding: "6px 16px",
    borderRadius: 6,
    border: "none",
    fontWeight: 600,
    fontSize: "0.8rem",
    cursor: status === "sent" ? "default" : status === "sending" ? "wait" : "pointer",
  };

  let bg: string, color: string;
  if (status === "sent") {
    bg = "#052e16";
    color = "#22c55e";
  } else if (status === "failed") {
    bg = "#450a0a";
    color = "#ef4444";
  } else if (status === "sending") {
    bg = "#334155";
    color = "#94a3b8";
  } else if (variant === "move") {
    bg = "#1e1b4b";
    color = "#818cf8";
  } else {
    bg = "#38bdf8";
    color = "#0f172a";
  }

  const text =
    status === "sent"
      ? sentLabel
      : status === "sending"
        ? "..."
        : status === "failed"
          ? "Failed — retry"
          : label;

  return (
    <button
      style={{ ...baseStyle, background: bg, color }}
      onClick={onClick}
      disabled={status === "sent" || status === "sending"}
    >
      {text}
    </button>
  );
}

// --- Compose Area ---
function ComposeArea({
  action,
  sentStatus,
  onSent,
  openPanel,
  onStageMove,
}: {
  action: ActionItem;
  sentStatus: SentStatus;
  onSent: (key: string, status: string) => void;
  openPanel: string | null;
  onStageMove?: (newStage: string) => void;
}) {
  const [emailSubject, setEmailSubject] = useState(
    action.subject || action.noAnswerSubject || "",
  );
  const [emailBody, setEmailBody] = useState(
    action.message || action.noAnswerEmail || "",
  );
  const [smsBody, setSmsBody] = useState(
    action.smsMessage || action.noAnswerSms || "",
  );
  const [noteBody, setNoteBody] = useState("");
  const [moveStageId, setMoveStageId] = useState(
    STAGE_NAME_TO_ID[action.stage] || "",
  );

  const getStatus = (key: string): "ready" | "sending" | "sent" | "failed" => {
    const s = sentStatus[key];
    if (!s) return "ready";
    return s.status === "sent" || s.status === "noted" || s.status === "moved"
      ? "sent"
      : (s.status as "ready" | "sending" | "sent" | "failed");
  };

  async function sendEmail() {
    const key = String(action.id);
    onSent(key, "sending");
    try {
      const r = await fetch(`/api/send/${action.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "Email",
          subject: emailSubject,
          message: emailBody,
          html: textToHtml(emailBody),
        }),
      });
      const d = await r.json();
      onSent(key, d.success ? "sent" : "failed");
      if (d.success && action.stage === "New Lead" && onStageMove) {
        onStageMove("In Progress");
      }
    } catch {
      onSent(key, "failed");
    }
  }

  async function sendSms() {
    const key = `${action.id}_sms`;
    onSent(key, "sending");
    try {
      const r = await fetch(`/api/send/${action.id}_sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "SMS", message: smsBody }),
      });
      const d = await r.json();
      onSent(key, d.success ? "sent" : "failed");
      if (d.success && action.stage === "New Lead" && onStageMove) {
        onStageMove("In Progress");
      }
    } catch {
      onSent(key, "failed");
    }
  }

  async function saveNote() {
    const key = String(action.id);
    onSent(key + "_note", "sending");
    try {
      const r = await fetch(`/api/note/${action.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody }),
      });
      const d = await r.json();
      onSent(key + "_note", d.success ? "noted" : "failed");
    } catch {
      onSent(key + "_note", "failed");
    }
  }

  async function moveStage() {
    const key = `${action.id}_move`;
    onSent(key, "sending");
    try {
      const r = await fetch(`/api/move/${action.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetStageId: moveStageId }),
      });
      const d = await r.json();
      onSent(key, d.success ? "moved" : "failed");
      if (d.success && onStageMove) {
        onStageMove(STAGE_ID_TO_NAME[moveStageId] || action.stage);
      }
    } catch {
      onSent(key, "failed");
    }
  }

  return (
    <>
      {openPanel === "email" && (
        <div style={styles.composeArea}>
          <div style={styles.composeHeader}>
            <span style={styles.composeLabel}>Email</span>
            <SendButton
              label="Send"
              sentLabel="Sent ✓"
              status={getStatus(String(action.id))}
              onClick={sendEmail}
            />
          </div>
          <input
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Subject..."
            style={styles.input}
          />
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            rows={5}
            style={styles.textarea}
          />
        </div>
      )}
      {openPanel === "sms" && (
        <div style={styles.composeArea}>
          <div style={styles.composeHeader}>
            <span style={styles.composeLabel}>Text Message</span>
            <SendButton
              label="Send"
              sentLabel="Sent ✓"
              status={getStatus(`${action.id}_sms`)}
              onClick={sendSms}
            />
          </div>
          <textarea
            value={smsBody}
            onChange={(e) => setSmsBody(e.target.value)}
            rows={3}
            style={styles.textarea}
          />
        </div>
      )}
      {openPanel === "note" && (
        <div style={styles.composeArea}>
          <div style={styles.composeHeader}>
            <span style={styles.composeLabel}>Note</span>
            <SendButton
              label="Save"
              sentLabel="Saved ✓"
              status={getStatus(`${action.id}_note`)}
              onClick={saveNote}
            />
          </div>
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            rows={3}
            placeholder="Add a note about this lead..."
            style={styles.textarea}
          />
        </div>
      )}
      {openPanel === "move" && (
        <div style={styles.composeArea}>
          <div style={styles.composeHeader}>
            <span style={styles.composeLabel}>Move Stage</span>
            <SendButton
              label="Move"
              sentLabel="Moved ✓"
              status={getStatus(`${action.id}_move`)}
              onClick={moveStage}
              variant="move"
            />
          </div>
          <select
            value={moveStageId}
            onChange={(e) => setMoveStageId(e.target.value)}
            style={{
              ...styles.input,
              cursor: "pointer",
              padding: 8,
            }}
          >
            {PIPELINE_STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

// --- Convo / Notes Toggles ---
function ConvoHistory({ messages }: { messages: ActionItem["conversationHistory"] }) {
  const [open, setOpen] = useState(false);
  if (!messages?.length) return null;

  return (
    <div style={{ flexBasis: "100%" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          cursor: "pointer",
          color: "#94a3b8",
          fontSize: "0.8rem",
          border: "none",
          background: "none",
          padding: "4px 0",
        }}
      >
        {open ? "▾" : "▸"} Messages ({messages.length})
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "8px 12px",
                marginBottom: 6,
                fontSize: "0.8rem",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
                <span
                  style={{
                    fontSize: "0.85rem",
                    color: m.direction === "inbound" ? "#22c55e" : "#38bdf8",
                  }}
                >
                  {m.direction === "inbound" ? "←" : "→"}
                </span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    padding: "1px 5px",
                    borderRadius: 3,
                    background: "#334155",
                    color: "#94a3b8",
                  }}
                >
                  {(m.channel || "").toUpperCase()}
                </span>
                <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>
                  {m.date
                    ? new Date(m.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : ""}
                </span>
              </div>
              <div style={{ color: "#f1f5f9", marginTop: 2 }}>{m.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PriorNotes({ notes }: { notes: ActionItem["notes"] }) {
  const [open, setOpen] = useState(false);
  if (!notes?.length) return null;

  return (
    <div style={{ flexBasis: "100%" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          cursor: "pointer",
          color: "#94a3b8",
          fontSize: "0.8rem",
          border: "none",
          background: "none",
          padding: "4px 0",
        }}
      >
        {open ? "▾" : "▸"} Notes ({notes.length})
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {notes.map((n, i) => (
            <div
              key={i}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 6,
                padding: "8px 12px",
                marginBottom: 6,
                fontSize: "0.8rem",
              }}
            >
              <div style={{ color: "#94a3b8", fontSize: "0.7rem", marginBottom: 2 }}>
                {n.dateAdded
                  ? new Date(n.dateAdded).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : ""}
              </div>
              <div style={{ color: "#f1f5f9" }}>{n.body.replace(/<[^>]*>/g, "")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Generic Action Card ---
function ActionCard({
  action,
  sentStatus,
  onSent,
  onDismiss,
  cardId,
}: {
  action: ActionItem;
  sentStatus: SentStatus;
  onSent: (key: string, status: string) => void;
  onDismiss: () => void;
  cardId?: string;
}) {
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [callState, setCallState] = useState<"idle" | "picked" | "noanswer">("idle");
  useEffect(() => {
    const s = sentStatus[`${action.id}_call`]?.status;
    if (s === "picked" || s === "noanswer") setCallState(s);
  }, [sentStatus, action.id]);
  const [displayStage, setDisplayStage] = useState(action.stage);

  const togglePanel = (panel: string) => {
    setOpenPanel(openPanel === panel ? null : panel);
  };

  const badgeColor = BADGE_COLORS[displayStage] || { bg: "#334155", color: "#94a3b8" };
  const company = action.contactCompany ? ` — ${action.contactCompany}` : "";

  const getStatus = (key: string): "ready" | "sending" | "sent" | "failed" => {
    const s = sentStatus[key];
    if (!s) return "ready";
    return s.status === "sent" || s.status === "noted" || s.status === "moved"
      ? "sent"
      : (s.status as "ready" | "sending" | "sent" | "failed");
  };

  const emailSent = getStatus(String(action.id)) === "sent";
  const smsSent = getStatus(`${action.id}_sms`) === "sent";
  const callLogged = callState === "picked" || callState === "noanswer";
  const noteSent = getStatus(`${action.id}_note`) === "sent";
  const moveSent = getStatus(`${action.id}_move`) === "sent";

  function handleCallClick() {
    if (callState !== "idle") return;
    setOpenPanel(openPanel === "call" ? null : "call");
  }

  function handleAnswered() {
    setCallState("picked");
    setOpenPanel("note");
    onSent(`${action.id}_call`, "picked");
    fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [`${action.id}_call`]: { status: "picked", ts: Date.now() } }),
    }).catch(() => {});
  }

  function handleNoAnswer() {
    setCallState("noanswer");
    setOpenPanel(null);
    onSent(`${action.id}_call`, "noanswer");
    fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [`${action.id}_call`]: { status: "noanswer", ts: Date.now() } }),
    }).catch(() => {});
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    fetch(`/api/note/${action.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: `Called — no answer (${today})` }),
    }).catch(() => {});
  }

  return (
    <div id={cardId} style={styles.card} data-priority={action.priority}>
      <div style={styles.cardTop}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              ...styles.badge,
              background: badgeColor.bg,
              color: badgeColor.color,
            }}
          >
            {displayStage}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button style={styles.iconBtn} onClick={() => togglePanel("email")} title="Send email"><EmailIcon /></button>
            {emailSent && <span style={styles.checkBadge}>&#10003;</span>}
          </span>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button style={{ ...styles.iconBtn, ...(action.contactPhone ? {} : { opacity: 0.25, pointerEvents: "none" as const }) }} onClick={() => togglePanel("sms")} title="Send text"><SmsIcon /></button>
            {smsSent && <span style={styles.checkBadge}>&#10003;</span>}
          </span>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button style={{ ...styles.iconBtn, ...(action.contactPhone ? {} : { opacity: 0.25, pointerEvents: "none" as const }) }} onClick={handleCallClick} title="Log call"><PhoneIcon /></button>
            {callLogged && <span style={styles.checkBadge}>&#10003;</span>}
          </span>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button style={styles.iconBtn} onClick={() => togglePanel("note")} title="Add note"><NoteIcon /></button>
            {noteSent && <span style={styles.checkBadge}>&#10003;</span>}
          </span>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <button style={styles.iconBtn} onClick={() => togglePanel("move")} title="Move stage"><MoveIcon /></button>
            {moveSent && <span style={styles.checkBadge}>&#10003;</span>}
          </span>
          <button style={styles.dismissBtn} onClick={onDismiss} title="Dismiss">&times;</button>
        </div>
      </div>
      <div style={styles.contactName}>
        {action.contactName}{company}
      </div>
      <div style={styles.context}><strong>Summary:</strong> {action.context}</div>
      {action.recommendation && (
        <div style={styles.context}><strong>Recommendation:</strong> {action.recommendation}</div>
      )}

      {openPanel === "call" && callState === "idle" && (
        <div style={{ ...styles.composeArea, display: "flex", gap: 8, alignItems: "center" }}>
          {action.contactPhone && (
            <a href={`tel:${action.contactPhone}`} style={{ color: "#38bdf8", textDecoration: "none", fontWeight: 500, fontSize: "0.9rem", marginRight: 8 }}>
              {fmtPhone(action.contactPhone)}
            </a>
          )}
          <SendButton label="Answered" sentLabel="" status="ready" onClick={handleAnswered} />
          <SendButton label="No Answer" sentLabel="" status="ready" onClick={handleNoAnswer} />
        </div>
      )}

      <ComposeArea action={action} sentStatus={sentStatus} onSent={onSent} openPanel={openPanel} onStageMove={setDisplayStage} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
        <ConvoHistory messages={action.conversationHistory} />
        <PriorNotes notes={action.notes} />
      </div>
    </div>
  );
}

// --- Sidebar ---
function Sidebar({
  actions,
  activeId,
  onNavigate,
  noActionCount,
  inactiveCount,
}: {
  actions: ActionItem[];
  activeId: string | null;
  onNavigate: (id: string) => void;
  noActionCount: number;
  inactiveCount: number;
}) {
  const sorted = [...actions].sort((a, b) =>
    a.contactName.localeCompare(b.contactName, "en", { sensitivity: "base" }),
  );

  return (
    <nav style={styles.sidebar}>
      <div style={{ padding: "0 16px 12px", fontSize: "0.85rem", fontWeight: 700, color: "#f1f5f9" }}>
        Leads
      </div>
      {sorted.map((a) => {
        const itemId = `lead-${a.id}`;
        const isActive = activeId === itemId;
        return (
          <button
            key={a.id}
            title={a.contactName}
            style={{
              ...styles.sidebarItem,
              ...(isActive ? styles.sidebarItemActive : {}),
            }}
            onClick={() => onNavigate(itemId)}
          >
            {a.contactName}
          </button>
        );
      })}
      {(noActionCount > 0 || inactiveCount > 0) && (
        <div style={{ ...styles.sidebarGroupLabel, color: "#475569", marginTop: 4 }}>SECTIONS</div>
      )}
      {noActionCount > 0 && (
        <button
          title="No Action Needed"
          style={{
            ...styles.sidebarItem,
            ...(activeId === "section-no-action" ? styles.sidebarItemActive : {}),
          }}
          onClick={() => onNavigate("section-no-action")}
        >
          No Action Needed
        </button>
      )}
      {inactiveCount > 0 && (
        <button
          title="Inactive Summary"
          style={{
            ...styles.sidebarItem,
            ...(activeId === "section-inactive" ? styles.sidebarItemActive : {}),
          }}
          onClick={() => onNavigate("section-inactive")}
        >
          Inactive Summary
        </button>
      )}
    </nav>
  );
}

// --- Main Dashboard ---
export default function Dashboard({ initialData }: { initialData: DashboardData | null }) {
  const [data, setData] = useState<DashboardData | null>(initialData);
  const [sentStatus, setSentStatus] = useState<SentStatus>({});
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  // Load sent status on mount
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => {
        setSentStatus(s);
        const dismissedIds = new Set<number>();
        for (const [id, info] of Object.entries(s) as [string, { status: string }][]) {
          if (info.status === "dismissed") dismissedIds.add(parseInt(id, 10));
        }
        setDismissed(dismissedIds);
      })
      .catch(() => {});
  }, []);

  // Poll for new dashboard data every 2 minutes
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const r = await fetch("/api/actions");
        const fresh = await r.json();
        if (fresh.generatedAt && fresh.generatedAt !== data?.generatedAt) {
          setData(fresh);
          setDismissed(new Set());
          setSentStatus({});
        }
      } catch { /* ignore */ }
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [data?.generatedAt]);

  const handleSent = useCallback((key: string, status: string) => {
    setSentStatus((prev) => ({ ...prev, [key]: { status, ts: Date.now() } }));
  }, []);

  const handleDismiss = useCallback(async (id: number) => {
    setDismissed((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/dismiss/${id}`, { method: "POST" });
    } catch { /* ignore */ }
  }, []);

  // Sidebar state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Media query for sidebar visibility
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 900px)");
    setShowSidebar(mql.matches);
    const handler = (e: MediaQueryListEvent) => setShowSidebar(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // IntersectionObserver to track which card is in view
  useEffect(() => {
    if (!showSidebar || !data?.actions) return;

    observerRef.current?.disconnect();

    const obs = new IntersectionObserver(
      (entries) => {
        let topId: string | null = null;
        let topY = Infinity;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
            topY = entry.boundingClientRect.top;
            topId = entry.target.id;
          }
        }
        if (topId) setActiveId(topId);
      },
      { rootMargin: "-10% 0px -60% 0px", threshold: 0 },
    );
    observerRef.current = obs;

    const els = document.querySelectorAll('[id^="lead-"], [id^="section-"]');
    els.forEach((el) => obs.observe(el));

    return () => obs.disconnect();
  }, [showSidebar, data, dismissed]);

  const handleNavigate = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  if (!data || !data.actions) {
    return (
      <div style={styles.root}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 4 }}>FTL Prints — Action Dashboard</h1>
        <div style={styles.loading}>
          No pipeline data yet. Pipeline runs at 8:00 AM ET weekdays.
        </div>
      </div>
    );
  }

  const actions = data.actions.filter((a) => !dismissed.has(a.id));

  const groups: Record<string, ActionItem[]> = { high: [], medium: [], low: [] };
  for (const a of actions) {
    const p = groups[a.priority] ? a.priority : "low";
    groups[p].push(a);
  }

  const groupMeta = [
    { key: "high", label: "HIGH PRIORITY", color: "#ef4444" },
    { key: "medium", label: "MEDIUM PRIORITY", color: "#eab308" },
    { key: "low", label: "LOW PRIORITY", color: "#94a3b8" },
  ];

  const highCount = actions.filter((a) => a.priority === "high").length;
  const medCount = actions.filter((a) => a.priority === "medium").length;
  const lowCount = actions.filter(
    (a) => a.priority !== "high" && a.priority !== "medium",
  ).length;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const noActionCount = data.noAction?.length || 0;
  const inactiveCount = Object.keys(data.inactiveSummary || {}).length;

  return (
    <>
      {showSidebar && (
        <Sidebar
          actions={actions}
          activeId={activeId}
          onNavigate={handleNavigate}
          noActionCount={noActionCount}
          inactiveCount={inactiveCount}
        />
      )}
      <div style={{ ...styles.root, ...(showSidebar ? { marginLeft: 236 } : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: 4 }}>FTL Prints — Action Dashboard</h1>
          <div style={styles.dateLine}>
            Updated: {data.generatedAt ? new Date(data.generatedAt).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" }) : today}
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            padding: "6px 14px",
            background: "#1e293b",
            color: "#94a3b8",
            border: "1px solid #334155",
            borderRadius: 6,
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>

      {/* Stats */}
      <div style={styles.statsBar}>
        <div style={styles.statPill}>
          <span style={{ fontWeight: 700 }}>{actions.length}</span> Actions
        </div>
        <div style={styles.statPill}>
          <span style={{ fontWeight: 700, color: PRIORITY_COLORS.high }}>{highCount}</span> High
        </div>
        <div style={styles.statPill}>
          <span style={{ fontWeight: 700, color: PRIORITY_COLORS.medium }}>{medCount}</span> Medium
        </div>
        <div style={styles.statPill}>
          <span style={{ fontWeight: 700, color: "#94a3b8" }}>{lowCount}</span> Low
        </div>
      </div>

      {/* Action Groups */}
      {groupMeta.map((g) => {
        if (!groups[g.key]?.length) return null;
        return (
          <div key={g.key} style={{ marginBottom: 28 }}>
            <div style={{ ...styles.priorityLabel, color: g.color }}>
              ▼ {g.label} ({groups[g.key].length})
            </div>
            {groups[g.key].map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                cardId={`lead-${a.id}`}
                sentStatus={sentStatus}
                onSent={handleSent}
                onDismiss={() => handleDismiss(a.id)}
              />
            ))}
          </div>
        );
      })}

      {/* No Action Needed */}
      {data.noAction?.length > 0 && (
        <CollapsibleSection title="No Action Needed" count={`${data.noAction.length} leads on track`} sectionId="section-no-action">
          {data.noAction.map((n, i) => (
            <div key={i} style={styles.noActionItem}>
              <strong>{n.contactName}</strong> ({n.stage}) — {n.reason}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Inactive Summary */}
      {Object.keys(data.inactiveSummary || {}).length > 0 && (
        <CollapsibleSection
          title="Inactive Summary"
          count={String(Object.values(data.inactiveSummary).reduce((s, v) => s + v, 0))}
          sectionId="section-inactive"
        >
          <div style={styles.inactiveBar}>
            {Object.entries(data.inactiveSummary).map(([label, count]) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#38bdf8" }}>{count}</div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{label}</div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
    </>
  );
}

function CollapsibleSection({
  title,
  count,
  children,
  sectionId,
}: {
  title: string;
  count: string;
  children: React.ReactNode;
  sectionId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div id={sectionId} style={styles.section}>
      <div style={styles.sectionHeader} onClick={() => setOpen(!open)}>
        {title} <span>{count}</span>
      </div>
      {open && <div style={{ padding: "0 20px 16px" }}>{children}</div>}
    </div>
  );
}
