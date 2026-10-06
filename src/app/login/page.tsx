import { redirect } from "next/navigation";
import PageShell from "@/components/PageShell";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/authz";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/new");
  return (
    <PageShell>
      <h1 className="page-title mb-4">Masuk</h1>
      <LoginForm />
    </PageShell>
  );
}
