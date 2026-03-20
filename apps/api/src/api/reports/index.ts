import express from "express";
import path from "path";
import fs from "fs/promises";
import PDFDocument from "pdfkit";
import { marked } from "marked";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { requireAuth, requireRole } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../env.js";
import { sseInit, sseSend } from "../../utils/sse.js";
import { createChatModel } from "../../llm/chatModel.js";
import { embedQuery } from "../../services/embeddings.js";
import { getQdrantClient, getCollectionName } from "../../services/qdrant.js";

const router = express.Router();

type ReportReqBody = {
  kbId: string;
  topic: string;
  gradeLevel?: string;
  subject?: string;
  researchDuration?: string;
  researchQuestions?: string;
};

// Fixed outline for MVP
const FIXED_OUTLINE = [
  { order: 1, title: "Research Background and Significance" },
  { order: 2, title: "Literature Review" },
  { order: 3, title: "Research Methods" },
  { order: 4, title: "Findings and Analysis" },
  { order: 5, title: "Conclusions and Recommendations" },
];

router.post("/reports/stream", requireAuth, requireRole(["ADMIN", "TEACHER"]), async (req, res) => {
  sseInit(res);

  try {
    const body = req.body as ReportReqBody;
    if (!body || typeof body.kbId !== "string" || typeof body.topic !== "string" || !body.topic.trim()) {
      sseSend(res, { event: "error", data: { message: "Invalid parameters" } });
      return res.end();
    }

    if (!env.LLM_API_KEY) {
      sseSend(res, { event: "error", data: { message: "LLM_API_KEY not configured" } });
      return res.end();
    }

    // Verify knowledge base exists
    const kb = await prisma.knowledgeBase.findUnique({
      where: { id: body.kbId },
    });

    if (!kb) {
      sseSend(res, { event: "error", data: { message: "Knowledge base not found" } });
      return res.end();
    }

    // Create report job
    const job = await prisma.reportJob.create({
      data: {
        kbId: body.kbId,
        topic: body.topic,
        status: "RUNNING",
        createdById: req.user!.id,
      },
    });

    const qdrant = getQdrantClient();
    const collectionName = getCollectionName(body.kbId);
    const llm = createChatModel();

    const allSections: Array<{ title: string; order: number; markdown: string }> = [];

    // Generate each section
    for (const outline of FIXED_OUTLINE) {
      try {
        // Retrieve context for this section
        const sectionQuery = `${body.topic} ${outline.title}`;
        const queryVector = await embedQuery(sectionQuery);

        const hits = await qdrant.search(collectionName, {
          vector: queryVector,
          limit: 5,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [{
              key: "kbId",
              match: { value: body.kbId },
            }],
          },
        });

        const contextText = hits
          .map((h, i) => {
            const text = (h.payload as any)?.text as string;
            const filename = (h.payload as any)?.filename as string;
            return `[Source ${i + 1}] ${filename}\n${text}`;
          })
          .join("\n\n");

        // Generate section content
        const systemPrompt = `You are an education research report writer. Generate a section for a research report.

Topic: ${body.topic}
Section: ${outline.title}
${body.gradeLevel ? `Grade Level: ${body.gradeLevel}` : ""}
${body.subject ? `Subject: ${body.subject}` : ""}

Use the following materials as reference. If materials are insufficient, use your general knowledge but note the limitation.

Materials:
${contextText}

Generate the section content in markdown format. Include:
- Clear structure with subsections if appropriate
- Cite sources when using them: (Source 1), (Source 2)
- Be scholarly and evidence-based
- Aim for 300-500 words`;

        const messages = [
          new SystemMessage(systemPrompt),
          new HumanMessage(`Generate the section: ${outline.title}`),
        ];

        let sectionMarkdown = "";
        for await (const chunk of await llm.stream(messages)) {
          const content = (chunk as any)?.content;
          if (typeof content === "string" && content.length > 0) {
            sectionMarkdown += content;
          }
        }

        // Save section to database
        await prisma.reportSection.create({
          data: {
            jobId: job.id,
            title: outline.title,
            order: outline.order,
            markdown: sectionMarkdown,
          },
        });

        allSections.push({
          title: outline.title,
          order: outline.order,
          markdown: sectionMarkdown,
        });

        // Send section to client
        sseSend(res, {
          event: "section",
          data: {
            title: outline.title,
            order: outline.order,
            markdown: sectionMarkdown,
          },
        });
      }
      catch (error) {
        console.error(`Failed to generate section ${outline.title}:`, error);
        // Continue with next section
      }
    }

    // Generate PDF
    const reportsDir = path.resolve(env.STORAGE_DIR, "reports");
    await fs.mkdir(reportsDir, { recursive: true });
    const pdfPath = path.join(reportsDir, `${job.id}.pdf`);

    await generatePDF(body.topic, allSections, pdfPath);

    // Update job status
    await prisma.reportJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        outputPdfPath: pdfPath,
      },
    });

    // Send completion
    sseSend(res, {
      event: "done",
      data: {
        reportId: job.id,
        downloadUrl: `/api/v1/reports/${job.id}/download`,
      },
    });
    res.end();
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : "Report generation failed";
    sseSend(res, { event: "error", data: { message: msg } });
    res.end();
  }
});

