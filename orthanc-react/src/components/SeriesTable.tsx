
// src/components/SeriesTable.tsx
import React from "react";
import type { SeriesRowData } from "../api/orthanc";

// Chip styles for Custom Tags (same look as modal)
const chipWrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
};
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
  background: "#F3F4F6",
  border: "1px solid #E5E7EB",
  borderRadius: "0.75rem",
  padding: "4px 10px",
  maxWidth: "100%",
};
const chipKey: React.CSSProperties = {
  fontWeight: 600,
  color: "#111827",
  whiteSpace: "nowrap",
};
const chipVal: React.CSSProperties = {
  color: "#111827",
  overflowWrap: "anywhere",
};

const VISIBLE_COLUMNS: { key: string; label: string; from: "requested" | "computed" }[] = [
  { key: "PatientName", label: "Patient Name", from: "requested" },
  { key: "SeriesDescription", label: "Series Description", from: "requested" },
  { key: "Modality", label: "Modality", from: "requested" },
  { key: "BodyPartExamined", label: "Body Part", from: "requested" },
  { key: "SeriesDate", label: "Series Date", from: "requested" }, // ✅ SeriesDate
  { key: "slices", label: "Slices", from: "computed" },
];

/**
 * Additional DICOM tags to display (two pairs per row).
 * Requested set:
 *  - Add: PatientSex, Manufacturer
 *  - Keep: InstitutionName, ReferringPhysicianName, ProtocolName, StudyDescription, StudyInstanceUID, SeriesInstanceUID
 */
const COMMON_DICOM_EXTRA_KEYS: string[] = [
  "PatientSex",
  "Manufacturer",
  "InstitutionName",
  "ReferringPhysicianName",
  "ProtocolName",
  "StudyDescription",
  "StudyInstanceUID",    // Study UID
  "SeriesInstanceUID",   // Series UID
];

function prettyLabel(key: string): string {
  const map: Record<string, string> = {
    PatientSex: "Patient Sex",
    Manufacturer: "Manufacturer",
    InstitutionName: "Institution",
    ReferringPhysicianName: "Referring Physician",
    ProtocolName: "Protocol",
    StudyDescription: "Study Description",
    StudyInstanceUID: "Study UID",
    SeriesInstanceUID: "Series UID",
  };
  return map[key] ?? key;
}

