export const text = (l) => `${l.service} ${l.sku} ${l.description} ${l.usageType}`.toLowerCase();
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
export const r2 = (n) => Math.round(n * 100) / 100;
export const money = (n) => {
  const v = r2(n);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
// List prices can have many decimals ($0.014/min, $0.0106/GB-hr): keep them exact.
export const rate = (n) => {
  const s = String(+Number(n).toPrecision(6));
  const dec = (s.split(".")[1] || "").length;
  return "$" + (dec < 2 ? Number(s).toFixed(2) : s);
};
export function match(lines, re, not) {
  return lines.filter((l) => re.test(text(l)) && !(not && not.test(text(l))));
}
export function finding(f) {
  return {
    severity: "medium",
    todo: [],
    monthlyCost: 0,
    saving: { amount: 0, kind: "none" },
    assumption: "",
    source: "",
    ...f,
    monthlyCost: r2(f.monthlyCost || 0),
    saving: f.saving ? { ...f.saving, amount: r2(Math.max(0, f.saving.amount || 0)) } : { amount: 0, kind: "none" }
  };
}
