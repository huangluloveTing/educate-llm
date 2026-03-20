import * as cheerio from "cheerio";
import mammoth from "mammoth";
import fs from "node:fs/promises";
import path from "node:path";

export async function parseDocument(filePath: string, mime: string): Promise<string> {
  if (mime === "application/pdf") {
    return await parsePDF(filePath);
  }
  else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return await parseDOCX(filePath);
  }
  else if (mime === "text/html") {
    return await parseHTML(filePath);
  }
  else if (mime === "text/plain" || mime === "text/markdown") {
    return await parseText(filePath);
  }
  else {
    throw new Error(`Unsupported document type: ${mime}`);
  }
}

async function parsePDF(filePath: string): Promise<string> {
  // pdf-parse v1.x uses default export
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = await fs.readFile(filePath);
  const data = await (pdfParse as any)(buffer);
  return data.text;
}

async function parseDOCX(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parseHTML(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");
  const $ = cheerio.load(content);
  $("script, style").remove();
  return $("body").text().trim() || $.text().trim();
}

async function parseText(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf-8");
}

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html",
    ".htm": "text/html",
    ".txt": "text/plain",
    ".md": "text/markdown",
  };
  return mimeTypes[ext] || "application/octet-stream";
}
