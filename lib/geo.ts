import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BRANCHES, storeAddress } from "./branches";
import { pointsForKm } from "./commission";
import { mapAddress } from "./format";

/**
 * Store → customer driving distance with Google Maps, turned into driver points.
 * Needs GOOGLE_MAPS_API_KEY (server only) with "Geocoding API" and "Routes API" enabled.
 */

const KEY = process.env.GOOGLE_MAPS_API_KEY;
// Bias address lookups to southern Johor, where all branches deliver.
const JOHOR_BOUNDS = "1.20,103.20|2.10,104.40";
// Results this vague can't tell 2 points from 3 — ask the office instead.
const TOO_VAGUE = new Set(["country", "administrative_area_level_1", "administrative_area_level_2", "political", "postal_code"]);

type LatLng = { lat: number; lng: number };
type Geocoded = { at: LatLng; matched: string; approx: boolean };

export const mapsEnabled = () => !!KEY;

async function geocode(address: string): Promise<Geocoded | null> {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?" +
    new URLSearchParams({ address, region: "my", components: "country:MY", bounds: JOHOR_BOUNDS, key: KEY! });
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json();
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") throw new Error(`Geocoding: ${body.status} ${body.error_message ?? ""}`.trim());
  const r = body.results[0];
  if ((r.types as string[]).every((t) => TOO_VAGUE.has(t))) return null;
  return {
    at: r.geometry.location,
    matched: r.formatted_address,
    approx: !!r.partial_match || r.geometry.location_type === "APPROXIMATE",
  };
}

async function drivingKm(from: LatLng, to: LatLng): Promise<number> {
  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY!, "X-Goog-FieldMask": "routes.distanceMeters" },
    body: JSON.stringify({ origin: point(from), destination: point(to), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
  });
  const body = await res.json();
  const m = body.routes?.[0]?.distanceMeters;
  if (!res.ok || typeof m !== "number") throw new Error(`Routes: ${body.error?.message ?? "no route found"}`);
  return m / 1000;
}

// Store locations don't move: a store with a map pin uses it as is; the others are looked up
// once per server instance.
const storeCache = new Map<string, Promise<Geocoded | null>>();
function storeLocation(address: string) {
  const pin = BRANCHES.find((b) => b.store === address)?.pin;
  if (pin) return Promise.resolve<Geocoded>({ at: pin, matched: address, approx: false });
  if (!storeCache.has(address)) storeCache.set(address, geocode(address).catch((e) => (storeCache.delete(address), Promise.reject(e))));
  return storeCache.get(address)!;
}

type DoRow = { id: string; address: string | null; map_address: string | null; branch: string | null; points_manual: boolean; geo_input: string | null; geo_status: string | null };

async function measure(d: DoRow) {
  const address = mapAddress(d);
  const base = {
    geo_input: address,
    distance_km: null as number | null,
    geo_address: null as string | null,
    geo_lat: null as number | null,
    geo_lng: null as number | null,
  };
  const store = storeAddress(d.branch);
  if (!address?.trim()) return { ...base, geo_status: "no_address", points: null };
  if (!store) return { ...base, geo_status: "no_store", points: null };
  try {
    const [from, to] = await Promise.all([storeLocation(store), geocode(address)]);
    if (!from) return { ...base, geo_status: "no_store", points: null };
    if (!to) return { ...base, geo_status: "not_found", points: null };
    const km = Math.round((await drivingKm(from.at, to.at)) * 100) / 100;
    return {
      ...base,
      distance_km: km,
      geo_address: to.matched,
      geo_lat: to.at.lat,
      geo_lng: to.at.lng,
      geo_status: to.approx ? "approx" : "ok",
      points: pointsForKm(km),
    };
  } catch (e) {
    console.error("Distance failed for", d.id, e);
    return { ...base, geo_status: "error", points: null };
  }
}

/**
 * Works out distance + points for these DOs. Skips DOs whose points the office
 * keyed in, and DOs already measured from the same address (unless `force`).
 * Returns quietly when no API key is set — the office then keys points in.
 */
