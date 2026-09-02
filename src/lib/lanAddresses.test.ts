import { describe, expect, it } from "vitest";
import { isVirtualAdapter, selectPhoneReachableAddresses } from "./lanAddresses";

describe("isVirtualAdapter", () => {
  it("detects Hyper-V and WSL virtual switches by name", () => {
    expect(isVirtualAdapter("vEthernet (Default Switch)")).toBe(true);
    expect(isVirtualAdapter("vEthernet (WSL (Hyper-V firewall))")).toBe(true);
  });

  it("detects VirtualBox and VMware adapters by name", () => {
    expect(isVirtualAdapter("VirtualBox Host-Only Network")).toBe(true);
    expect(isVirtualAdapter("VirtualBox Host-Only Network #2")).toBe(true);
    expect(isVirtualAdapter("VMware Network Adapter VMnet1")).toBe(true);
  });

  it("detects a renamed adapter by its MAC OUI", () => {
    expect(isVirtualAdapter("Office Network", "00:15:5D:01:02:03")).toBe(true);
    expect(isVirtualAdapter("Office Network", "0a:00:27:00:00:11")).toBe(true);
  });

  it("treats real NICs as physical", () => {
    expect(isVirtualAdapter("Wi-Fi", "aa:bb:cc:dd:ee:ff")).toBe(false);
    expect(isVirtualAdapter("Ethernet", "aa:bb:cc:dd:ee:ff")).toBe(false);
  });

  it("does not let an all-zero MAC prefix-match a real OUI", () => {
    expect(isVirtualAdapter("Ethernet 2", "00:00:00:00:00:00")).toBe(false);
  });
});

describe("selectPhoneReachableAddresses", () => {
  it("offers only the real LAN address on a machine with WSL and VirtualBox", () => {
    // The exact layout that produced the 2026-07-25 report: three RFC1918
    // addresses offered, two of which no phone can ever reach.
    const addresses = selectPhoneReachableAddresses({
      "vEthernet (WSL)": [
        { address: "172.23.192.1", family: "IPv4", internal: false, mac: "00:15:5d:aa:bb:cc" },
      ],
      "VirtualBox Host-Only Network": [
        { address: "192.168.56.1", family: "IPv4", internal: false, mac: "0a:00:27:00:00:0e" },
      ],
      "Wi-Fi": [
        { address: "192.168.68.58", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff" },
      ],
    });

    expect(addresses).toEqual(["192.168.68.58"]);
  });

  it("omits loopback and IPv6", () => {
    const addresses = selectPhoneReachableAddresses({
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      Ethernet: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
    });

    expect(addresses).toEqual(["192.168.1.20"]);
  });

  it("prefers a private LAN address over a public one", () => {
    const addresses = selectPhoneReachableAddresses({
      WAN: [{ address: "203.0.113.5", family: "IPv4", internal: false }],
      LAN: [{ address: "10.0.0.8", family: "IPv4", internal: false }],
    });

    expect(addresses).toEqual(["10.0.0.8", "203.0.113.5"]);
  });

  it("falls back to virtual addresses rather than returning nothing", () => {
    // Better a filtered-out address the admin can recognise than an empty list
    // that leaves them with no way to configure field access at all.
    const addresses = selectPhoneReachableAddresses({
      "vEthernet (Default Switch)": [
        { address: "172.23.192.1", family: "IPv4", internal: false },
      ],
    });

    expect(addresses).toEqual(["172.23.192.1"]);
  });

  it("returns an empty list when there is nothing but loopback", () => {
    const addresses = selectPhoneReachableAddresses({
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    });

    expect(addresses).toEqual([]);
  });

  it("does not mutate the caller's arrays", () => {
    const wifi = [
      { address: "203.0.113.5", family: "IPv4", internal: false },
      { address: "10.0.0.8", family: "IPv4", internal: false },
    ];
    selectPhoneReachableAddresses({ "Wi-Fi": wifi });

    expect(wifi.map((e) => e.address)).toEqual(["203.0.113.5", "10.0.0.8"]);
  });
});
