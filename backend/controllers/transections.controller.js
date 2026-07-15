const mongoose = require("mongoose");
const User = require("../db/user");
const Wallet = require("../db/wallet");
const Transaction = require("../db/transections");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { cacheDel } = require("../db/cache");
const { enqueueEmail, enqueueAudit } = require("../queues");

exports.transferMoney = async (req, res) => {
    const senderId = req.user.id;
    const body = req.body;

    const receiverUsername = body.receiverUsername;
    const amount = body.amount;
    const pin = body.pin;

    if (amount < 1) {
        return res.status(400).json({
            msg: "please send a valid amount"
        });
    }

    let session;
    let tx;
    try {
        const sender = await User.findOne({ _id: senderId }).select("+hashedPin username active");

        if (!sender) {
            return res.status(400).json({
                msg: "Invalid sender"
            });
        }

        if (sender.active !== true) {
            return res.status(400).json({
                msg: "You can not send money because you are not active"
            });
        }

        const senderWallet = await Wallet.findOne({ user: senderId });

        if (!senderWallet) {
            return res.status(400).json({
                msg: "Sender wallet does not exist"
            });
        }

        if (senderWallet.status !== "Active") {
            return res.status(400).json({
                msg: "Your wallet is either frozen or closed"
            });
        }

        const receiver = await User.findOne({ username: receiverUsername })
            .select("active username");

        if (!receiver) {
            return res.status(400).json({
                msg: "Invalid receiver"
            });
        }
        if (senderId === receiver._id.toString()) {
            return res.status(400).json({
                msg: "You are sending money to yourself"
            })
        }

        if (receiver.active !== true) {
            return res.status(400).json({
                msg: "You can not send money because receiver is inactive"
            });
        }

        const receiverWallet = await Wallet.findOne({ user: receiver._id });

        if (!receiverWallet) {
            return res.status(400).json({
                msg: "Receiver does not have a wallet"
            });
        }

        if (receiverWallet.status !== "Active") {
            return res.status(400).json({
                msg: "Receiver's wallet is either closed or frozen"
            });
        }

        const isMatch = await bcrypt.compare(pin, sender.hashedPin);
        if (!isMatch) {
            return res.status(400).json({
                msg: "You entered wrong pin"
            })
        }
        if (senderWallet.balance < amount) {
            return res.status(400).json({
                msg: "You don't have sufficient money"
            })
        }
        // aggregation pipeline — uses index on { fromWallet, createdAt, status }
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await Transaction.aggregate([{
            $match: {
                fromWallet: senderWallet._id,
                status: "success",
                createdAt: { $gte: since }
            }
        }, {
            $group: {
                _id: null,
                totalSent: { $sum: "$amount" }
            }
        }
        ])
        const totalSent = result[0]?.totalSent || 0;
        if (totalSent + amount > 100000) {
            console.warn(`[GUARD] ⚠️  Velocity cap — @${sender.username} already sent ${totalSent} in 24h; +${amount} rejected`);
            return res.status(400).json({
                msg: "You cannot send more than ₹1,00,000 in 24 hours"
            })
        }

        session = await mongoose.startSession();
        await session.startTransaction();
        const senderWalletTx = await Wallet.findOne({ user: senderId }).session(session);
        if (!senderWalletTx) {
            await session.abortTransaction();
            return res.status(404).json({ msg: "Sender wallet not found" })
        }
        const receiverWalletTx = await Wallet.findOne({ user: receiver._id }).session(session);
        if (!receiverWalletTx) {
            await session.abortTransaction();
            return res.status(404).json({ msg: "Receiver wallet not found during transaction" })
        }
        if (senderWalletTx.balance < amount) {
            await session.abortTransaction();
            console.warn(`[GUARD] ⚠️  Insufficient balance inside txn — @${sender.username}; rolled back`);
            return res.status(400).json({ msg: "Insufficient balance" });
        }
        tx = new Transaction({
            transactionId: crypto.randomUUID(),
            fromWallet: senderWalletTx._id,
            toWallet: receiverWalletTx._id,
            amount: amount,
            status: "pending",
            note: body.note || undefined,
            senderUsername: sender.username,
            receiverUsername: receiver.username
        })
        await tx.save({ session });
        senderWalletTx.balance -= amount;
        receiverWalletTx.balance += amount;
        await senderWalletTx.save({ session });
        await receiverWalletTx.save({ session });
        tx.status = "success";
        await tx.save({ session });
        await session.commitTransaction();
        console.log(`[OK] ✅ Transfer committed — @${sender.username} → @${receiver.username} ${amount} (txn ${tx.transactionId})`);

        // Invalidate cached balance + history for BOTH parties — only AFTER the
        // 2-phase commit has resolved, so we never serve stale financial data.
        await cacheDel(
            `cache:balance:${senderId}`,
            `cache:balance:${receiver._id}`,
            `cache:txns:${senderId}`,
            `cache:txns:${receiver._id}`
        );

     //   Offload non-critical work to the queues (fire-and-forget, fail-open).
        enqueueEmail({
            type: "transaction",
            userId: senderId,
            amount,
            peerUsername: receiver.username,
            status: "success",
            transactionId: tx.transactionId
        });
        enqueueAudit({
            event: "transfer",
            transactionId: tx.transactionId,
            fromUserId: senderId,
            toUserId: receiver._id.toString(),
            amount,
            status: "success"
        });

        return res.status(200).json({
            msg: "Money sent successfully"
        })
    }
    catch (err) {
        // A concurrent transfer that loses the race to write the same wallet
        // document surfaces as a MongoDB write-conflict / transient txn error.
        const isRace = !!err && (
            (Array.isArray(err.errorLabels) && err.errorLabels.includes("TransientTransactionError")) ||
            err.code === 112 || /writeconflict/i.test(err.message || "")
        );
        if (isRace) {
            console.warn(`[GUARD] 🛡️  Race blocked — concurrent transfer write-conflict for user=${senderId}; atomic rollback, no double-spend`);
        } else {
            console.log(err);
        }
        if (session) {
            try { await session.abortTransaction(); } catch (_) { /* already aborted */ }
        }
        if (tx) {
            try {
                const failedTx = new Transaction({
                    transactionId: tx.transactionId,
                    fromWallet: tx.fromWallet,
                    toWallet: tx.toWallet,
                    amount: tx.amount,
                    status: "failed",
                    failureReason: err.message || "Unknown error",
                    note: tx.note || undefined,
                    senderUsername: tx.senderUsername,
                    receiverUsername: tx.receiverUsername
                });
                await failedTx.save();
            } catch (saveErr) {
                console.log("Failed to save failed transaction record:", saveErr);
            }
        }
        // Audit + notify on failure (off the request path, fail-open)
        enqueueAudit({
            event: "transfer",
            transactionId: tx ? tx.transactionId : undefined,
            fromUserId: senderId,
            amount,
            status: "failed",
            failureReason: err.message
        });
        enqueueEmail({
            type: "transaction",
            userId: senderId,
            amount,
            status: "failed",
            transactionId: tx ? tx.transactionId : undefined
        });

        // FIX: Don't expose internal error messages to clients
        return res.status(500).json({
            msg: "Transaction failed. Please try again."
        });
    } finally {
        if (session) {
            await session.endSession();
        }
    }
};
