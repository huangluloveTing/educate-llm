import express from "express";

import auth from "./auth/index.js";
import health from "./health/index.js";
import kb from "./kb/index.js";
import documents from "./documents/index.js";

const router = express.Router();

router.use(health);
router.use("/auth", auth);
router.use(kb);
router.use(documents);

export default router;
