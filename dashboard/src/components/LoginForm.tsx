"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (resp.ok) {
        window.location.href = "/";
      } else {
        const data = await resp.json();
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: 12,
          padding: "32px 28px",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginBottom: 4,
          }}
        >
          FTL Prints Dashboard
        </h1>
        <p
          style={{
            color: "#94a3b8",
            fontSize: "0.85rem",
            marginBottom: 24,
          }}
        >
          Sign in to view your pipeline
        </p>

        {error && (
          <div
            style={{
              background: "#450a0a",
              color: "#ef4444",
              padding: "8px 12px",
              borderRadius: 6,
              fontSize: "0.85rem",
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          style={{
            width: "100%",
            padding: "10px 12px",
            marginBottom: 12,
            background: "#334155",
            border: "1px solid #475569",
            borderRadius: 6,
            color: "#f1f5f9",
            fontSize: "0.9rem",
            boxSizing: "border-box",
          }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: "10px 12px",
            marginBottom: 20,
            background: "#334155",
            border: "1px solid #475569",
            borderRadius: 6,
            color: "#f1f5f9",
            fontSize: "0.9rem",
            boxSizing: "border-box",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "10px 0",
            background: loading ? "#475569" : "#38bdf8",
            color: "#0f172a",
            border: "none",
            borderRadius: 6,
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
