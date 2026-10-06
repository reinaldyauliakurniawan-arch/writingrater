import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { encryptSecret, decryptSecret } = await import("../crypto");

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("crypto (bagian 6.6)", () => {
  it("enkripsi lalu dekripsi menghasilkan teks semula", () => {
    const enc = encryptSecret("sk-test-123456", KEY);
    expect(enc.split(":")).toHaveLength(3);
    expect(enc).not.toContain("sk-test");
    expect(decryptSecret(enc, KEY)).toBe("sk-test-123456");
  });

  it("dua enkripsi teks sama menghasilkan string berbeda", () => {
    expect(encryptSecret("sama", KEY)).not.toBe(encryptSecret("sama", KEY));
  });

  it("kunci salah membuat dekripsi gagal", () => {
    const enc = encryptSecret("rahasia", KEY);
    expect(() => decryptSecret(enc, OTHER_KEY)).toThrow();
  });
});
