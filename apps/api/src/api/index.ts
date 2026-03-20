import express from "express";

import auth from "./auth/index.js";
import chat from "./chat/index.js";
import documents from "./documents/index.js";
import health from "./health/index.js";
import kb from "./kb/index.js";
import reports from "./reports/index.js";

const router = express.Router();

router.use(health);
router.use("/auth", auth);
router.use(kb);
router.use(documents);
router.use(chat);
router.use(reports);

export default router;
