/**
 * Deterministic Policy Engine for Recovery Actions
 */

const MAX_RETRY_ATTEMPTS = parseInt(process.env.MAX_RETRY_ATTEMPTS || "3", 10);
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || "0.85");
const MIN_RECOVERY_AMOUNT = parseFloat(process.env.MIN_RECOVERY_AMOUNT || "50.0"); // 50 INR minimum for retry cost

const ACTIONS = {
    RETRY_SCHEDULED: "RETRY_SCHEDULED",
    NOTIFY_CUSTOMER: "NOTIFY_CUSTOMER",
    ESCALATE_HUMAN: "ESCALATE_HUMAN",
    NO_ACTION: "NO_ACTION"
};

function evaluatePolicy(diagnosis, context) {
    const { category, confidence } = diagnosis;
    const { attemptCount, amount, riskHold } = context;

    if (riskHold) {
        return ACTIONS.ESCALATE_HUMAN;
    }

    if (attemptCount >= MAX_RETRY_ATTEMPTS) {
        return ACTIONS.NO_ACTION;
    }

    // Economic floor check: if amount is too small, don't waste retry resources
    if (amount < MIN_RECOVERY_AMOUNT) {
        return ACTIONS.NO_ACTION;
    }

    if (confidence < MIN_CONFIDENCE) {
        return ACTIONS.ESCALATE_HUMAN;
    }

    switch (category) {
        case "INSUFFICIENT_FUNDS":
        case "NETWORK_TIMEOUT":
        case "PROVIDER_ERROR":
            return ACTIONS.RETRY_SCHEDULED;
            
        case "CARD_EXPIRED":
        case "INVALID_PAYMENT_DETAILS":
            return ACTIONS.NOTIFY_CUSTOMER;
            
        case "BANK_DECLINE":
            // For general bank declines, we might retry once or notify
            if (attemptCount < 2) return ACTIONS.RETRY_SCHEDULED;
            return ACTIONS.NOTIFY_CUSTOMER;

        case "RISK_HOLD":
            return ACTIONS.ESCALATE_HUMAN;

        default:
            return ACTIONS.NO_ACTION;
    }
}

module.exports = {
    evaluatePolicy,
    ACTIONS
};
