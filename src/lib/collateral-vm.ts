import Decimal from "decimal.js";

const VmDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Decimal strings are required at the boundary so binary floating point never enters the calculation. */
export type VmCalculationInput = {
  /** Positive means the counterparty owes Entity A; negative means Entity A owes the counterparty. */
  exposure: string;
  exposureCurrency: string;
  /** Positive collateral amounts only, valued in the agreement currency after any external haircuts/FX. */
  collateralHeld: string;
  collateralHeldCurrency: string;
  collateralPosted: string;
  collateralPostedCurrency: string;
  agreementCurrency: string;
  threshold: string;
  minimumTransferAmount: string;
  /** Zero means no rounding; positive increments use nearest with ties rounded away from zero. */
  roundingIncrement: string;
  /** ISO calendar date on which the supplied exposure and collateral values were determined. */
  valuationDate: string;
};

export type VmCalculationResult = {
  currency: string;
  valuationDate: string;
  /** exposure - collateralHeld + collateralPosted */
  netExposure: string;
  /** Amount beyond the threshold before applying the rounding increment. */
  amountBeforeRounding: string;
  direction: "RECEIVE" | "PAY" | "NONE";
  /** Rounded amount after MTA; zero means no transfer is proposed. */
  transferAmount: string;
};

const DECIMAL_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MONEY_FIELDS = [
  "exposure",
  "collateralHeld",
  "collateralPosted",
  "threshold",
  "minimumTransferAmount",
  "roundingIncrement",
] as const;

function parseAmount(name: string, value: string): InstanceType<typeof VmDecimal> {
  if (typeof value !== "string" || !DECIMAL_TEXT.test(value)) {
    throw new TypeError(`${name} must be a plain decimal string`);
  }
  const amount = new VmDecimal(value);
  if (!amount.isFinite()) throw new RangeError(`${name} must be finite`);
  return amount;
}

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("valuationDate must be YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("valuationDate must be a valid calendar date");
  }
}

/**
 * Calculates a bilateral variation-margin transfer proposal from supplied, already-valued amounts.
 * This does not value assets, apply haircuts/FX, determine legal applicability, persist a call, or
 * implement a CSA lifecycle. Every currency must match; the caller owns valuation and provenance.
 */
export function calculateVariationMargin(input: VmCalculationInput): VmCalculationResult {
  const currencies = [
    input.agreementCurrency,
    input.exposureCurrency,
    input.collateralHeldCurrency,
    input.collateralPostedCurrency,
  ];
  if (currencies.some((currency) => typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) {
    throw new RangeError("currencies must be uppercase three-letter codes");
  }
  if (currencies.some((currency) => currency !== input.agreementCurrency)) {
    throw new RangeError("all amounts must use the agreement currency; convert before calculation");
  }
  validateDate(input.valuationDate);

  const amounts = Object.fromEntries(
    MONEY_FIELDS.map((field) => [field, parseAmount(field, input[field])]),
  ) as Record<(typeof MONEY_FIELDS)[number], InstanceType<typeof VmDecimal>>;
  for (const field of [
    "collateralHeld",
    "collateralPosted",
    "threshold",
    "minimumTransferAmount",
  ] as const) {
    if (amounts[field].isNegative()) throw new RangeError(`${field} cannot be negative`);
  }
  if (amounts.roundingIncrement.isNegative())
    throw new RangeError("roundingIncrement cannot be negative");

  const netExposure = amounts.exposure.minus(amounts.collateralHeld).plus(amounts.collateralPosted);
  const signedExcess = netExposure.abs().minus(amounts.threshold);
  const amountBeforeRounding = Decimal.max(signedExcess, 0);
  // Keep the same order as calculate_collateral_vm_call: apply MTA to the pre-rounding
  // amount, then round. A zero increment means the amount is retained as-is.
  const mtaEligible = amountBeforeRounding.gte(amounts.minimumTransferAmount)
    ? amountBeforeRounding
    : new VmDecimal(0);
  const transferAmount = amounts.roundingIncrement.isZero()
    ? mtaEligible
    : mtaEligible
        .div(amounts.roundingIncrement)
        .toDecimalPlaces(0)
        .times(amounts.roundingIncrement);
  const direction = transferAmount.isZero() ? "NONE" : netExposure.isPositive() ? "RECEIVE" : "PAY";

  return {
    currency: input.agreementCurrency,
    valuationDate: input.valuationDate,
    netExposure: netExposure.toString(),
    amountBeforeRounding: amountBeforeRounding.toString(),
    direction,
    transferAmount: transferAmount.toString(),
  };
}
