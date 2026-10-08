/** Vorfuehr-Rolle fuer den Austausch; nur sitzungsweise gespeichert, kein Zugriffsschutz. */
export type Role = "airport" | "lab" | "admin";
const ROLE_KEY = "aec.role";

export function storedRole(): Role {
  try {
    const r = sessionStorage.getItem(ROLE_KEY);
    return r === "airport" || r === "lab" ? r : "admin";
  } catch {
    return "admin";
  }
}
export function storeRole(role: Role) {
  try {
    sessionStorage.setItem(ROLE_KEY, role);
  } catch {
    /* nur fuer diese Ansicht */
  }
}
