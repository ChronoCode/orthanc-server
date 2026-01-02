
// src/api/orthanc.ts
import { ORTHANC_BASE } from "../config";

/**
 * Master debug toggle:
 *   - true  ➜ print key diagnostics to console
 *   - false ➜ be quiet (production)
 */
const DEBUG_ORTHANC = false;

/** Lightweight helpers */
function dbg(...args: any[]) {
  if (DEBUG_ORTHANC) console.debug(...args);
}
function warn(...args: any[]) {
  if (DEBUG_ORTHANC) console.warn(...args);
}
function err(...args: any[]) {
  if (DEBUG_ORTHANC) console.error(...args);
}

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
function orthancPath(path: string): string {
  const baseIsAbsolute = /^https?:\/\//i.test(ORTHANC_BASE);
  let originToUse = window.location.origin;
  if (!baseIsAbsolute && window.location.port === "5173") {
    originToUse = `${window.location.protocol}//${window.location.hostname}`;
  }
  const u = new URL(ORTHANC_BASE, originToUse);
  const basePath = u.pathname.replace(/\/+$/, "");
  const origin = `${u.protocol}//${u.host}`;
  const full = `${origin}${basePath}${path.startsWith("/") ? "" : "/"}${path}`;
  if (DEBUG_ORTHANC) dbg("[orthancPath] ORIGIN", originToUse, "BASE", ORTHANC_BASE, "RESOLVED", full);
  return full;
}

/** Convenience fetch wrapper returning JSON or null. */
async function fetchJson(path: string): Promise<any | null> {
  const url = orthancPath(path);
  if (DEBUG_ORTHANC) console.groupCollapsed("[fetchJson]", url);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      warn("[fetchJson] non-ok", res.status, await res.text());
      console.groupEnd();
      return null;
    }
    const j = await res.json();
    dbg("[fetchJson] ok, keys:", j && typeof j === "object" ? Object.keys(j) : "(non-object)");
    console.groupEnd();
    return j;
  } catch (e) {
    err("[fetchJson] exception", e);
    console.groupEnd();
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
      // Extras for accordion
      "AccessionNumber",
      "InstitutionName",
      "ReferringPhysicianName",
      "ProtocolName",
      "StudyDescription",
      "StudyID",
    ],
  };

  const url = orthancPath("/tools/find");
  if (DEBUG_ORTHANC) {
    console.groupCollapsed("[findSeries] POST", url);
    dbg("body:", body);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    err("[findSeries] failed:", res.status, text);
    console.groupEnd();
    throw new Error(text);
  }

  const raw = await res.json();
  if (!Array.isArray(raw)) {
    err("[findSeries] non-array payload:", raw);
    console.groupEnd();
    return [];
  }

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

  dbg("[findSeries] items:", items.length);
  if (items[0]) dbg("[findSeries] sample:", items[0]);
  console.groupEnd();
  return items;
}

/* -------------------------------------------------------------------------- */
/* Metadata (custom tags JSON at key 4096, series level)                      */
/* -------------------------------------------------------------------------- */

/**
 * Existence cache to avoid repeated 404 probes and console noise.
 * seriesId → true if 4096 exists; false if confirmed absent.
 */
const HAS_4096_CACHE = new Map<string, boolean>();

/**
 * Read custom tags (key 4096) with quiet existence handling:
 *  - If cache says true ➜ read directly.
 *  - Else: try index; if index lists 4096 ➜ cache=true ➜ read.
 *  - Else: do a quiet probe GET 4096 (no console 404). If 200 ➜ cache=true & parse; if 404 ➜ cache=false & {}.
 *
 * This avoids visible 404s while remaining robust to index serialization differences.
 * Ref: REST cheat sheet (per-key: GET/PUT /series/{id}/metadata/{name}); Book clarifies values are UTF-8 strings.
 * Sources: https://orthanc.uclouvain.be/book/users/rest-cheatsheet.html , https://orthanc.uclouvain.be/book/faq/features.html
 */