async function generatePDF(
  topic: string,
  sections: Array<{ title: string; order: number; markdown: string }>,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const stream = require("fs").createWriteStream(outputPath);

      doc.pipe(stream);

      // Use custom font if provided
      if (env.PDF_FONT_PATH) {
        try {
          doc.registerFont("CustomFont", env.PDF_FONT_PATH);
          doc.font("CustomFont");
        }
        catch (error) {
          console.warn("Failed to load custom font, using default:", error);
          doc.font("Helvetica");
        }
      }
      else {
        doc.font("Helvetica");
      }

      // Title
      doc.fontSize(20).text(topic, { align: "center" });
      doc.moveDown(2);

      // Sections
      for (const section of sections.sort((a, b) => a.order - b.order)) {
        doc.fontSize(16).text(section.title);
        doc.moveDown(0.5);

        // Convert markdown to plain text (strip HTML tags)
        const html = marked.parse(section.markdown) as string;
        const plainText = html
          .replace(/<[^>]*>/g, " ") // Remove HTML tags
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ") // Normalize whitespace
          .trim();

        doc.fontSize(11).text(plainText, { align: "left" });
        doc.moveDown(1.5);
      }

      doc.end();

      stream.on("finish", () => resolve());
      stream.on("error", (error: Error) => reject(error));
    }
    catch (error) {
      reject(error);
    }
  });
}

router.get("/reports/:id", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const report = await prisma.reportJob.findUnique({
      where: { id },
      include: {
        kb: {
          select: {
            id: true,
            name: true,
          },
        },
        sections: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            order: true,
            markdown: true,
          },
        },
      },
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.json(report);
  }
  catch (error) {
    console.error("Get report error:", error);
    res.status(500).json({ message: "Failed to fetch report" });
  }
});

router.get("/reports/:id/download", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const report = await prisma.reportJob.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        outputPdfPath: true,
        topic: true,
      },
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.status !== "SUCCEEDED" || !report.outputPdfPath) {
      return res.status(400).json({ message: "Report is not ready for download" });
    }

    // Check if file exists
    try {
      await fs.access(report.outputPdfPath);
    }
    catch {
      return res.status(404).json({ message: "PDF file not found" });
    }

    // Set headers for download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(report.topic)}.pdf"`);

    // Stream file
    const fileStream = require("fs").createReadStream(report.outputPdfPath);
    fileStream.pipe(res);
  }
  catch (error) {
    console.error("Download report error:", error);
    res.status(500).json({ message: "Failed to download report" });
  }
});

export default router;
