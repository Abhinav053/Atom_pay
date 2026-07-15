const zod=require("zod");
exports.transferSchema=zod.object({
    receiverUsername : zod.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
    amount : zod.number().min(1).max(100000),
    pin : zod.string().regex(/^\d{6}$/),
    note : zod.string().max(100).optional()
})