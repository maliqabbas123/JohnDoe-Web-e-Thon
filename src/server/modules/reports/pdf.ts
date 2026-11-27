import "server-only";
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

type ReportContent = {
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  attemptId: string;
  score: number;
  maxScore: number;
  issuedAt: Date;
  verificationUrl: string;
};

function printable(font: PDFFont, value: string, fallback: string) {
  const line = value.replace(/\s+/g, " ").trim();
  try {
    font.encodeText(line);
    return line;
  } catch {
    // Standard PDF fonts have limited coverage. Preserve the exact title
    // and name in metadata, and always print their stable references.
    return fallback;
  }
}

export async function buildReportPdf(report: ReportContent) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(report.examTitle);
  pdf.setAuthor(report.candidateName);
  pdf.setCreationDate(report.issuedAt);
  pdf.setModificationDate(report.issuedAt);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const ink = rgb(0.1, 0.15, 0.22);
  page.drawText("Examination Result", { x: 50, y: 763, size: 25, font: bold, color: ink });
  page.drawText(printable(font, report.examTitle, `Exam reference: ${report.examId}`), {
    x: 50, y: 713, size: 16, font, lineHeight: 20, maxWidth: 495, color: ink,
  });
  page.drawText(printable(font, report.candidateName, `Candidate ${report.candidateId}`), {
    x: 50, y: 630, size: 13, font, lineHeight: 18, maxWidth: 495, color: ink,
  });
  const details = [
    `Score: ${report.score.toFixed(2)} / ${report.maxScore.toFixed(2)}`,
    `Issued: ${report.issuedAt.toISOString()}`,
    `Attempt: ${report.attemptId}`,
    `Candidate ID: ${report.candidateId}`,
  ];
  for (const [index, text] of details.entries()) {
    page.drawText(text, { x: 50, y: 575 - index * 25, size: 12, font, color: ink });
  }
  const qr = await pdf.embedPng(await QRCode.toBuffer(report.verificationUrl, { errorCorrectionLevel: "M", width: 256 }));
  page.drawImage(qr, { x: 50, y: 248, width: 165, height: 165 });
  page.drawText("Scan to verify this report", { x: 50, y: 228, size: 12, font: bold, color: ink });
  page.drawText(report.verificationUrl, { x: 50, y: 200, size: 9, font, maxWidth: 495, lineHeight: 13, color: ink });
  return pdf.save();
}
