
// src/api/orthanc.ts
import { ORTHANC_BASE } from "../config";

/** Items returned by /tools/find at Level="Series" (after coercion). */
export type SeriesMatch = {
  ID: string;
  RequestedTags?: Record<string, string>;
};

/** Normalized shape used by the table. */
export interface SeriesRowData {
  id: string;
  slices: number;
  requestedTags: Record<string, string>;
  customTags: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* URL helpers: dev-safe absolute URLs                                        */
/* -------------------------------------------------------------------------- */
/**
 * Build an absolute URL to Orthanc that works both in dev (Vite on :5173) and
 * prod (front-end served by nginx).
 *
 * - In dev, if ORTHANC_BASE is relative ("/orthanc"), we target "http://localhost"
 *   (nginx) instead of window.location.origin ("http://localhost:5173").
 * - If ORTHANC_BASE is already absolute (http://...), we use it directly.
 */
function orthancPath(path: string): string {
  const baseIsAbsolute = /^https?:\/\//i.test(ORTHANC_BASE);
  let originToUse = window.location.origin;

  // If running Vite dev server and ORTHANC_BASE is relative, target nginx root.
  if (!baseIsAbsolute && window.location.port === "5173") {
    originToUse = `${window.location.protocol}//${window.location.hostname}`;
  }

  const u = new URL(ORTHANC_BASE, originToUse);
  const basePath = u.pathname.replace(/\/+$/, "");
  const origin = `${u.protocol}//${u.host}`;
  return `${origin}${basePath}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Convenience fetch wrapper returning JSON or null. */
async function fetchJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(orthancPath(path));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* /tools/find (Series level)                                                 */
/* -------------------------------------------------------------------------- */
export async function findSeries(
  query: Record<string, string | number | boolean> = {}
): Promise<SeriesMatch[]> {
  const body = {
    Level: "Series",
    Query: query ?? {},
    RequestedTags: [
      "PatientName",
      "PatientID",
      "SeriesDescription",
      "Modality",
      "BodyPartExamined",
      "SeriesNumber",
      "SeriesDate",
      "SeriesTime",
      "StudyInstanceUID",
      "SeriesInstanceUID",
      // Extras often useful in the accordion:
      "AccessionNumber",
      "InstitutionName",
      "ReferringPhysicianName",
      "ProtocolName",
      "StudyDescription",
      "StudyID",
    ],
    // Avoid ResponseContent to prevent version-specific 400s
  };

  const res = await fetch(orthancPath("/tools/find"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("tools/find failed:", res.status, text);
    throw new Error(text);
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) {
    console.error("tools/find returned non-array:", raw);
    return [];
  }

  // Coerce strings → { ID }, objects → normalize ID/RequestedTags
  const items: SeriesMatch[] = raw
    .map((it: any) => {
      if (typeof it === "string") {
        return { ID: it, RequestedTags: {} };
      }
      if (it && typeof it === "object") {
        const id = it.ID ?? it.Id ?? it.SeriesID ?? it.Series ?? it["ID"] ?? "";
        const requested =
          it.RequestedTags ??
          it.requestedTags ??
          ({} as Record<string, string>);
        return { ID: id, RequestedTags: requested };
      }
      return { ID: "", RequestedTags: {} };
    })
    .filter((x) => !!x.ID);

  console.log("[findSeries] coerced items:", items.length);
  if (items[0]) console.log("[findSeries] sample:", items[0]);

  return items;
}

/* -------------------------------------------------------------------------- */
/* Metadata (custom tags JSON at key 4096, series level)                      */
/* -------------------------------------------------------------------------- */

/**
 * Internal helper: read custom tags and get ETag (for Orthanc revisions).
 * Returns `{ tags, etag }`, with tags parsed from the UTF‑8 string stored at key 4096.
 *
 * Orthanc metadata values must be strings; we store JSON text in that string. 404 → {}.
 * Ref: REST cheat sheet routes for metadata; Book "Metadata & attachments".
 *   - /series/{id}/metadata           (list)
 *   - /series/{id}/metadata/{name}    (GET|PUT|DELETE one key)
 *   - Metadata are UTF‑8 strings.      (PUT examples use raw `-d '...'`)
 *   Sources: Orthanc Book cheat sheet & features pages. ¹²
 */
async function getSeriesCustomTagsWithEtag(
  seriesId: string
): Promise<{ tags: Record<string, string>; etag: string | null }> {
  const url = orthancPath(
    `/series/${encodeURIComponent(seriesId)}/metadata/4096`
  );
  const res = await fetch(url);

  if (res.status === 404) {
    return { tags: {}, etag: null };
  }
  if (!res.ok) {
    return { tags: {}, etag: null };
  }

  const etag = res.headers.get("ETag");
  const rawText = await res.text();
  if (!rawText) return { tags: {}, etag };

  // Robust parsing: allow either raw JSON object text, or a quoted JSON string
  try {
    const first = JSON.parse(rawText);
    if (typeof first === "string") {
      const second = JSON.parse(first);
      return second && typeof second === "object"
        ? { tags: second as Record<string, string>, etag }
        : { tags: {}, etag };
    }
    return first && typeof first === "object"
      ? { tags: first as Record<string, string>, etag }
      : { tags: {}, etag };
  } catch {
    return { tags: {}, etag };
  }
}

/** Public: read the custom tags JSON container (metadata key 4096) directly. */
export async function getSeriesCustomTags(
  seriesId: string
): Promise<Record<string, string>> {
  const { tags } = await getSeriesCustomTagsWithEtag(seriesId);
  return tags;
}

/**
 * Merge‑safe write: read current value (and ETag if revisions are enabled),
 * merge `current` + `tags` (incoming wins), then PUT the merged JSON text
 * as UTF‑8 string. If an ETag is present, include `If-Match` to avoid races.
 *
 * Note: Orthanc’s “Revisions” mechanism is optional and requires enabling
 * `CheckRevisions=true` (and a supported DB backend). If not enabled, the
 * `If-Match` header will be ignored. ²
 */
export async function putSeriesCustomTags(
  seriesId: string,
  tags: Record<string, string>
): Promise<void> {
  const { tags: current, etag } = await getSeriesCustomTagsWithEtag(seriesId);

  const merged: Record<string, string> = { ...current, ...tags };

  const res = await fetch(
    orthancPath(`/series/${encodeURIComponent(seriesId)}/metadata/4096`),
    {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: JSON.stringify(merged),
    }
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

/** Set a single custom tag by merging into the JSON container. */
export async function setSeriesCustomTag(
  seriesId: string,
  tagName: string,
  value: string
): Promise<void> {
  const { tags: current } = await getSeriesCustomTagsWithEtag(seriesId);
  current[tagName] = value;
  await putSeriesCustomTags(seriesId, current);
}

/** Delete a single custom tag by merging into the JSON container. */
export async function deleteSeriesCustomTag(
  seriesId: string,
  tagName: string
): Promise<void> {
  const { tags: current } = await getSeriesCustomTagsWithEtag(seriesId);
  delete current[tagName];
  await putSeriesCustomTags(seriesId, current);
}

/* -------------------------------------------------------------------------- */
/* Normalize items for the table (Series → Study → Patient merge)             */
/* -------------------------------------------------------------------------- */
async function normalizeSeriesItem(it: SeriesMatch): Promise<SeriesRowData> {
  const id = it.ID;
  if (!id) {
    return {
      id: "",
      slices: 0,
      requestedTags: it.RequestedTags ?? {},
      customTags: {},
    };
  }

  // 1) SERIES detail: MainDicomTags + ParentStudy + InstancesCount
  const series = await fetchJson(`/series/${encodeURIComponent(id)}`);
  const seriesTags: Record<string, string> = series?.MainDicomTags ?? {};
  const parentStudyId: string | undefined = series?.ParentStudy;

  const slices =
    typeof series?.InstancesCount === "number"
      ? series.InstancesCount
      : Array.isArray(series?.Instances)
      ? series.Instances.length
      : 0;

  // 2) STUDY detail: MainDicomTags + ParentPatient
  const study = parentStudyId
    ? await fetchJson(`/studies/${encodeURIComponent(parentStudyId)}`)
    : null;
  const studyTags: Record<string, string> = study?.MainDicomTags ?? {};
  const parentPatientId: string | undefined = study?.ParentPatient;

  // 3) PATIENT detail: MainDicomTags (PatientName lives here)
  const patient = parentPatientId
    ? await fetchJson(`/patients/${encodeURIComponent(parentPatientId)}`)
    : null;
  const patientTags: Record<string, string> = patient?.MainDicomTags ?? {};

  // Merge tags: Patient → Study → Series → RequestedTags(from find) (later wins)
  const requestedTags: Record<string, string> = {
    ...patientTags, // PatientName, PatientID
    ...studyTags, // StudyDate, StudyID, AccessionNumber
    ...seriesTags, // SeriesDescription, SeriesDate, SeriesInstanceUID, Modality, BodyPartExamined
    ...(it.RequestedTags ?? {}),
  };

  // Fallbacks to keep table cells non-empty
  if (!requestedTags["StudyDate"] && requestedTags["SeriesDate"]) {
    requestedTags["StudyDate"] = requestedTags["SeriesDate"];
  }
  if (!requestedTags["PatientName"] && requestedTags["PatientID"]) {
    requestedTags["PatientName"] = requestedTags["PatientID"];
  }

  // 4) Custom tags (metadata 4096)
  let customTags: Record<string, string> = {};
  try {
    customTags = await getSeriesCustomTags(id);
  } catch {
    customTags = {};
  }

  return {
    id,
    slices,
    requestedTags,
    customTags,
  };
}

/** Public API: load and normalize all series for the table. */
export async function loadSeriesForTable(): Promise<SeriesRowData[]> {
  const found = await findSeries({});
  if (!found.length) {
    console.warn("[loadSeriesForTable] /tools/find returned 0 series");
    return [];
  }
  const valid = found.filter((x) => !!x.ID);
  const rows = await Promise.all(valid.map(normalizeSeriesItem));
  const finalRows = rows.filter((r) => !!r.id);
  console.log("[loadSeriesForTable] normalized rows:", finalRows.length);
  if (finalRows[0]) console.log("[sample row]", finalRows[0]);
  return finalRows;
}
