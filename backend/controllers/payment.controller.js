const { initiateTopup } = require("../services/payment.service");

exports.topupWallet = async (req, res, next) => {
    try {
        const result = await initiateTopup({
            userId: req.user.id,
            amount: req.body.amount
        });
        return res.status(202).json(result);
    } catch (err) {
        return next(err);
    }
};
