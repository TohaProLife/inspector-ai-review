import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/identity.js";

describe("password hashing", () => {
  it("stores a salted scrypt verifier and rejects a wrong password", async () => {
    const password = "Local-Pilot-Password-2026!";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).toMatch(/^\$scrypt\$N=32768,r=8,p=1\$/);
    expect(first).not.toContain(password);
    expect(second).not.toBe(first);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword("Wrong-Password-2026!", first)).resolves.toBe(false);
    await expect(verifyPassword(password, "invalid-hash")).resolves.toBe(false);
  });
});