async function getSeriesCustomTagsWithEtag(
  seriesId: string
): Promise<{ tags: Record<string, string>; etag: string | null }> {
  console.groupCollapsed("[getSeriesCustomTagsWithEtag]", seriesId);

  const cached = HAS_4096_CACHE.get(seriesId);

  // Helper: parse a raw text into object
  const parseRaw = (rawText: string): Record<string, string> => {
    try {
      const first = JSON.parse(rawText);
      if (typeof first === "string") {
        const second = JSON.parse(first);
        return second && typeof second === "object" ? (second as Record<string, string>) : {};
      }
      return first && typeof first === "object" ? (first as Record<string, string>) : {};
    } catch {
      return {};
    }
  };

  // Direct read if cached present
  if (cached === true) {
    const url = orthancPath(`/series/${encodeURIComponent(seriesId)}/metadata/4096`);
    const res = await fetch(url);
    const etag = res.headers.get("ETag");
    if (res.ok) {
      const txt = (await res.text()).trim();
      const obj = parseRaw(txt);
      console.log("[getSeriesCustomTagsWithEtag] (cached=true) parsed keys:", Object.keys(obj));
      console.groupEnd();
      return { tags: obj, etag };
    }
    if (res.status === 404) {
      // Became absent (rare) → flip cache to false
      HAS_4096_CACHE.set(seriesId, false);
      console.log("[getSeriesCustomTagsWithEtag] (cached=true) now 404 → cache=false");
      console.groupEnd();
      return { tags: {}, etag: null };
    }
    // Other non-ok: fail closed
    console.log("[getSeriesCustomTagsWithEtag] (cached=true) non-ok:", res.status);
    console.groupEnd();
    return { tags: {}, etag: null };
  }

  // Try index (quiet): if lists 4096, switch cache → true
  try {
    const indexUrl = orthancPath(`/series/${encodeURIComponent(seriesId)}/metadata`);
    const idxRes = await fetch(indexUrl);
    if (idxRes.ok) {
      const idx = await idxRes.json();
      const keys = Object.keys(idx ?? {});
      const has4096 =
        keys.some((k) => k === "4096") ||
        keys.some((k) => Number(k) === 4096) ||
        keys.some((k) => k.toLowerCase() === "4096"); // symbolic name
      console.log("[getSeriesCustomTagsWithEtag] index keys:", keys, "has4096:", has4096);
      if (has4096) {
        HAS_4096_CACHE.set(seriesId, true);
      }
    }
  } catch {
    // ignore index errors
  }

  const updatedCache = HAS_4096_CACHE.get(seriesId);

  // If index revealed 4096, read now
  if (updatedCache === true) {
    const url = orthancPath(`/series/${encodeURIComponent(seriesId)}/metadata/4096`);
    const res = await fetch(url);
    const etag = res.headers.get("ETag");
    if (res.ok) {
      const txt = (await res.text()).trim();
      const obj = parseRaw(txt);
      console.log("[getSeriesCustomTagsWithEtag] (index says true) parsed keys:", Object.keys(obj));
      console.groupEnd();
      return { tags: obj, etag };
    }
    if (res.status === 404) {
      HAS_4096_CACHE.set(seriesId, false);
      console.log("[getSeriesCustomTagsWithEtag] (index said true) but 404 → cache=false");
      console.groupEnd();
      return { tags: {}, etag: null };
    }
    console.log("[getSeriesCustomTagsWithEtag] (index said true) non-ok:", res.status);
    console.groupEnd();
    return { tags: {}, etag: null };
  }

  // Quiet probe: GET 4096 without logging 404
  {
    const url = orthancPath(`/series/${encodeURIComponent(seriesId)}/metadata/4096`);
    const res = await fetch(url);
    const etag = res.headers.get("ETag");

    if (res.ok) {
      const txt = (await res.text()).trim();
      const obj = parseRaw(txt);
      HAS_4096_CACHE.set(seriesId, true);
      console.log("[getSeriesCustomTagsWithEtag] (probe) 200 → cache=true, parsed keys:", Object.keys(obj));
      console.groupEnd();
      return { tags: obj, etag };
    }
    if (res.status === 404) {
      HAS_4096_CACHE.set(seriesId, false);
      // Quiet: do not print 404 noise (just a single info)
      console.log("[getSeriesCustomTagsWithEtag] (probe) 404 → cache=false");
      console.groupEnd();
      return { tags: {}, etag: null };
    }
    // Other failure: log minimal, fail closed
    console.log("[getSeriesCustomTagsWithEtag] (probe) non-ok:", res.status);
    console.groupEnd();
    return { tags: {}, etag: null };
  }
}

/** Public: read the custom tags JSON container (metadata key 4096). */
export async function getSeriesCustomTags(
  seriesId: string
): Promise<Record<string, string>> {
  const { tags } = await getSeriesCustomTagsWithEtag(seriesId);
  dbg("[getSeriesCustomTags] final keys:", Object.keys(tags ?? {}));
  return tags;
}

