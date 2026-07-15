const SibApiV3Sdk = require("sib-api-v3-sdk");

const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const sender = { email: "abhinavranjan1011@gmail.com", name: "AtomPay" };

const sendOTPEmail = async (email, otp) => {
    console.log("inside otp email")
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  await apiInstance.sendTransacEmail({
    sender,
    to: [{ email }],
    subject: "Your AtomPay OTP ⚡",
    htmlContent: `
      <div style="font-family:sans-serif;max-width:400px;margin:auto">
        <h2 style="color:#FF6B2C">⚡ AtomPay</h2>
        <p>Your verification OTP:</p>
        <h1 style="color:#FF6B2C;letter-spacing:8px">${otp}</h1>
        <p>This OTP expires in <strong>2 minutes</strong>. Do not share it with anyone.</p>
      </div>
    `
  });
};

// Sent asynchronously by the notification worker after a transfer resolves.
const sendTransactionEmail = async (email, data) => {
  const amount = `₹${Number(data.amount || 0).toLocaleString("en-IN")}`;
  const ok = data.status === "success";
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  await apiInstance.sendTransacEmail({
    sender,
    to: [{ email }],
    subject: ok ? `You sent ${amount} on AtomPay ⚡` : `Your AtomPay transfer failed`,
    htmlContent: `
      <div style="font-family:sans-serif;max-width:420px;margin:auto">
        <h2 style="color:#FF6B2C">⚡ AtomPay</h2>
        <p>${ok
          ? `You successfully sent <strong>${amount}</strong>${data.peerUsername ? ` to <strong>@${data.peerUsername}</strong>` : ""}.`
          : `Your transfer of <strong>${amount}</strong>${data.peerUsername ? ` to <strong>@${data.peerUsername}</strong>` : ""} could not be completed.`}</p>
        ${data.transactionId ? `<p style="color:#888;font-size:12px">Txn ID: ${data.transactionId}</p>` : ""}
      </div>
    `
  });
};

module.exports = { sendOTPEmail, sendTransactionEmail };