function isYYYYMMDD(s: any): boolean {
  return typeof s === "string" && /^\d{8}$/.test(s);
}
function formatYYYYMMDD(s: string): string {
  // "20250131" -> "2025-01-31"
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

interface SeriesTableProps {
  rows: SeriesRowData[];
  onOpenOhif: (row: SeriesRowData) => void;
  onEditCustomTags: (row: SeriesRowData) => void;
  onDownloadDicom: (row: SeriesRowData) => void;
  onDelete?: (row: SeriesRowData) => void;
}

export function SeriesTable({
  rows,
  onOpenOhif,
  onEditCustomTags,
  onDownloadDicom,
  onDelete,
}: SeriesTableProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<SortState>(null);

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  const onHeaderClick = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // cycle asc -> desc -> none
    });
    setExpandedId(null); // optional: collapse when sorting
  };

  const getCellRaw = (row: SeriesRowData, key: string): any =>
    key === "slices" ? row.slices ?? 0 : row.requestedTags?.[key] ?? "";

  const compare = (a: SeriesRowData, b: SeriesRowData): number => {
    if (!sort) return 0;
    const { key, dir } = sort;
    const av = getCellRaw(a, key);
    const bv = getCellRaw(b, key);

    if (key === "slices") {
      const ai = Number(av) || 0;
      const bi = Number(bv) || 0;
      return dir === "asc" ? ai - bi : bi - ai;
    }

    if (key.endsWith("Date")) {
      const ad = isYYYYMMDD(av) ? av : "";
      const bd = isYYYYMMDD(bv) ? bv : "";
      if (ad === bd) return 0;
      if (dir === "asc") return ad < bd ? -1 : 1;
      return ad > bd ? -1 : 1;
    }

    const as = (av ?? "").toString().toLowerCase();
    const bs = (bv ?? "").toString().toLowerCase();
    if (as === bs) return 0;
    if (dir === "asc") return as < bs ? -1 : 1;
    return as > bs ? -1 : 1;
  };

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const copy = [...rows];
    copy.sort(compare);
    return copy;
  }, [rows, sort]);

  const sortIndicator = (key: string) => (!sort || sort.key !== key ? "" : sort.dir === "asc" ? " ▲" : " ▼");

  // Shared styles to make expanded row look like a single box
  const rowBoxBg = "#EEF6FF"; // light selection background
  const rowBoxBorder = "#D1E3FF"; // subtle border
  const summaryCellBase: React.CSSProperties = {
    verticalAlign: "middle",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
  };

  return (
    <table className="table">
      <thead>
        <tr>
          {VISIBLE_COLUMNS.map((c) => (
            <th
              key={c.key}
              onClick={() => onHeaderClick(c.key)}
              style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
              aria-sort={sort && sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
              title={`Sort by ${c.label}`}
            >
              {c.label}
              {sortIndicator(c.key)}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {sortedRows.map((row) => {
          const isExpanded = expandedId === row.id;
          const requested = row.requestedTags ?? {};
          const slices = row.slices ?? 0;

          return (
            <React.Fragment key={row.id}>
              {/* Summary row */}
              <tr
                onClick={() => toggleExpand(row.id)}
                style={{ cursor: "pointer" }}
                aria-expanded={isExpanded ? "true" : "false"}
              >
                {VISIBLE_COLUMNS.map((c, idx) => {
                  const raw =
                    c.from === "computed"
                      ? c.key === "slices"
                        ? slices
                        : (row as any)[c.key]
                      : requested[c.key] ?? "";

                  const display =
                    c.key.endsWith("Date") && isYYYYMMDD(raw) ? formatYYYYMMDD(raw as string) : raw ?? "";

                  const summaryCell: React.CSSProperties = {
                    ...summaryCellBase,
                    background: isExpanded ? rowBoxBg : undefined,
                    borderTop: isExpanded ? `1px solid ${rowBoxBorder}` : undefined,
                    borderLeft: isExpanded ? (idx === 0 ? `1px solid ${rowBoxBorder}` : undefined) : undefined,
                    borderRight: isExpanded ? (idx === VISIBLE_COLUMNS.length - 1 ? `1px solid ${rowBoxBorder}` : undefined) : undefined,
                    borderRadius: isExpanded
                      ? idx === 0
                        ? "0.5rem 0 0 0"
                        : idx === VISIBLE_COLUMNS.length - 1
                        ? "0 0.5rem 0 0"
                        : undefined
                      : undefined,
                  };

                  return (
                    <td key={c.key} style={summaryCell}>
                      {display}
                    </td>
                  );
                })}
              </tr>

              {/* Expanded details (blended into row) */}
              {isExpanded && (
                <tr>
                  <td
                    colSpan={VISIBLE_COLUMNS.length}
                    style={{
                      background: rowBoxBg,
                      borderBottom: `1px solid ${rowBoxBorder}`,
                      borderLeft: `1px solid ${rowBoxBorder}`,
                      borderRight: `1px solid ${rowBoxBorder}`,
                      borderRadius: "0 0 0.5rem 0.5rem",
                      padding: "0.75rem",
                    }}
                  >
                    <div
                      className="details-panel"
                      style={{
                        display: "grid",
                        gap: "0.75rem",
                      }}
                    >
                      {/* Custom Tags — chip style */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Custom Tags</h3>
                      </div>

                      {row.customTags && Object.keys(row.customTags).length > 0 ? (
                        <div style={chipWrap} aria-label="Custom key-value tags">
                          {Object.entries(row.customTags).map(([k, v]) => (
                            <div key={`chip-${row.id}-${k}`} style={chip} title={`${k}: ${String(v ?? "")}`}>
                              <span style={chipKey}>{k}:</span>
                              <span style={chipVal}>{String(v ?? "")}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: "#6b7280" }}>No custom tags.</div>
                      )}

                      {/* Additional DICOM Tags — TWO PAIRS PER ROW */}
                      <div style={{ marginTop: "0.5rem" }}>
                        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Additional DICOM Tags</h3>
                      </div>

                      {(() => {
                        const extras = COMMON_DICOM_EXTRA_KEYS
                          .filter((key) => !VISIBLE_COLUMNS.some((c) => c.key === key))
                          .map((key) => ({
                            label: prettyLabel(key),
                            value: requested[key] ?? "",
                            rawKey: key,
                          }));

                        const rows: React.ReactElement[] = []; // <- fix type
                        for (let i = 0; i < extras.length; i += 2) {
                          const a = extras[i];
                          const b = extras[i + 1];

                          rows.push(
                            <div
                              key={`extra-row-${row.id}-${i}`}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 2fr 1fr 2fr",
                                columnGap: "0.75rem",
                                rowGap: "0.5rem",
                                alignItems: "start",
                                maxWidth: "100%",
                              }}
                            >
                              {/* Pair A */}
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: "#111827",
                                  padding: "2px 0",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={a.label}
                              >
                                {a.label}
                              </div>
                              <div
                                style={{
                                  color: "#111827",
                                  background: "#F3F4F6",
                                  border: "1px solid #E5E7EB",
                                  borderRadius: "0.5rem",
                                  padding: "4px 8px",
                                  overflowWrap: "anywhere",
                                }}
                                title={String(a.value ?? "")}
                              >
                                {String(a.value ?? "")}
                              </div>

                              {/* Pair B (only if exists) */}
                              {b ? (
                                <>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      color: "#111827",
                                      padding: "2px 0",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                    title={b.label}
                                  >
                                    {b.label}
                                  </div>
                                  <div
                                    style={{
                                      color: "#111827",
                                      background: "#F3F4F6",
                                      border: "1px solid #E5E7EB",
                                      borderRadius: "0.5rem",
                                      padding: "4px 8px",
                                      overflowWrap: "anywhere",
                                    }}
                                    title={String(b.value ?? "")}
                                  >
                                    {String(b.value ?? "")}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div />
                                  <div />
                                </>
                              )}
                            </div>
                          );
                        }
                        return <>{rows}</>;
                      })()}

                      {/* Row actions (Edit Custom Tags in the bottom group) */}
                      <div
                        className="row-actions"
                        style={{
                          display: "flex",
                          gap: "0.5rem",
                          marginTop: "0.5rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <button className="button" onClick={() => onOpenOhif(row)}>
                          View in OHIF
                        </button>
                        <button className="button" onClick={() => onEditCustomTags(row)}>
                          Edit Custom Tags
                        </button>
                        <button className="button" onClick={() => onDownloadDicom(row)}>
                          Download DICOM
                        </button>
                        {onDelete && (
                          <button className="button danger" onClick={() => onDelete(row)}>
                            Delete Series
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
