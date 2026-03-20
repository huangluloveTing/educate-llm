import { streamText } from "ai";
import express from "express";
import { marked } from "marked";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";

import { requireAuth, requireRole } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../env.js";
import { createAiSdkModel } from "../../llm/ai-sdk-model.js";
import { embedQuery } from "../../services/embeddings.js";
import { getCollectionName, getQdrantClient } from "../../services/qdrant.js";

const router = express.Router();

type ReportReqBody = {
  kbId: string;
  topic: string;
  gradeLevel?: string;
  subject?: string;
  researchDuration?: string;
  researchQuestions?: string;
};

// Fixed outline for Chinese education research report
const FIXED_OUTLINE = [
  { order: 1, title: "研究背景与意义" },
  { order: 2, title: "文献综述" },
  { order: 3, title: "研究方法" },
  { order: 4, title: "研究过程与实施" },
  { order: 5, title: "研究结果与分析" },
  { order: 6, title: "研究结论与建议" },
  { order: 7, title: "研究反思与展望" },
];

router.post("/reports/stream", requireAuth, requireRole(["ADMIN", "TEACHER"]), async (req, res) => {
  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write(":ok\n\n");

  try {
    const body = req.body as ReportReqBody;
    if (!body || typeof body.kbId !== "string" || typeof body.topic !== "string" || !body.topic.trim()) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: "参数无效" })}\n\n`);
      return res.end();
    }

    if (!env.LLM_API_KEY) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: "LLM_API_KEY 未配置" })}\n\n`);
      return res.end();
    }

    // Verify knowledge base exists
    const kb = await prisma.knowledgeBase.findUnique({
      where: { id: body.kbId },
    });

    if (!kb) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: "知识库不存在" })}\n\n`);
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
    const model = createAiSdkModel();

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
            return `[资料${i + 1}] ${filename}\n${text}`;
          })
          .join("\n\n");

        // Generate section content
        const systemPrompt = `你是一位教育研究报告撰写专家。请为教育研究报告生成指定章节。

课题：${body.topic}
章节：${outline.title}
${body.gradeLevel ? `学段：${body.gradeLevel}` : ""}
${body.subject ? `学科：${body.subject}` : ""}

请基于以下参考资料撰写内容。如果资料不足，可结合教育学常识，但需注明资料有限。

参考资料：
${contextText}

要求：
- 使用 Markdown 格式生成章节内容
- 结构清晰，必要时使用小标题
- 引用资料时标注：(资料1)、(资料2)
- 学术性、证据支撑
- 字数控制在 300-500 字左右`;

        const messages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: `请撰写章节：${outline.title}` },
        ];

        const result = streamText({
          model,
          messages,
          temperature: 0.2,
        });

        let sectionMarkdown = "";
        for await (const chunk of result.textStream) {
          sectionMarkdown += chunk;
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
        const sectionJson = JSON.stringify({
          title: outline.title,
          order: outline.order,
          markdown: sectionMarkdown,
        });
        res.write(`event: section\ndata: ${sectionJson}\n\n`);
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
    const doneJson = JSON.stringify({
      reportId: job.id,
      downloadUrl: `/api/v1/reports/${job.id}/download`,
    });
    res.write(`event: done\ndata: ${doneJson}\n\n`);
    res.end();
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : "报告生成失败";
    res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
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
      const stream = createWriteStream(outputPath);

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
          .replace(/&quot;/g, "\"")
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
    const fileStream = createReadStream(report.outputPdfPath);
    fileStream.pipe(res);
  }
  catch (error) {
    console.error("Download report error:", error);
    res.status(500).json({ message: "Failed to download report" });
  }
});

export default router;
