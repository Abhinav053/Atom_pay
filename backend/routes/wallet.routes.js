const express=require("express");
const router=express.Router();
const authMiddleware=require("../middlewares/auth.middlewares");
const {getMyWallet,getMyTransactions}=require("../controllers/wallet.controller");
router.get("/", authMiddleware, getMyWallet);
router.get("/me", authMiddleware, getMyWallet);
router.get("/balance", authMiddleware, getMyWallet);
router.get("/transactions", authMiddleware, getMyTransactions);
module.exports=router;