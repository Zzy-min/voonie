// Backend timestamps without an offset are UTC; date-only records stay date-only.
export function diaryDateKey(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!value) return "";
  let iso = value.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += "Z";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    // Older WeChat runtimes may lack formatToParts. China has no DST.
    if (timeZone === "Asia/Shanghai" || timeZone === "UTC") {
      const shifted = new Date(date.getTime() + (timeZone === "Asia/Shanghai" ? 8 : 0) * 3600000);
      return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
}
