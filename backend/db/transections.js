const mongoose=require("mongoose");
const transactionSchema=new mongoose.Schema({
    transactionId:{
        type:String,
        required:true,
        unique:true
    },
    fromWallet:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Wallet",
        required:true
    },
    toWallet:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"Wallet",
        required:true
    },
    amount:{
        type:Number,
        required:true,
        min:1,
        max:100000
    },
    status:{
        type:String,
        enum:["success","failed","pending"],
        required:true,
        default:"pending"
    },
    failureReason:{
        type:String
    },
    note:{
        type:String
    },
    senderUsername:{
        type:String,
        required:true
    },
    receiverUsername:{
        type:String,
        required:true
    }
},{timestamps:true
})

// FIX: Add compound index for the daily spending aggregation pipeline
// This index makes the $match stage efficient: { fromWallet, status, createdAt }
transactionSchema.index({ fromWallet: 1, status: 1, createdAt: -1 });

// FIX: Add index for wallet transaction lookups (used by getMyTransactions)
transactionSchema.index({ toWallet: 1, createdAt: -1 });

const Transaction=mongoose.model('Transaction',transactionSchema);
module.exports =Transaction;