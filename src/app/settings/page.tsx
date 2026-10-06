import PageShell from "@/components/PageShell";
import SettingsForm from "@/components/SettingsForm";
import { requireUser } from "@/lib/authz";
import { isAdminEmail } from "@/lib/env";
import { getPublicSettings } from "@/lib/settings";
import { PROVIDER_OPTIONS, requiresBaseUrl } from "@/lib/llm/providers";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) {
    return (
      <PageShell>
        <p className="card">Halaman ini khusus admin.</p>
      </PageShell>
    );
  }
  const settings = await getPublicSettings();
  const providers = PROVIDER_OPTIONS.map((p) => ({ ...p, needsBaseUrl: requiresBaseUrl(p.value) }));
  return (
    <PageShell>
      <h1 className="page-title mb-4">Pengaturan</h1>
      <SettingsForm initial={settings} providers={providers} />
    </PageShell>
  );
}
