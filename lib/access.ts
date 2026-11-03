/**
 * Staff permissions an admin ticks per dispatcher on Deliveries → Admin access. Admins always have them.
 * - sdo_goods:   Kurang Hantar special orders (see canHandleGoods in lib/special.ts)
 * - points_edit: change a DO's points on Driver status (key in, back to the distance rule, the address
 *                used for points) and on the trip form. Special DOs are the exception: whoever can
 *                make / edit one sets its points on the special DO form. "Calculate missing points"
 *                (the distance rule only) stays open to all staff.
 * Also enforced in the database (guard_points in schema.sql).
 */
export const STAFF_ACCESS = {
  sdo_goods: "Special order",
  points_edit: "Edit points",
} as const;
export type StaffAccess = keyof typeof STAFF_ACCESS;
export const isStaffAccess = (k: unknown): k is StaffAccess => typeof k === "string" && k in STAFF_ACCESS;

export const canEditPoints = (p: { role: string; points_edit?: boolean | null }) => p.role === "admin" || !!p.points_edit;

export const NO_POINTS_ACCESS = "Only admins and staff an admin has allowed can change points.";
