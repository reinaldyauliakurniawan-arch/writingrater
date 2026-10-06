import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/authz";

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect("/new");
  return (
    <main className="mx-auto flex min-h-screen max-w-[720px] flex-col items-center justify-center gap-6 px-4 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Just Speak" className="h-24 w-auto" />
      <p className="text-lg">
        Nilai jawaban IELTS Writing Task 1 Academic dan Task 2 kamu, lengkap dengan skor per kriteria dan
        feedback untuk perbaikan.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="btn-primary">
          Masuk
        </Link>
        <Link href="/register" className="btn-secondary">
          Daftar
        </Link>
      </div>
    </main>
  );
}
