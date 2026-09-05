const crypto = require("crypto");

class PaymentProvider {
    async createPayment(payment) {
        throw new Error("createPayment not implemented");
    }
    async getPaymentStatus(paymentId) {
        throw new Error("getPaymentStatus not implemented");
    }
    async refundPayment(paymentId, amount) {
        throw new Error("refundPayment not implemented");
    }
}

class MockProvider extends PaymentProvider {
    constructor() {
        super();
        this.name = "MOCK_GATEWAY";
    }

    async createPayment({ paymentId, userId, amount }) {
        // Simulate external provider response
        return {
            provider: this.name,
            providerPaymentId: `mock_${crypto.randomUUID()}`,
            status: "PROCESSING"
        };
    }

    async getPaymentStatus(paymentId) {
        // Mock query to provider API
        return {
            paymentId,
            status: "SUCCESS",
            providerPaymentId: `mock_${paymentId}`
        };
    }

    async refundPayment(paymentId, amount) {
        return {
            refundId: `ref_${crypto.randomUUID()}`,
            status: "REFUNDED"
        };
    }
}

class ProviderA extends MockProvider {
    constructor() {
        super();
        this.name = "ProviderA";
    }
}

class ProviderB extends MockProvider {
    constructor() {
        super();
        this.name = "ProviderB";
    }
}

function getProvider(providerName = "MOCK_GATEWAY") {
    switch (providerName) {
        case "ProviderA":
            return new ProviderA();
        case "ProviderB":
            return new ProviderB();
        default:
            return new MockProvider();
    }
}

module.exports = {
    PaymentProvider,
    MockProvider,
    ProviderA,
    ProviderB,
    getProvider
};
