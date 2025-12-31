
import React from "react";
import type { SeriesRowData } from "../api/orthanc";

const VISIBLE_COLUMNS: { key: string; label: string; from: "requested" | "computed" }[] = [
  { key: "PatientName",      label: "Patient Name",      from: "requested" },
  { key: "SeriesDescription",label: "Series Description",from: "requested" },
  { key: "Modality",         label: "Modality",          from: "requested" },
  { key: "BodyPartExamined", label: "Body Part",         from: "requested" },
  { key: "SeriesDate",       label: "Series Date",       from: "requested" }, // ⬅️ changed
  { key: "slices",           label: "Slices",            from: "computed" },
];

const COMMON_DICOM_EXTRA_KEYS: string[] = [
  "AccessionNumber",
  "InstitutionName",
  "ReferringPhysicianName",
  "ProtocolName",
  "StudyDescription",
  "StudyID",
  "SeriesNumber",
  "StudyInstanceUID",
  "SeriesInstanceUID",
];

function prettyLabel(key: string): string {
  const map: Record<string, string> = {
    AccessionNumber: "Accession Number",
    InstitutionName: "Institution",
    ReferringPhysicianName: "Referring Physician",
    ProtocolName: "Protocol",
    StudyDescription: "Study Description",
    StudyID: "Study ID",
    SeriesNumber: "Series Number",
    StudyInstanceUID: "Study UID",
    SeriesInstanceUID: "Series UID",
  };
  return map[key] || key;
}

function isYYYYMMDD(s: any): boolean {
  return typeof s === "string" && /^\d{8}$/.test(s);
}

function formatYYYYMMDD(s: string): string {
  // "20250131" -> "2025-01-31"
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
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
  const [sort, setSort] = React.useState<SortState>(null); // no sorting by default

  const colCount = VISIBLE_COLUMNS.length;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const onHeaderClick = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // cycle asc -> desc -> none
    });
    // optional: collapse expanded row when sorting
    setExpandedId(null);
  };

  const getCellRaw = (row: SeriesRowData, key: string): any => {
    if (key === "slices") return row.slices ?? 0;
    return row.requestedTags?.[key] ?? "";
  };

  const compare = (a: SeriesRowData, b: SeriesRowData): number => {
    if (!sort) return 0;
    const { key, dir } = sort;
    const av = getCellRaw(a, key);
    const bv = getCellRaw(b, key);

    // Handle Slices numerically
    if (key === "slices") {
      const ai = Number(av) || 0;
      const bi = Number(bv) || 0;
      return dir === "asc" ? ai - bi : bi - ai;
    }

    // Handle DICOM date "YYYYMMDD" lexicographically
    if (key.endsWith("Date")) {
      const ad = isYYYYMMDD(av) ? av : "";
      const bd = isYYYYMMDD(bv) ? bv : "";
      if (ad === bd) return 0;
      if (dir === "asc") return ad < bd ? -1 : 1;
      return ad > bd ? -1 : 1;
    }

    // Case-insensitive string compare
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

  const sortIndicator = (key: string) => {
    if (!sort || sort.key !== key) return "";
    return sort.dir === "asc" ? " ▲" : " ▼";
  };

  return (
    <table className="table">
      <thead>
        <tr>
          {VISIBLE_COLUMNS.map((c) => (
            <th
              key={c.key}
              onClick={() => onHeaderClick(c.key)}
              style={{ cursor: "pointer", userSelect: "none" }}
              aria-sort={
                sort && sort.key === c.key
                  ? (sort.dir === "asc" ? "ascending" : "descending")
                  : "none"
              }
              title={`Sort by ${c.label}`}
            >
              {c.label}{sortIndicator(c.key)}
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
              <tr
                onClick={() => toggleExpand(row.id)}
                style={{ cursor: "pointer" }}
                aria-expanded={isExpanded ? "true" : "false"}
              >
                {VISIBLE_COLUMNS.map((c) => {
                  const raw =
                    c.from === "computed"
                      ? (c.key === "slices" ? slices : (row as any)[c.key])
                      : requested[c.key] || "";

                  const display =
                    c.key.endsWith("Date") && isYYYYMMDD(raw)
                      ? formatYYYYMMDD(raw as string)
                      : raw || "";

                  return <td key={c.key}>{display}</td>;
                })}
              </tr>

              {isExpanded && (
                <tr>
                  <td colSpan={colCount}>
                    <div className="details-panel">
                      {/* Custom Tags */}
                      <div style={{ marginBottom: "0.5rem" }}>
                        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>Custom Tags</h3>
                      </div>
                      {row.customTags && Object.keys(row.customTags).length > 0 ? (
                        <div className="tags-grid">
                          {Object.entries(row.customTags).map(([k, v]) => (
                            <div className="tag-item" key={`c-${row.id}-${k}`}>
                              <div className="tag-key">{k}</div>
                              <div className="tag-value">{String(v ?? "")}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: "#6b7280" }}>No custom tags.</div>
                      )}

                      {/* Additional DICOM tags */}
                      <div style={{ marginTop: "0.75rem", marginBottom: "0.25rem" }}>
                        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
                          Additional DICOM Tags
                        </h3>
                      </div>

                      <div className="tags-grid">
                        {COMMON_DICOM_EXTRA_KEYS
                          .filter((key) => !VISIBLE_COLUMNS.some((c) => c.key === key))
                          .map((key) => {
                            const val = requested[key];
                            return (
                              <div className="tag-item" key={`d-${row.id}-${key}`}>
                                <div className="tag-key">{prettyLabel(key)}</div>
                                <div className="tag-value">{val || ""}</div>
                              </div>
                            );
                          })}
                      </div>

                      {/* Row actions */}
                      <div className="row-actions">
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
