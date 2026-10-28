import { describe, expect, it } from "vitest";
import { calculateVariationMargin, type VmCalculationInput } from "@/lib/collateral-vm";

const baseInput: VmCalculationInput = {
  exposure: "0",
  exposureCurrency: "USD",
  collateralHeld: "0",
  collateralHeldCurrency: "USD",
  collateralPosted: "0",
  collateralPostedCurrency: "USD",
  agreementCurrency: "USD",
  threshold: "0",
  minimumTransferAmount: "0",
  roundingIncrement: "1",
  valuationDate: "2026-09-24",
};

describe("calculateVariationMargin", () => {
  it("uses the illustrative screen's calculation table as oracle and exposes its conflicting call figure", () => {
    const result = calculateVariationMargin({
      ...baseInput,
      exposure: "1250000",
      collateralHeld: "700000",
      threshold: "100000",
      minimumTransferAmount: "25000",
      roundingIncrement: "1000",
      valuationDate: "2025-03-14",
    });

    expect(result).toEqual({
      currency: "USD",
      valuationDate: "2025-03-14",
      netExposure: "550000",
      amountBeforeRounding: "450000",
      direction: "RECEIVE",
      transferAmount: "450000",
    });
    // The design's status panel says 45,000; the displayed formula and inputs calculate 450,000.
  });

  it("assigns transfer direction from Entity A's signed exposure", () => {
    expect(calculateVariationMargin({ ...baseInput, exposure: "125" })).toMatchObject({
      direction: "RECEIVE",
      transferAmount: "125",
    });
    expect(calculateVariationMargin({ ...baseInput, exposure: "-125" })).toMatchObject({
      direction: "PAY",
      transferAmount: "125",
    });
  });

  it("nets held and posted collateral in opposite directions", () => {
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "200", collateralHeld: "75" }),
    ).toMatchObject({ netExposure: "125", direction: "RECEIVE", transferAmount: "125" });
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "-200", collateralPosted: "75" }),
    ).toMatchObject({ netExposure: "-125", direction: "PAY", transferAmount: "125" });
  });

  it("applies threshold on either side and produces no call at or within threshold", () => {
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "100", threshold: "100" }),
    ).toMatchObject({ amountBeforeRounding: "0", direction: "NONE", transferAmount: "0" });
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "-150", threshold: "100" }),
    ).toMatchObject({ amountBeforeRounding: "50", direction: "PAY", transferAmount: "50" });
  });

  it("applies MTA before rounding and includes the exact MTA boundary", () => {
    const input = { ...baseInput, minimumTransferAmount: "25" };
    expect(
      calculateVariationMargin({ ...input, exposure: "24.49", roundingIncrement: "1" }),
    ).toMatchObject({ direction: "NONE", transferAmount: "0" });
    expect(
      calculateVariationMargin({ ...input, exposure: "24.99", roundingIncrement: "1" }),
    ).toMatchObject({ direction: "NONE", transferAmount: "0" });
    expect(
      calculateVariationMargin({ ...input, exposure: "25", roundingIncrement: "1" }),
    ).toMatchObject({ direction: "RECEIVE", transferAmount: "25" });
  });

  it("rounds exact decimal half increments away from zero without floating point", () => {
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "1.005", roundingIncrement: "0.01" }),
    ).toMatchObject({ amountBeforeRounding: "1.005", transferAmount: "1.01" });
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "1.0049", roundingIncrement: "0.01" }),
    ).toMatchObject({ transferAmount: "1" });
  });

  it("rejects numeric inputs, malformed or mismatched currencies, invalid dates, and invalid terms", () => {
    expect(() =>
      calculateVariationMargin({ ...baseInput, exposure: 0.1 as unknown as string }),
    ).toThrow("plain decimal string");
    expect(() => calculateVariationMargin({ ...baseInput, exposureCurrency: "US" })).toThrow(
      "three-letter",
    );
    expect(() => calculateVariationMargin({ ...baseInput, collateralHeldCurrency: "EUR" })).toThrow(
      "agreement currency",
    );
    expect(() => calculateVariationMargin({ ...baseInput, valuationDate: "2025-02-30" })).toThrow(
      "valid calendar date",
    );
    expect(() => calculateVariationMargin({ ...baseInput, collateralHeld: "-1" })).toThrow(
      "cannot be negative",
    );
    expect(
      calculateVariationMargin({ ...baseInput, exposure: "1.005", roundingIncrement: "0" }),
    ).toMatchObject({ direction: "RECEIVE", transferAmount: "1.005" });
    expect(() => calculateVariationMargin({ ...baseInput, roundingIncrement: "-1" })).toThrow(
      "cannot be negative",
    );
    expect(() => calculateVariationMargin({ ...baseInput, threshold: "1e3" })).toThrow(
      "plain decimal string",
    );
  });
});
