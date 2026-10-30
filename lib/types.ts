export type Role = "admin" | "dispatcher" | "driver";
export type SoStatus = "open" | "partial" | "fulfilled" | "cancelled";
export type DoStatus = "pending" | "assigned" | "out_for_delivery" | "delivered" | "failed";

export const DO_STATUSES: DoStatus[] = ["pending", "assigned", "out_for_delivery", "delivered", "failed"];

export const DO_STATUS_LABEL: Record<DoStatus, string> = {
  pending: "Unassigned",
  assigned: "Assigned",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  failed: "Failed",
};

export const SO_STATUS_LABEL: Record<SoStatus, string> = {
  open: "Open",
  partial: "Partially on DO",
  fulfilled: "On DO",
  cancelled: "Cancelled",
};

/** Optional estimated delivery windows (value stored on the DO → label). */
export const TIME_SLOTS = {
  "0845-1100": "8.45–11am",
  "1100-1300": "11am–1pm",
  "1300-1500": "1–3pm",
  "1500-1700": "3–5pm",
  "1700-1900": "5–7pm",
  "1900-2100": "7–9pm",
} as const;
export type TimeSlot = keyof typeof TIME_SLOTS;

export type Profile = { id: string; full_name: string; real_name: string | null; role: Role; phone: string | null; branch: string | null; lorry_no: string | null };

export type SalesOrder = {
  id: string;
  so_no: string;
  so_date: string;
  debtor_code: string | null;
  customer_name: string;
  phone: string | null;
  address: string | null;
  branch: string | null;
  sales_location: string | null;
  agent: string | null;
  credit_term: string | null;
  total: number | null;
  remarks: string | null;
  transfer_to: string | null;
  icb_from_po: string | null;
  created_user: string | null;
  ac_created_at: string | null;
  status: SoStatus;
  source: string;
};

/** A DO's link to one of its SOs (one DO can come from several SOs). */
export type DoSoLink = { so_no: string; so_id: string | null };

export type DoItem = { id: string; item_code: string; description: string | null; uom: string | null; qty: number };

export type DeliveryOrder = {
  id: string;
  do_no: string;
  so_id: string | null; // first linked SO; all of them are in `links`
  so_no: string; // "GPS-00030782, GPS-00030788"
  customer_name: string;
  contact_phone: string | null;
  address: string | null;
  map_address: string | null; // typed by the office when Google can't find `address`
  remarks: string | null;
  delivery_date: string;
  doc_date: string | null; // AutoCount Doc Date; null for special DOs
  time_slot: TimeSlot | null; // optional estimated delivery window
  branch: string | null; // delivering branch
  sales_branch: string | null; // agent's branch
  helper_branch: string | null; // another branch helping to deliver it (handed over)
  ref: string | null;
  total: number | null;
  invoice_no: string | null;
  created_user: string | null;
  cancelled: boolean;
  source: string; // autocount | special
  special_no: string | null; // the SDO-… number it had before it was linked to its AutoCount DO
  instructions: string | null; // office → driver
  points: number | null; // commission points; null = office must key in
  points_manual: boolean;
  distance_km: number | null;
  geo_status: string | null; // ok | approx | not_found | no_store | no_address | error
  geo_address: string | null;
  geo_input: string | null; // the address distance was last worked out from
  geo_lat: number | null;
  geo_lng: number | null;
  own_collection: boolean | null; // office's O/C pick; null = auto from remarks/address
  is_oc: boolean; // O/C = customer collects at the store (no delivery)
  supplier_delivery: boolean; // the supplier delivers it: no driver, delivered when picked
  driver_id: string | null;
  lorry_id: string | null; // lorry it was delivered with (set when delivered)
  trip_no: number;
  trip_seq: number;
  status: DoStatus;
  failed_reason: string | null;
  pod_photo_path: string | null;
  wa_sent_at: string | null; // "delivered" WhatsApp sent from the company number
  wa_error: string | null; // why the last send failed
  delivered_at: string | null;
  started_at?: string | null; // when the driver last tapped Start (from status_events, see lib/delivery-times.ts)
  created_by: string | null; // staff who keyed it in (special DOs)
  created_at: string; // when it came into the system (AutoCount sync or keyed in)
  driver?: { full_name: string; lorry_no: string | null } | null;
  do_items?: DoItem[];
  links?: DoSoLink[];
  outstanding?: Outstanding[]; // only the ones not cleared yet
  attempts?: { id: string; failed_at: string; failed_reason: string | null }[]; // failed tries (delivery_attempts)
};

/** status_events.status → what the timeline / DO history shows. */
export const EVENT_LABEL: Record<string, string> = {
  so_created: "Order created",
  do_created: "DO created",
  points: "Points changed",
  trip: "Trip arranged",
  linked: "Linked to AutoCount DO",
  ...DO_STATUS_LABEL,
};

export type StatusEvent = {
  id: number;
  status: string;
  note: string | null;
  created_at: string;
  do_id: string | null;
  actor?: { full_name: string } | null;
};

export type OutstandingTodo = "cn" | "edit_do" | "dr" | "other";

export const TODO_LABEL: Record<OutstandingTodo, string> = {
  cn: "Add Credit Note (CN)",
  edit_do: "Edit DO",
  dr: "Add Delivery Return (DR)",
  other: "Others",
};

/** Something the office still has to fix for a DO (in AutoCount); cleared once done. */
export type Outstanding = {
  id: string;
  do_id: string;
  reason: string;
  todo: OutstandingTodo;
  todo_other: string | null;
  description: string | null;
  created_at: string;
  cleared_at: string | null;
  creator?: { full_name: string } | null;
  clearer?: { full_name: string } | null;
};

/** "Edit DO", or what was typed for "Others". */
export const todoLabel = (o: Pick<Outstanding, "todo" | "todo_other">) =>
  o.todo === "other" && o.todo_other ? o.todo_other : TODO_LABEL[o.todo];

/** A lorry, its driver (if any) and its maintenance booking. */
export type Lorry = {
  id: string;
  lorry_no: string;
  plate_no: string | null;
  branch: string | null;
  driver_id: string | null;
  maintenance_from: string | null; // set = under (or booked for) maintenance from this day
  maintenance_to: string | null; // expected back; null = not known yet
  maintenance_note: string | null;
  borrow_branch: string | null; // "Borrow to": lent to this branch, which can put its own driver on it
};

/** "JQN 9833 (46)", as on the trip forms; just "46" without a plate. */
export const lorryLabel = (l: Pick<Lorry, "lorry_no" | "plate_no">) => (l.plate_no ? `${l.plate_no} (${l.lorry_no})` : l.lorry_no);

/** Under maintenance on `day` (YYYY-MM-DD). */
export const inMaintenance = (l: Pick<Lorry, "maintenance_from" | "maintenance_to">, day: string) =>
  !!l.maintenance_from && l.maintenance_from <= day && (!l.maintenance_to || l.maintenance_to >= day);
