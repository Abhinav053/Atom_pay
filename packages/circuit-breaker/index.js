const CircuitBreaker = require("opossum");

const defaultOptions = {
    timeout: 6000, // 6 seconds timeout
    errorThresholdPercentage: 50, // open circuit if >= 50% fail
    resetTimeout: 15000, // move to HALF_OPEN after 15 sec
    volumeThreshold: 3 // stats window minimum requests
};

function createCircuitBreaker(fn, options = {}) {
    const breaker = new CircuitBreaker(fn, { ...defaultOptions, ...options });

    breaker.on("open", () => {
        console.error("[Circuit Breaker] OPEN - External provider calls paused");
    });

    breaker.on("halfOpen", () => {
        console.warn("[Circuit Breaker] HALF_OPEN - Testing provider availability");
    });

    breaker.on("close", () => {
        console.log("[Circuit Breaker] CLOSED - Provider healthy");
    });

    breaker.on("reject", () => {
        console.error("[Circuit Breaker] REJECTED - Fast failure due to OPEN circuit");
    });

    return breaker;
}

module.exports = { createCircuitBreaker };
