import { classifyFieldUrl } from "./fieldAccessUrl";

/** The subset of `os.NetworkInterfaceInfo` this module needs. */
export interface NetworkAddress {
  address: string;
  family: string;
  internal: boolean;
  mac?: string;
}

/**
 * Adapter names Windows gives to virtualization stacks. Matched as lowercase
 * substrings because the full names carry suffixes we can't predict
 * ("vEthernet (WSL (Hyper-V firewall))", "VirtualBox Host-Only Network #2").
 */
const VIRTUAL_NAME_MARKERS = [
  "vethernet", // Hyper-V / WSL virtual switch
  "hyper-v",
  "virtualbox",
  "vmware",
  "vmnet", // also covers macOS vmnet interfaces (vmnet0, vmnet8, ...)
  "docker",
  "wsl",
  "loopback",
  "bluetooth",
  "tap-windows", // OpenVPN and friends
  "npcap",
  "awdl", // macOS Apple Wireless Direct Link (AirDrop/Handoff)
  "llw", // macOS low-latency WLAN, paired with awdl0
  "utun", // macOS VPN/tunnel interfaces
  "bridge", // macOS bridge100 (Internet Sharing / virtualization bridge)
  "ap1", // macOS Wi-Fi AP/hotspot virtual interface
];

/**
 * OUI prefixes for the same stacks, checked as a second signal because a
 * renamed adapter loses the name hint but keeps its MAC.
 */
const VIRTUAL_MAC_PREFIXES = [
  "00:15:5d", // Microsoft Hyper-V
  "0a:00:27", // VirtualBox host-only
  "08:00:27", // VirtualBox
  "00:50:56", // VMware
  "00:0c:29", // VMware
  "00:05:69", // VMware
  "00:1c:14", // VMware
  "02:42", // Docker bridge
];

/**
 * True for an adapter that exists only inside this PC. Their addresses are
 * real and routable *on the host*, which is exactly what makes them dangerous
 * here: they look like ordinary private LAN addresses (192.168.56.1 for
 * VirtualBox host-only, 172.23.x for a Hyper-V/WSL switch) and pass every
 * RFC1918 check, but no phone on the office WiFi can reach them.
 */
export function isVirtualAdapter(name: string, mac?: string): boolean {
  const lowerName = name.toLowerCase();
  if (VIRTUAL_NAME_MARKERS.some((marker) => lowerName.includes(marker))) return true;

  // os reports an all-zero MAC for adapters that have none; ignore those rather
  // than letting "00:..." accidentally prefix-match a real OUI.
  const lowerMac = (mac ?? "").toLowerCase();
  if (!lowerMac || lowerMac === "00:00:00:00:00:00") return false;
  return VIRTUAL_MAC_PREFIXES.some((prefix) => lowerMac.startsWith(prefix));
}

/**
 * The addresses a phone on the office WiFi could actually use to reach this
 * server, best candidate first.
 *
 * Drops IPv6, loopback, and virtual adapters, then sorts private (RFC1918)
 * addresses ahead of public ones — on a machine with both a LAN NIC and
 * something public, the LAN one is what field techs can reach.
 *
 * Offering an unreachable address is worse than offering none: the admin picks
 * it, the QR encodes it, and every tech's phone hangs on a connection that is
 * never refused, only dropped — a white screen that never finishes loading.
 */
export function selectPhoneReachableAddresses(
  interfaces: Record<string, NetworkAddress[] | undefined>
): string[] {
  const all: string[] = [];
  const physical: string[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      all.push(entry.address);
      if (!isVirtualAdapter(name, entry.mac)) physical.push(entry.address);
    }
  }

  // Never hand back an empty list. If every adapter looked virtual, the
  // heuristic is likelier to be wrong than the machine is to be genuinely
  // unreachable — a filtered-out real address beats no address at all, since
  // the admin can still recognise their own LAN.
  const candidates = physical.length > 0 ? physical : all;

  const isPrivate = (addr: string) => classifyFieldUrl(`http://${addr}`).isPrivateLan;
  return [...candidates].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}
