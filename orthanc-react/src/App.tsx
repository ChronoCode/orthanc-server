
import React from "react";
import { loadSeriesForTable, type SeriesRowData } from "./api/orthanc";
import { FilterBar, type AdvancedFilterState } from "./components/FilterBar";
import { SeriesTable } from "./components/SeriesTable";
import { EditCustomTagsModal } from "./components/EditCustomTagsModal";
import { UploadDicomButton } from "./components/UploadDicomButton";
import { OHIF_ROOT, ORTHANC_BASE } from "./config";

export default function App() {
  const [series, setSeries] = React.useState<SeriesRowData[]>([]);
  const [query, setQuery] = React.useState<string>("");
  const [adv, setAdv] = React.useState<AdvancedFilterState>({ kvPairs: [] });
  const [editing, setEditing] = React.useState<SeriesRowData | null>(null);

  React.useEffect(() => {
    refreshSeries();
  }, []);

  const refreshSeries = React.useCallback(async () => {
    try {
      const rows = await loadSeriesForTable();
      setSeries(rows);
      console.log("series loaded:", rows.length);
    } catch (e) {
      console.error("loadSeriesForTable failed:", e);
    }
  }, []);

  const dicomKeys = React.useMemo(
    () => Array.from(new Set(series.flatMap((s) => Object.keys(s.requestedTags || {})))),
    [series]
  );
  const customKeys = React.useMemo(
    () => Array.from(new Set(series.flatMap((s) => Object.keys(s.customTags || {})))),
    [series]
  );

  const visibleRows = React.useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    const hasUsableKv = (adv.kvPairs || []).some((kv) => {
      const mode = kv.mode ?? "contains";
      const lhs = (kv.key ?? "").trim();
      const rhs = (kv.value ?? "").trim();
      const hasDateBounds = !!(kv.from?.trim() || kv.to?.trim());
      if (mode === "dateRange") return !!lhs || hasDateBounds;
      return !!lhs || !!rhs;
    });

    if (!q && !hasUsableKv) return series;

    const rows = series.filter((r) => {
      const requested = r.requestedTags || {};
      const custom = r.customTags || {};

      for (const kv of adv.kvPairs || []) {
        const mode = kv.mode ?? "contains";
        const src = kv.scope === "custom" ? custom : requested;
        const lhs = (kv.key ?? "").trim().toLowerCase();
        const rhs = (kv.value ?? "").trim().toLowerCase();
        const keys = Object.keys(src);

        const hasDateBounds = !!(kv.from?.trim() || kv.to?.trim());
        const isDateRange = mode === "dateRange";

        const isEmptyStringMode = !isDateRange && !lhs && !rhs;
        const isEmptyDateMode = isDateRange && !lhs && !hasDateBounds;
        if (isEmptyStringMode || isEmptyDateMode) continue;

        const matchingKeys = lhs ? keys.filter((k) => k.toLowerCase().includes(lhs)) : keys;
        if (!matchingKeys.length) return false;

        if (isDateRange) {
          const from = (kv.from ?? "").trim();
          const to = (kv.to ?? "").trim();
          const ok = matchingKeys.some((mk) => {
            const v = (src[mk] ?? "").toString().trim();
            if (!/^\d{8}$/.test(v)) return false;
            if (from && v < from) return false;
            if (to && v > to) return false;
            return true;
          });
          if (!ok) return false;
          continue;
        }

        const ok = matchingKeys.some((mk) => {
          const val = (src[mk] ?? "").toString().toLowerCase();
          if (!rhs) return val.length > 0;
          switch (mode) {
            case "equals":     return val === rhs;
            case "startsWith": return val.startsWith(rhs);
            case "endsWith":   return val.endsWith(rhs);
            case "contains":
            default:           return val.includes(rhs);
          }
        });
        if (!ok) return false;
      }

      if (!q) return true;

      const fields: string[] = [
        requested["PatientName"],
        requested["SeriesDescription"],
        requested["Modality"],
        requested["BodyPartExamined"],
        requested["SeriesDate"],
        requested["StudyInstanceUID"],
        requested["SeriesInstanceUID"],
        String(r.slices),
        ...Object.values(requested),
        ...Object.values(custom),
      ].filter((x) => typeof x === "string") as string[];

      return fields.some((v) => v.toLowerCase().includes(q));
    });

    return rows;
  }, [series, query, adv]);

  // Actions
  const handleOpenOhif = React.useCallback((row: SeriesRowData) => {
    const studyUID = row.requestedTags?.["StudyInstanceUID"];
    if (!studyUID) return alert("Missing StudyInstanceUID.");
    const url = `${OHIF_ROOT.replace(/\/+$/, "")}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyUID)}`;
    window.open(url, "_blank", "noopener");
  }, []);

  const handleEditCustomTags = React.useCallback((row: SeriesRowData) => {
    setEditing(row);
  }, []);

  const handleDownloadDicom = React.useCallback((row: SeriesRowData) => {
    // Plain ZIP of the series
    const href = `${ORTHANC_BASE.replace(/\/+$/, "")}/series/${encodeURIComponent(row.id)}/archive`;
    window.open(href, "_blank", "noopener");
    // (This is the standard “download series as ZIP” path) [1](https://rubydoc.info/gems/orthanc/Orthanc/Series)
  }, []);

  const handleDelete = React.useCallback(async (row: SeriesRowData) => {
    const ok = window.confirm("Delete this series from Orthanc?");
    if (!ok) return;
    try {
      const url = `${ORTHANC_BASE.replace(/\/+$/, "")}/series/${encodeURIComponent(row.id)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Delete failed: ${res.status} ${msg}`);
      }
      await refreshSeries();
    } catch (e) {
      console.error("Delete error:", e);
      alert(String(e));
    }
  }, [refreshSeries]);

  return (
    <div className="app">
      <header className="app-header">
        <h1 style={{ margin: 0, display: "inline-block" }}>Orthanc Series</h1>
        {/* Upload button in header */}
        <div style={{ display: "inline-block", marginLeft: "1rem" }}>
          <UploadDicomButton onUploaded={refreshSeries} />
        </div>
      </header>

      <main className="app-main">
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          advanced={adv}
          onAdvancedChange={setAdv}
          dicomKeys={dicomKeys}
          customKeys={customKeys}
        />

        <div className="table-container">
          <SeriesTable
            rows={visibleRows}
            onOpenOhif={handleOpenOhif}
            onEditCustomTags={handleEditCustomTags}
            onDownloadDicom={handleDownloadDicom}
            onDelete={handleDelete}
          />
        </div>
      </main>

      {/* Modal editor */}
      {editing && (
        <EditCustomTagsModal
          series={editing}
          onClose={() => setEditing(null)}
          onSaved={refreshSeries}
        />
      )}
    </div>
  );
}
