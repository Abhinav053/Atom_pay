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
    RECONCILIATION_CHECK: "reconciliation.check"
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
    WEBHOOK_RECEIVED: "webhook.received"
};

module.exports = {
    QUEUES,
    EVENT_TYPES
};
