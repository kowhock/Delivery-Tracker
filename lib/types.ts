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

export type Profile = { id: string; full_name: string; role: Role; phone: string | null; branch: string | null; lorry_no: string | null };

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
  remarks: string | null;
  delivery_date: string;
  branch: string | null; // delivering branch
  sales_branch: string | null; // agent's branch
  ref: string | null;
  total: number | null;
  invoice_no: string | null;
  created_user: string | null;
  cancelled: boolean;
  source: string; // autocount | special
  instructions: string | null; // office → driver
  points: number | null; // commission points; null = office must key in
  points_manual: boolean;
  distance_km: number | null;
  geo_status: string | null; // ok | approx | not_found | no_store | no_address | error
  geo_address: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  own_collection: boolean | null; // office's O/C pick; null = auto from remarks/address
  is_oc: boolean; // O/C = customer collects at the store (no delivery)
  driver_id: string | null;
  trip_no: number;
  trip_seq: number;
  status: DoStatus;
  failed_reason: string | null;
  pod_photo_path: string | null;
  delivered_at: string | null;
  driver?: { full_name: string; lorry_no: string | null } | null;
  do_items?: DoItem[];
  links?: DoSoLink[];
  outstanding?: Outstanding[]; // only the ones not cleared yet
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
