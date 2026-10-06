import Link from "next/link";
import { signOut } from "@/auth";
import { getCurrentUser } from "@/lib/authz";
import { APP_NAME } from "@/lib/config";
import { isAdminEmail } from "@/lib/env";

export default async function Header() {
  const user = await getCurrentUser();
  const admin = isAdminEmail(user?.email);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="sticky top-0 z-20 rounded-b-2xl bg-white shadow-card">
      <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href={user ? "/new" : "/"} className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Just Speak" className="h-9 w-auto" />
          <span className="text-sm font-bold text-primary-dark">{APP_NAME}</span>
        </Link>
        {user && (
          <nav className="ml-auto flex items-center gap-4 text-sm font-semibold">
            <Link href="/new" className="text-primary-dark hover:underline">
              Baru
            </Link>
            <Link href="/history" className="text-primary-dark hover:underline">
              Riwayat
            </Link>
            {admin && (
              <Link href="/settings" className="text-primary-dark hover:underline">
                Pengaturan
              </Link>
            )}
            <form action={logout}>
              <button type="submit" className="rounded-xl px-2 py-1 text-muted transition duration-150 hover:text-ink">
                Keluar
              </button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}
