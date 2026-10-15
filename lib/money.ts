export const formatUsd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export const parseUsdToCents = (value: string | number) => Math.round(Number(value) * 100);