/**
 * Low-level writer: try plain JSON text first (recommended),
 * then fallback to double-encoded JSON if server rejects.
 *
 * Returns the final Response.
 * Ref: Orthanc single-key metadata routes & UTF‑8 string values (per docs).
 * Sources: https://orthanc.uclouvain.be/book/users/rest-cheatsheet.html , https://orthanc.uclouvain.be/book/faq/features.html
 */
async function writeMetadata4096DualMode(
  seriesId: string,
  bodyObject: Record<string, string>,
  etag: string | null
): Promise<Response> {
  const url = orthancPath(`/series/${encodeURIComponent(seriesId)}/metadata/4096`);
  console.groupCollapsed("[writeMetadata4096DualMode] PUT", url);

  console.log("[writeMetadata4096DualMode] payload keys:", Object.keys(bodyObject));

  // Attempt A: plain JSON text (metadata values are strings)
  const attemptA = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: JSON.stringify(bodyObject),
  });
  console.log("[writeMetadata4096DualMode] attempt A status:", attemptA.status);
  if (!attemptA.ok) {
    let txt = "";
    try { txt = await attemptA.text(); } catch {}
    console.log("[writeMetadata4096DualMode] attempt A text:", txt);
  } else {
    console.groupEnd();
    return attemptA;
  }

  // Attempt B: legacy double-encoded JSON
  const doubleEncoded = JSON.stringify(JSON.stringify(bodyObject));
  const attemptB = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: doubleEncoded,
  });
  console.log("[writeMetadata4096DualMode] attempt B status:", attemptB.status);
  if (!attemptB.ok) {
    let txt = "";
    try { txt = await attemptB.text(); } catch {}
    console.log("[writeMetadata4096DualMode] attempt B text:", txt);
  }
  console.groupEnd();
  return attemptB;
}

/**
 * Merge‑safe write: read current (and ETag if revisions are enabled),
 * merge `current` + `tags` (incoming wins), then PUT via dual‑mode writer.
 * On success, mark cache[seriesId] = true (key now exists).
 */
export async function putSeriesCustomTags(
  seriesId: string,
  tags: Record<string, string>
): Promise<void> {
  console.groupCollapsed("[putSeriesCustomTags]", seriesId);
  const { tags: current, etag } = await getSeriesCustomTagsWithEtag(seriesId);
  console.log("[putSeriesCustomTags] current keys:", Object.keys(current));

  const merged: Record<string, string> = { ...current, ...tags };
  console.log("[putSeriesCustomTags] merged keys:", Object.keys(merged));

  const res = await writeMetadata4096DualMode(seriesId, merged, etag);
  if (!res.ok) {
    const msg = await res.text();
    console.log("[putSeriesCustomTags] write failed:", res.status, msg);
    console.groupEnd();
    throw new Error(msg);
  }

  // Successful write: ensure cache knows 4096 exists now
  HAS_4096_CACHE.set(seriesId, true);

  console.log("[putSeriesCustomTags] write ok, status:", res.status);
  console.groupEnd();
}

/** Set a single custom tag by merging into the JSON container. */
export async function setSeriesCustomTag(
  seriesId: string,
  tagName: string,
  value: string
): Promise<void> {
  console.groupCollapsed("[setSeriesCustomTag]", seriesId, tagName, value);
  const { tags: current, etag } = await getSeriesCustomTagsWithEtag(seriesId);
  console.log("[setSeriesCustomTag] current keys:", Object.keys(current));

  const merged: Record<string, string> = { ...current, [tagName]: value };
  console.log("[setSeriesCustomTag] merged keys:", Object.keys(merged));

  const res = await writeMetadata4096DualMode(seriesId, merged, etag);
  if (!res.ok) {
    const msg = await res.text();
    console.log("[setSeriesCustomTag] write failed:", res.status, msg);
    console.groupEnd();
    throw new Error(msg);
  }

  HAS_4096_CACHE.set(seriesId, true);

  console.log("[setSeriesCustomTag] OK, status:", res.status);
  console.groupEnd();
}

