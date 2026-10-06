import { band1 } from "@/lib/format";
import type { CriterionView } from "@/lib/types";

/** Empat blok kriteria berurutan task, cc, lr, gra (bagian 8.3). */
export default function CriteriaBlocks({ criteria }: { criteria: CriterionView[] }) {
  return (
    <div className="space-y-4">
      {criteria.map((c) => (
        <section key={c.key} className="rounded-2xl bg-primary-soft p-5 shadow-card">
          <h3 className="text-[18px] font-bold text-primary-dark">{c.name}</h3>
          <p className="text-[24px] font-bold text-primary-dark">{band1(c.band)}</p>
          <p className="mt-2 leading-relaxed">{c.feedback}</p>
          {c.tip && <p className="mt-2 italic">{c.tip}</p>}
        </section>
      ))}
    </div>
  );
}
