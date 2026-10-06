"use client";

import type { ExtractedData } from "@/lib/llm/schemas";
import type { ExtractionUncertain, UncertainCell } from "@/lib/types";

type Props = {
  value: ExtractedData;
  uncertain: ExtractionUncertain | null;
  onChange: (v: ExtractedData) => void;
  disabled?: boolean;
};

const cellInput =
  "w-full min-w-16 rounded-lg border border-line px-2 py-1 text-sm shadow-inner outline-none transition duration-150 focus:ring-2 focus:ring-primary";

export default function ExtractionEditor({ value, uncertain, onChange, disabled }: Props) {
  const cells: UncertainCell[] = Array.isArray(uncertain) ? uncertain : [];
  const findUncertain = (table: string, row: string, column: string) =>
    cells.find((c) => c.table === table && c.row === row && c.column === column);

  const setTable = (ti: number, t: ExtractedData["tables"][number]) =>
    onChange({ ...value, tables: value.tables.map((x, i) => (i === ti ? t : x)) });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label text-sm" htmlFor="ex-title">
            Judul
          </label>
          <input id="ex-title" className="input" disabled={disabled} value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })} />
        </div>
        <div>
          <label className="label text-sm" htmlFor="ex-units">
            Satuan
          </label>
          <input id="ex-units" className="input" disabled={disabled} value={value.units}
            onChange={(e) => onChange({ ...value, units: e.target.value })} />
        </div>
      </div>

      {value.tables.map((t, ti) => (
        <div key={ti} className="rounded-2xl border border-line p-3 shadow-sm">
          <input aria-label="Nama tabel" className="input mb-2 font-semibold" disabled={disabled} value={t.name}
            onChange={(e) => setTable(ti, { ...t, name: e.target.value })} />
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th className="text-left text-muted">Baris</th>
                  {t.columns.map((c, ci) => (
                    <th key={ci}>
                      <input aria-label={`Kolom ${ci + 1}`} className={`${cellInput} font-semibold`} disabled={disabled}
                        value={c}
                        onChange={(e) =>
                          setTable(ti, { ...t, columns: t.columns.map((x, i) => (i === ci ? e.target.value : x)) })
                        } />
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-primary-soft" : ""}>
                    <td>
                      <input aria-label={`Label baris ${ri + 1}`} className={cellInput} disabled={disabled} value={r.label}
                        onChange={(e) =>
                          setTable(ti, { ...t, rows: t.rows.map((x, i) => (i === ri ? { ...x, label: e.target.value } : x)) })
                        } />
                    </td>
                    {t.columns.map((col, ci) => {
                      const u = findUncertain(t.name, r.label, col);
                      return (
                        <td key={ci}>
                          <input
                            aria-label={`${r.label} ${col}`}
                            title={u ? `Bacaan 1: ${u.a} · Bacaan 2: ${u.b}` : undefined}
                            className={`${cellInput} ${u ? "bg-warning-soft" : "bg-white"}`}
                            disabled={disabled}
                            value={r.values[ci] ?? ""}
                            onChange={(e) => {
                              const values = t.columns.map((_, i) => (i === ci ? e.target.value : (r.values[i] ?? "")));
                              setTable(ti, { ...t, rows: t.rows.map((x, i) => (i === ri ? { ...x, values } : x)) });
                            }}
                          />
                        </td>
                      );
                    })}
                    <td>
                      <button type="button" disabled={disabled} aria-label="Hapus baris"
                        className="rounded-lg px-2 py-1 text-danger transition duration-150 hover:bg-white"
                        onClick={() => setTable(ti, { ...t, rows: t.rows.filter((_, i) => i !== ri) })}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={disabled} className="mt-2 text-sm font-semibold text-primary-dark hover:underline"
            onClick={() => setTable(ti, { ...t, rows: [...t.rows, { label: "", values: t.columns.map(() => "") }] })}>
            + Tambah baris
          </button>
        </div>
      ))}

      <ListEditor label="Tahapan proses" items={value.process_steps} disabled={disabled}
        onChange={(process_steps) => onChange({ ...value, process_steps })} />
      <ListEditor label="Perubahan peta" items={value.map_changes} disabled={disabled}
        onChange={(map_changes) => onChange({ ...value, map_changes })} />
    </div>
  );
}

function ListEditor(props: { label: string; items: string[]; disabled?: boolean; onChange: (v: string[]) => void }) {
  if (props.items.length === 0 && props.disabled) return null;
  return (
    <div>
      <p className="label text-sm">{props.label}</p>
      <ol className="space-y-2">
        {props.items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="pt-2 text-sm text-muted">{i + 1}.</span>
            <input className="input" disabled={props.disabled} value={it} aria-label={`${props.label} ${i + 1}`}
              onChange={(e) => props.onChange(props.items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" disabled={props.disabled} aria-label="Hapus" className="rounded-lg px-2 text-danger"
              onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <button type="button" disabled={props.disabled} className="mt-2 text-sm font-semibold text-primary-dark hover:underline"
        onClick={() => props.onChange([...props.items, ""])}>
        + Tambah
      </button>
    </div>
  );
}