export async function updateDistances(supabase: SupabaseClient, doIds: string[], force = false) {
  const summary = { measured: 0, needManual: 0, skipped: 0 };
  if (!KEY || !doIds.length) return summary;

  const rows: DoRow[] = [];
  for (let i = 0; i < doIds.length; i += 200) {
    const { data } = await supabase
      .from("delivery_orders")
      .select("id, address, map_address, branch, points_manual, geo_input, geo_status")
      .in("id", doIds.slice(i, i + 200));
    rows.push(...((data ?? []) as DoRow[]));
  }
  // New or changed address, or last try hit an error. "Not found" isn't retried until the address changes.
  const todo = rows.filter(
    (d) => !d.points_manual && (force || !d.geo_status || d.geo_status === "error" || d.geo_input !== mapAddress(d))
  );
  summary.skipped = rows.length - todo.length;

  // A few at a time keeps Google happy and the import quick.
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(
      todo.slice(i, i + 8).map(async (d) => {
        const patch = await measure(d);
        await supabase.from("delivery_orders").update(patch).eq("id", d.id).eq("points_manual", false);
        if (patch.points == null) summary.needManual += 1;
        else summary.measured += 1;
      })
    );
  }
  return summary;
}

// ---------- Best route for a trip --------------------------------------

/** Google allows up to 25 stops between start and end when it reorders them. */
export const MAX_ROUTE_STOPS = 25;

type Stop = { id: string; address: string | null; map_address: string | null; geo_input: string | null; geo_lat: number | null; geo_lng: number | null };

/**
 * Where each DO is on the map: the saved spot when it's from the current
 * address, else looked up now (and saved). null = Google can't find it.
 */
async function locate(supabase: SupabaseClient, stops: Stop[]) {
  return Promise.all(
    stops.map(async (s): Promise<LatLng | null> => {
      const address = mapAddress(s);
      if (s.geo_lat != null && s.geo_lng != null && s.geo_input === address) return { lat: s.geo_lat, lng: s.geo_lng };
      if (!address?.trim()) return null;
      const g = await geocode(address).catch(() => null);
      if (g) await supabase.from("delivery_orders").update({ geo_lat: g.at.lat, geo_lng: g.at.lng }).eq("id", s.id);
      return g?.at ?? null;
    })
  );
}

/**
 * Shortest driving order for these stops, starting and ending at the store.
 * Returns stop ids in the new order (stops Google can't find go last).
 */
export async function bestRoute(supabase: SupabaseClient, storeAddr: string, stops: Stop[]) {
  if (!KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set on the server.");
  if (stops.length > MAX_ROUTE_STOPS) throw new Error(`Google can plan up to ${MAX_ROUTE_STOPS} stops per trip — split this trip in two.`);

  const [store, spots] = await Promise.all([storeLocation(storeAddr), locate(supabase, stops)]);
  if (!store) throw new Error("Google can't find the store address — check it in lib/branches.ts.");
  const found = stops.map((s, i) => ({ id: s.id, at: spots[i] })).filter((s): s is { id: string; at: LatLng } => !!s.at);
  const notFound = stops.filter((_, i) => !spots[i]).map((s) => s.id);
  if (!found.length) throw new Error("Google can't find any of these addresses.");

  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
    },
    body: JSON.stringify({
      origin: point(store.at),
      destination: point(store.at),
      intermediates: found.map((s) => point(s.at)),
      optimizeWaypointOrder: found.length > 1,
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    }),
  });
  const body = await res.json();
  const route = body.routes?.[0];
  if (!res.ok || !route) throw new Error(`Routes: ${body.error?.message ?? "no route found"}`);

  const order: number[] = route.optimizedIntermediateWaypointIndex?.length ? route.optimizedIntermediateWaypointIndex : found.map((_, i) => i);
  const ordered = order.map((i) => found[i]);
  const ll = (p: LatLng) => `${p.lat},${p.lng}`;
  // Google Maps links take up to 9 stops in between.
  const mapsUrl =
    ordered.length <= 9
      ? "https://www.google.com/maps/dir/?" +
        new URLSearchParams({
          api: "1",
          origin: ll(store.at),
          destination: ll(store.at),
          waypoints: ordered.map((s) => ll(s.at)).join("|"),
          travelmode: "driving",
        })
      : null;

  return {
    ids: [...ordered.map((s) => s.id), ...notFound],
    notFound,
    km: Math.round(route.distanceMeters / 100) / 10,
    minutes: Math.round(parseInt(route.duration, 10) / 60),
    mapsUrl,
  };
}
