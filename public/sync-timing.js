// Keep automatic requests near four per second per room even with 24 players.
// The action that a person performs still updates their own screen immediately.
export function pollInterval(memberCount) {
  const count = Number.isFinite(memberCount) ? Math.max(1, Math.ceil(memberCount)) : 1;
  return Math.min(6500, Math.max(1500, count * 250));
}
