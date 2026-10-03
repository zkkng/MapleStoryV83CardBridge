export const cashTypes = Object.freeze([
  { cashType: 1, name: "NX Credit", externalCurrency: "NX_CREDIT" },
  { cashType: 2, name: "Maple Points", externalCurrency: "MAPLE_POINT" },
  { cashType: 4, name: "NX Prepaid", externalCurrency: "NX_PREPAID" },
]);
export function acceptedTypes(value = "1,2,4") {
  const types = value.split(",").map(Number);
  if (
    !types.length ||
    types.some((t) => !cashTypes.some((c) => c.cashType === t)) ||
    new Set(types).size !== types.length
  )
    throw Error("Accepted cash types must be a subset of 1,2,4");
  return types;
}
