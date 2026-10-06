"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import ErrorBanner from "./ErrorBanner";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    if (!res || res.error) {
      setError("Email atau password salah.");
      setBusy(false);
      return;
    }
    router.push("/new");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required className="input" value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" required className="input" value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      <ErrorBanner message={error} />
      <button type="submit" className="btn-primary w-full" disabled={busy}>Masuk</button>
      <p className="text-center text-sm">
        <Link href="/register" className="font-semibold text-primary-dark hover:underline">
          Belum punya akun? Daftar
        </Link>
      </p>
    </form>
  );
}
