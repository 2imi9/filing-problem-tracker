import { describe, expect, it } from "vitest";
import { SHARED_ADDRESS, clientAddress } from "@/server/clientAddress";

const from = (forwardedFor?: string) => new Request("http://localhost:3000/api/demo/login", { headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor } });

describe("clientAddress", () => {
  it("ignores the header when no proxy is trusted: the caller wrote it", () => {
    expect(clientAddress(from("203.0.113.9"), 0)).toBe(SHARED_ADDRESS);
    expect(clientAddress(from("203.0.113.9, 10.0.0.1"), 0)).toBe(SHARED_ADDRESS);
    expect(clientAddress(from(), 0)).toBe(SHARED_ADDRESS);
    // The default comes from TRUSTED_PROXY_HOPS, which is 0 unless set.
    expect(clientAddress(from("203.0.113.9"))).toBe(SHARED_ADDRESS);
  });

  it("takes the entry the trusted proxy appended, counted from the right", () => {
    expect(clientAddress(from("203.0.113.9"), 1)).toBe("203.0.113.9");
    // Whatever the caller put in front is not believed.
    expect(clientAddress(from("1.2.3.4, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientAddress(from("1.2.3.4, 203.0.113.9, 10.0.0.1"), 2)).toBe("203.0.113.9");
    expect(clientAddress(from("2001:DB8::1"), 1)).toBe("2001:db8::1");
  });

  it("falls back to the shared bucket when the list is too short or the entry is not an address", () => {
    expect(clientAddress(from(), 1)).toBe(SHARED_ADDRESS);
    expect(clientAddress(from("203.0.113.9"), 2)).toBe(SHARED_ADDRESS);
    expect(clientAddress(from("not-an-address"), 1)).toBe(SHARED_ADDRESS);
    expect(clientAddress(from(`203.0.113.9, ${"a".repeat(5000)}`), 1)).toBe(SHARED_ADDRESS);
    expect(clientAddress(from("203.0.113.9,"), 1)).toBe(SHARED_ADDRESS);
  });
});
