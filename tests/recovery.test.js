const { evaluatePolicy, ACTIONS } = require("../workers/recovery-orchestrator/policy");

describe("Recovery Policy Engine Tests", () => {
    it("should return ESCALATE_HUMAN for risk hold", () => {
        const context = { attemptCount: 1, amount: 200, riskHold: true };
        const diagnosis = { category: "BANK_DECLINE", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.ESCALATE_HUMAN);
    });

    it("should return NO_ACTION if max attempts reached", () => {
        const context = { attemptCount: 3, amount: 200, riskHold: false };
        const diagnosis = { category: "INSUFFICIENT_FUNDS", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.NO_ACTION);
    });

    it("should return NO_ACTION if amount is below economic floor", () => {
        const context = { attemptCount: 1, amount: 10, riskHold: false };
        const diagnosis = { category: "NETWORK_TIMEOUT", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.NO_ACTION);
    });

    it("should return ESCALATE_HUMAN for low confidence diagnosis", () => {
        const context = { attemptCount: 1, amount: 200, riskHold: false };
        const diagnosis = { category: "NETWORK_TIMEOUT", confidence: 0.70 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.ESCALATE_HUMAN);
    });

    it("should return RETRY_SCHEDULED for INSUFFICIENT_FUNDS", () => {
        const context = { attemptCount: 1, amount: 200, riskHold: false };
        const diagnosis = { category: "INSUFFICIENT_FUNDS", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.RETRY_SCHEDULED);
    });

    it("should return RETRY_SCHEDULED for NETWORK_TIMEOUT", () => {
        const context = { attemptCount: 1, amount: 200, riskHold: false };
        const diagnosis = { category: "NETWORK_TIMEOUT", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.RETRY_SCHEDULED);
    });

    it("should return NOTIFY_CUSTOMER for CARD_EXPIRED", () => {
        const context = { attemptCount: 1, amount: 200, riskHold: false };
        const diagnosis = { category: "CARD_EXPIRED", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.NOTIFY_CUSTOMER);
    });

    it("should return NOTIFY_CUSTOMER for INVALID_PAYMENT_DETAILS", () => {
        const context = { attemptCount: 1, amount: 200, riskHold: false };
        const diagnosis = { category: "INVALID_PAYMENT_DETAILS", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.NOTIFY_CUSTOMER);
    });
    
    it("should return NOTIFY_CUSTOMER if BANK_DECLINE attempts exceed 1", () => {
        const context = { attemptCount: 2, amount: 200, riskHold: false };
        const diagnosis = { category: "BANK_DECLINE", confidence: 0.95 };
        const action = evaluatePolicy(diagnosis, context);
        expect(action).toBe(ACTIONS.NOTIFY_CUSTOMER);
    });
});
