import { describe, expect, it } from "vitest";
import { canEditPoints, isStaffAccess } from "./access";

describe("canEditPoints", () => {
  it("admins always; dispatchers only when ticked", () => {
    expect(canEditPoints({ role: "admin" })).toBe(true);
    expect(canEditPoints({ role: "dispatcher", points_edit: true })).toBe(true);
    expect(canEditPoints({ role: "dispatcher", points_edit: false })).toBe(false);
    expect(canEditPoints({ role: "dispatcher" })).toBe(false);
    expect(canEditPoints({ role: "driver", points_edit: null })).toBe(false);
  });
  it("isStaffAccess only allows the known permissions", () => {
    expect(isStaffAccess("points_edit")).toBe(true);
    expect(isStaffAccess("sdo_goods")).toBe(true);
    expect(isStaffAccess("role")).toBe(false);
  });
});
