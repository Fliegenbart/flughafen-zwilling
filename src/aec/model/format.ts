/** Zahlen und Uhrzeiten in Kaeufer-Einheiten (de-DE). */
const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const clock = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Leistung in Kaeufer-Einheit: unter 1 MW in kW, sonst MW mit zwei Stellen. */
export function power(kw: number): { value: string; unit: string } {
  return Math.abs(kw) >= 1000
    ? { value: nf2.format(kw / 1000), unit: "MW" }
    : { value: nf0.format(kw), unit: "kW" };
}
/** Zahl und Einheit mit geschuetztem Leerzeichen, damit sie nie auseinanderbrechen. */
export const unit = (value: string | number, u: string) => `${value}\u00a0${u}`;
export const powerText = (kw: number) => {
  const p = power(kw);
  return unit(p.value, p.unit);
};
export const int = (n: number) => nf0.format(n);
export const dec1 = (n: number) => nf1.format(n);
