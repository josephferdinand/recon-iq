import { describe, it, expect } from "vitest";
import { toJSON, toCrossJSON } from "seroval";
import {
  validateRegistrationQaAck,
  nextRegistrationQaAction,
  validateRecoveryProof,
  validateJournal,
  validateBrowserRecoveryCall,
  publicRecoveryDto,
} from "./registration-recovery-hosted-20261004.mjs";
const good = {
  kind: "FVI_REGISTRATION_BOUNDED_QA_ACK",
  environment: "PROD",
  origin: "https://app.reconiq.example",
  sqlCommitted: true,
  registrationSqlSourceSha256: "f8285a42ea7dfb1424989643f2ff585f1428b856fd8c6c6be884c08cfe20ee63",
  appDeployed: true,
  deploymentId: "60000000-0000-4000-8000-000000000001",
  routeWired: true,
  path: "/request-invite",
  allowOneInvitation: true,
  userKind: "NEW_OWNED_REGISTRATION_USER",
  verifiedDomain: true,
  email: "owned-qa@example.test",
  fullName: "QA Creator",
  outputDirectory: "./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/registration-owned-test",
};
const proof = {
  attemptId: "60000000-0000-4000-8000-000000000002",
  recoveryToken: "a".repeat(64),
  email: good.email,
  full_name: good.fullName,
};
const journal = {
  kind: "FVI_REGISTRATION_QA_JOURNAL_V1",
  email: good.email,
  fullName: good.fullName,
  environment: good.environment,
  registrationSqlSourceSha256: good.registrationSqlSourceSha256,
  submitIntent: true,
  recoveryProof: proof,
};
describe("new hosted registration transport safety gates; no browser/network", () => {
  it.each(["sqlCommitted", "appDeployed", "routeWired", "allowOneInvitation", "verifiedDomain"])(
    "missing %s ACK fails closed before any live action",
    (key) => expect(() => validateRegistrationQaAck({ ...good, [key]: false })).toThrow(),
  );
  it("old deployed718 cannot masquerade as registration deployment ACK", () =>
    expect(() =>
      validateRegistrationQaAck({ ...good, deploymentId: "7180321a-e9c5-4014-bd9b-a3f1c52e392b" }),
    ).toThrow());
  it("wrong environment, source or actor type cannot authorize mail", () => {
    expect(() =>
      validateRegistrationQaAck({ ...good, origin: "https://dev.app.reconiq.example" }),
    ).toThrow();
    expect(() =>
      validateRegistrationQaAck({ ...good, registrationSqlSourceSha256: "wrong" }),
    ).toThrow();
    expect(() => validateRegistrationQaAck({ ...good, userKind: "OWNER_ACCOUNT" })).toThrow();
  });
  it("journal/proof output must remain in the isolated private FVI directory", () =>
    expect(() =>
      validateRegistrationQaAck({ ...good, outputDirectory: "./LOCAL_USER/Documents/public" }),
    ).toThrow());
  it("interrupt after submit intent cannot create another invitation without recovery proof", () =>
    expect(() => nextRegistrationQaAction({ submitIntent: true, email: good.email })).toThrow(
      "DO_NOT_REISSUE",
    ));
  it("a recovered journal authorizes status-only, never another submit", () =>
    expect(
      nextRegistrationQaAction({
        submitIntent: true,
        email: good.email,
        recoveryProof: { email: good.email },
      }),
    ).toBe("CHECK_ORIGINAL_REQUEST_ONLY"));
  it("proof from a different actor is rejected", () => {
    expect(() =>
      nextRegistrationQaAction({
        submitIntent: true,
        email: good.email,
        recoveryProof: { email: "other@example.test" },
      }),
    ).toThrow();
    expect(() =>
      validateRecoveryProof(
        {
          attemptId: "60000000-0000-4000-8000-000000000002",
          recoveryToken: "a".repeat(64),
          email: "other@example.test",
          full_name: good.fullName,
        },
        good,
      ),
    ).toThrow();
  });
  it("missing or contradictory saved intent cannot reset the run to a fresh submission", () => {
    expect(() => nextRegistrationQaAction({ email: good.email })).toThrow("DO_NOT_REISSUE");
    expect(() => nextRegistrationQaAction({ ...journal, submitIntent: false })).toThrow(
      "DO_NOT_REISSUE",
    );
    expect(() =>
      nextRegistrationQaAction({ submitIntent: false, intentAt: "interrupted" }),
    ).toThrow("DO_NOT_REISSUE");
  });
  it("valid saved proof resumes status checks and never creates a new intent", () => {
    const normalized = validateRegistrationQaAck({
      ...good,
      email: ` ${good.email.toUpperCase()} `,
      fullName: ` ${good.fullName} `,
    });
    expect(validateJournal(journal, normalized)).toBe("CHECK_ORIGINAL_REQUEST_ONLY");
    expect(validateRecoveryProof(proof, normalized)).toEqual(proof);
  });
  it("environment, source and full-name drift fail closed on an interrupted run", () => {
    for (const delta of [
      { environment: "DEV" },
      { fullName: "Different Creator" },
      { registrationSqlSourceSha256: "wrong" },
    ])
      expect(() => validateJournal({ ...journal, ...delta }, good)).toThrow("DO_NOT_REISSUE");
  });
  it("hyphen-only identifiers cannot satisfy deployment or recovery proof", () => {
    expect(() => validateRegistrationQaAck({ ...good, deploymentId: "-".repeat(36) })).toThrow();
    expect(() => validateRecoveryProof({ ...proof, attemptId: "-".repeat(36) }, good)).toThrow();
  });
  it("actual installed TanStack Seroval transport retains the same actor/proof and mode", () => {
    const body = JSON.stringify(toJSON({ data: { ...proof, mode: "check" } }));
    expect(
      validateBrowserRecoveryCall(`${good.origin}/_serverFn/registration`, body, good, proof),
    ).toBe("check");
    expect(() =>
      validateBrowserRecoveryCall(
        "https://other.example/_serverFn/registration",
        body,
        good,
        proof,
      ),
    ).toThrow();
    expect(() =>
      validateBrowserRecoveryCall(`${good.origin}/api/admin`, body, good, proof),
    ).toThrow();
  });
  it("changed identity or unknown transport mode is blocked before the browser request forwards", () => {
    for (const delta of [
      { attemptId: "60000000-0000-4000-8000-000000000003" },
      { recoveryToken: "b".repeat(64) },
      { mode: "resend" },
    ]) {
      const body = JSON.stringify(toJSON({ data: { ...proof, mode: "check", ...delta } }));
      expect(() =>
        validateBrowserRecoveryCall(`${good.origin}/_serverFn/registration`, body, good, proof),
      ).toThrow();
    }
  });
  it("real response serialization preserves machine business status independently of transport200", () => {
    const dto = {
      accepted: false,
      outcome: "existing",
      retryable: false,
      code: "SIGNUP_ACCOUNT_EXISTS",
      status: 409,
      requestId: "FVI-ABC123456789",
    };
    expect(publicRecoveryDto(toCrossJSON({ result: dto }))).toEqual(dto);
  });
  it("uncertain outcome can never be classified as accepted or safe to retry", () => {
    const dto = {
      accepted: false,
      outcome: "unknown",
      retryable: false,
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 503,
    };
    expect(publicRecoveryDto(toCrossJSON({ result: dto }))).toMatchObject(dto);
    for (const delta of [{ accepted: true }, { retryable: true }, { status: 200 }])
      expect(() => publicRecoveryDto(toCrossJSON({ result: { ...dto, ...delta } }))).toThrow();
  });
  it.each([
    { diagnostics: "provider internals" },
    { requestId: "eyJsecret.payload.signature" },
    { code: "SQLSTATE_XX000" },
  ])("raw or untrusted DTO metadata fails closed (%j)", (delta) => {
    const dto = {
      accepted: false,
      outcome: "unknown",
      retryable: false,
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 503,
      ...delta,
    };
    expect(() => publicRecoveryDto(toCrossJSON({ result: dto }))).toThrow();
  });
});
