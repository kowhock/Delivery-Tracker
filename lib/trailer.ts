/**
 * "Assign other branch" → Outsource trailer: an outside company's trailer delivers the DO. It has no
 * lorry in the app (no number or plate), so it's this value instead of a trailer id (setTrailer),
 * with the company picked from OUTSOURCE_COMPANIES (saved on the DO as outsource_name).
 */
export const OUTSOURCE_TRAILER = "outsource";

/** Outside trailer companies. To add one, add its name here. */
export const OUTSOURCE_COMPANIES = ["Siva", "You Hup"] as const;

export const isOutsourceCompany = (name: unknown): name is string => typeof name === "string" && (OUTSOURCE_COMPANIES as readonly string[]).includes(name);
