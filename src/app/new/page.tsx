import PageShell from "@/components/PageShell";
import NewChooser from "@/components/NewChooser";

export default function NewPage() {
  return (
    <PageShell>
      <h1 className="page-title mb-4">Mulai latihan</h1>
      <NewChooser />
    </PageShell>
  );
}
