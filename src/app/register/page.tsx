import { redirect } from "next/navigation";
import PageShell from "@/components/PageShell";
import RegisterForm from "@/components/RegisterForm";
import { getCurrentUser } from "@/lib/authz";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/new");
  return (
    <PageShell>
      <h1 className="page-title mb-4">Daftar</h1>
      <RegisterForm />
    </PageShell>
  );
}
