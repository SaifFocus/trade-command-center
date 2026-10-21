import { describe, expect, it } from "vitest";
import { accountInput, agentInput } from "./management-input";
const base = { platform: "youtube", handle: "@creator", linked_in_whop: false, status: "warming", notes: null };
describe("account management", () => {
  it("normalizes handles and refuses empty handles and profile URLs", () => {
    expect(accountInput.parse({ ...base, handle: " @creator " }).handle).toBe("creator");
    for (const handle of ["@", " ", "https://youtube.com/@creator", "two words"]) expect(accountInput.safeParse({ ...base, handle }).success).toBe(false);
  });
  it("accepts each configured platform", () => {
    for (const platform of ["tiktok", "instagram", "youtube", "x", "other"]) expect(accountInput.parse({ ...base, platform }).platform).toBe(platform);
    expect(accountInput.safeParse({ ...base, platform: "unknown" }).success).toBe(false);
  });
  it("preserves account status and Whop link declaration", () => {
    for (const status of ["active", "warming", "restricted", "banned"]) expect(accountInput.parse({ ...base, status, linked_in_whop: true })).toMatchObject({ status, linked_in_whop: true });
    expect(accountInput.safeParse({ ...base, status: "deleted" }).success).toBe(false);
  });
});
describe("agent configuration", () => {
  it("accepts manual, assisted and auto autonomy", () => {
    for (const autonomy of ["manual", "assisted", "auto"]) expect(agentInput.parse({ key: "publisher", autonomy }).autonomy).toBe(autonomy);
    expect(agentInput.safeParse({ key: "publisher", autonomy: "unrestricted" }).success).toBe(false);
  });
  it("allows disabling without changing autonomy and refuses empty changes", () => {
    expect(agentInput.parse({ key: "publisher", enabled: false })).toEqual({ key: "publisher", enabled: false });
    expect(agentInput.safeParse({ key: "publisher" }).success).toBe(false);
  });
});