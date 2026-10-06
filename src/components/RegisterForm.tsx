"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import ErrorBanner from "./ErrorBanner";

export default function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password minimal 8 karakter.");
    if (password !== password2) return setError("Ulangi password harus sama dengan password.");
    setBusy(true);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setError(json?.error?.message ?? "Pendaftaran gagal.");
      setBusy(false);
      return;
    }
    const login = await signIn("credentials", { email, password, redirect: false });
    if (!login || login.error) {
      router.push("/login");
      return;
    }
    router.push("/new");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <label className="label" htmlFor="name">Nama</label>
        <input id="name" required maxLength={100} className="input" value={name}
          onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required className="input" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" required minLength={8} maxLength={100} className="input"
          value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </div>
      <div>
        <label className="label" htmlFor="password2">Ulangi password</label>
        <input id="password2" type="password" required className="input" value={password2}
          onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
      </div>
      <ErrorBanner message={error} />
      <button type="submit" className="btn-primary w-full" disabled={busy}>Daftar</button>
    </form>
  );
}
