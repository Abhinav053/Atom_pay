/**
 * AtomPay Shared Events and Queue Definitions
 */

const QUEUES = {
    PAYMENT_PROCESS: "payment.process",
    PAYMENT_RETRY: "payment.retry",
    PAYMENT_WEBHOOK: "payment.webhook",
    PAYMENT_SUCCEEDED: "payment.succeeded",
    PAYMENT_FAILED: "payment.failed",
    PAYMENT_REFUND: "payment.refund",
    NOTIFICATION_SEND: "notification.send",
    RECONCILIATION_CHECK: "reconciliation.check",
    RECOVERY_EXECUTE: "recovery.execute"
};

const EVENT_TYPES = {
    PAYMENT_CREATED: "payment.created",
    PAYMENT_PROCESSING: "payment.processing",
    PAYMENT_SUCCEEDED: "payment.succeeded",
    PAYMENT_FAILED: "payment.failed",
    PAYMENT_UNKNOWN: "payment.unknown",
    TRANSFER_SUCCEEDED: "transfer.succeeded",
    TRANSFER_FAILED: "transfer.failed",
    REFUND_INITIATED: "refund.initiated",
    REFUND_COMPLETED: "refund.completed",
    REFUND_FAILED: "refund.failed",
    WEBHOOK_RECEIVED: "webhook.received",
    RECOVERY_REQUESTED: "recovery.requested",
    RECOVERY_DIAGNOSED: "recovery.diagnosed",
    RECOVERY_DECISION: "recovery.decision",
    RECOVERY_EXECUTED: "recovery.executed"
};

module.exports = {
    QUEUES,
    EVENT_TYPES
};
