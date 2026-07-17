const {
    verifyPaymentSignature,
    processPaymentWebhook
} = require("../services/webhook.service");

exports.handlePaymentWebhook = async (req, res, next) => {
    try {
        const signature = req.headers["x-payment-signature"];
        if (!verifyPaymentSignature(req.body, signature)) {
            return res.status(401).json({ msg: "Invalid payment webhook signature" });
        }

        const result = await processPaymentWebhook(req.body);
        return res.status(200).json(result);
    } catch (err) {
        return next(err);
    }
};
