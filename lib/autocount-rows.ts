/**
 * AutoCount documents in one clean shape. The AutoCount API (lib/autocount-api.ts)
 * is mapped to these types and fed to the import in lib/autocount.ts.
 */

export type AcSalesOrder = {
  doc_no: string;
  date: string | null; // YYYY-MM-DD
  debtor_code: string | null;
  debtor_name: string | null;
  delivery_phone: string | null;
  sales_location: string | null;
  agent: string | null;
  credit_term: string | null;
  transfer_to: string | null; // DO number(s), "GPD-1, GPD-2"
  total: number | null;
  remark: string | null;
  delivery_address: string | null;
  created_user: string | null;
  created_time: string | null; // ISO with +08:00
  icb_from_po: string | null;
};

export type AcDeliveryOrder = {
  doc_no: string;
  date: string | null;
  debtor_code: string | null;
  debtor_name: string | null;
  sales_location: string | null;
  delivery_address: string | null;
  transfer_from: string | null; // SO number(s)
  transfer_to: string | null; // invoice number
  ref: string | null;
  phone: string | null;
  created_user: string | null;
  total: number | null;
  cancelled: boolean;
  items?: AcItem[];
};

export type AcItem = { item_code: string; description: string | null; uom: string | null; qty: number };

export type AcImportResult = {
  created: string[];
  updated: string[];
  warnings: string[];
  errors: string[];
  notes?: string[];
};

/** "GPD-00044685, GPD-00044686" → ["GPD-00044685", "GPD-00044686"] */
export function splitDocNos(v: string | null | undefined): string[] {
  return [...new Set((v ?? "").split(/[,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
}