/** Delete a single custom tag by merging into the JSON container. */
export async function deleteSeriesCustomTag(
  seriesId: string,
  tagName: string
): Promise<void> {
  console.groupCollapsed("[deleteSeriesCustomTag]", seriesId, tagName);
  const { tags: current, etag } = await getSeriesCustomTagsWithEtag(seriesId);
  console.log("[deleteSeriesCustomTag] current keys pre-delete:", Object.keys(current));

  delete current[tagName];
  console.log("[deleteSeriesCustomTag] current keys post-delete:", Object.keys(current));

  const res = await writeMetadata4096DualMode(seriesId, current, etag);
  if (!res.ok) {
    const msg = await res.text();
    console.log("[deleteSeriesCustomTag] write failed:", res.status, msg);
    console.groupEnd();
    throw new Error(msg);
  }

  // If object becomes empty, we could optionally set cache=false, but we keep true:
  // the key 4096 still exists as an empty JSON text string unless we delete it explicitly.

  console.log("[deleteSeriesCustomTag] OK, status:", res.status);
  console.groupEnd();
}

/* -------------------------------------------------------------------------- */
/* Normalize items for the table (Series → Study → Patient merge)             */
/* -------------------------------------------------------------------------- */
async function normalizeSeriesItem(it: SeriesMatch): Promise<SeriesRowData> {
  console.groupCollapsed("[normalizeSeriesItem]", it.ID);
  const id = it.ID;
  if (!id) {
    warn("[normalizeSeriesItem] missing ID");
    console.groupEnd();
    return {
      id: "",
      slices: 0,
      requestedTags: it.RequestedTags ?? {},
      customTags: {},
    };
  }

  // 1) SERIES detail
  const series = await fetchJson(`/series/${encodeURIComponent(id)}`);
  const seriesTags: Record<string, string> = series?.MainDicomTags ?? {};
  const parentStudyId: string | undefined = series?.ParentStudy;

  const slices =
    typeof series?.InstancesCount === "number"
      ? series.InstancesCount
      : Array.isArray(series?.Instances)
      ? series.Instances.length
      : 0;
  dbg("[normalizeSeriesItem] series slices:", slices);

  // 2) STUDY detail
  const study = parentStudyId
    ? await fetchJson(`/studies/${encodeURIComponent(parentStudyId)}`)
    : null;
  const studyTags: Record<string, string> = study?.MainDicomTags ?? {};
  const parentPatientId: string | undefined = study?.ParentPatient;

  // 3) PATIENT detail
  const patient = parentPatientId
    ? await fetchJson(`/patients/${encodeURIComponent(parentPatientId)}`)
    : null;
  const patientTags: Record<string, string> = patient?.MainDicomTags ?? {};

  // Merge tags
  const requestedTags: Record<string, string> = {
    ...patientTags,
    ...studyTags,
    ...seriesTags,
    ...(it.RequestedTags ?? {}),
  };

  // Fallbacks
  if (!requestedTags["StudyDate"] && requestedTags["SeriesDate"]) {
    requestedTags["StudyDate"] = requestedTags["SeriesDate"];
  }
  if (!requestedTags["PatientName"] && requestedTags["PatientID"]) {
    requestedTags["PatientName"] = requestedTags["PatientID"];
  }
  dbg("[normalizeSeriesItem] requested keys:", Object.keys(requestedTags));

  // 4) Custom tags
  let customTags: Record<string, string> = {};
  try {
    customTags = await getSeriesCustomTags(id);
  } catch (e) {
    err("[normalizeSeriesItem] getSeriesCustomTags error:", e);
    customTags = {};
  }
  console.log("[normalizeSeriesItem] custom tag keys:", Object.keys(customTags ?? {}));

  const row = {
    id,
    slices,
    requestedTags,
    customTags,
  };
  dbg("[normalizeSeriesItem] row:", row);
  console.groupEnd();
  return row;
}

/** Public API: load and normalize all series for the table. */
export async function loadSeriesForTable(): Promise<SeriesRowData[]> {
  console.groupCollapsed("[loadSeriesForTable] START");
  const found = await findSeries({});
  if (!found.length) {
    warn("[loadSeriesForTable] /tools/find returned 0 series");
    console.groupEnd();
    return [];
  }
  const valid = found.filter((x) => !!x.ID);
  dbg("[loadSeriesForTable] valid count:", valid.length);

  const rows = await Promise.all(valid.map(normalizeSeriesItem));
  const finalRows = rows.filter((r) => !!r.id);

  dbg("[loadSeriesForTable] final rows:", finalRows.length);
  if (finalRows[0]) dbg("[loadSeriesForTable] sample row:", finalRows[0]);

  console.groupEnd();
  return finalRows;
}
