import type { CohortReport } from '../../types'

export function reportStats(report: CohortReport) {
  const points = report.scores
    .map((entry) => entry.points)
    .sort((a, b) => a - b)
  const count = points.length
  const average = points.reduce((sum, value) => sum + value, 0) / count
  const median =
    (points[Math.floor((count - 1) / 2)] + points[Math.floor(count / 2)]) / 2
  const passRate =
    points.filter((points) => points >= report.total / 2).length / count
  return { count, average, median, passRate }
}

async function createPDF(report: CohortReport) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { count, average, median, passRate } = reportStats(report)
  const width = 595
  const height = 842
  const margin = 50
  const size = 11
  const rowHeight = 22
  const ink = rgb(0.09, 0.19, 0.33)
  const safeText = (value: string) =>
    value.replace(/[^\x20-\x7e\xa0-\xff]/gu, '?')
  let page = pdf.addPage([width, height])
  let y = height - margin

  function line(
    text: string,
    options: {
      size?: number
      heading?: boolean
      x?: number
      maxWidth?: number
    } = {},
  ) {
    const {
      size: lineSize = size,
      heading = false,
      x = margin,
      maxWidth = width - margin - x,
    } = options
    const face = heading ? bold : font
    let value = safeText(text)
    if (face.widthOfTextAtSize(value, lineSize) > maxWidth) {
      while (face.widthOfTextAtSize(value + '...', lineSize) > maxWidth)
        value = value.slice(0, -1)
      value += '...'
    }
    page.drawText(value, { x, y, size: lineSize, font: face, color: ink })
  }

  function heading(continued = false) {
    line(
      continued
        ? 'Cohort examination report (continued)'
        : 'Cohort examination report',
      { size: 21, heading: true },
    )
    y -= 29
    line(report.title, { size: 15, heading: true })
    y -= rowHeight
    line(
      'Generated ' +
        new Date(report.generatedAt)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 16) +
        ' UTC',
    )
    y -= rowHeight
  }

  function tableHeader() {
    line('Candidate', { heading: true })
    line('Score', { x: 435, heading: true })
    y -= rowHeight
  }

  pdf.setTitle('Cohort examination report')
  pdf.setSubject(report.title)
  pdf.setCreationDate(new Date(report.generatedAt))
  heading()
  line(
    'Submissions: ' +
      count +
      ' | Mean: ' +
      average.toFixed(1) +
      ' | Median: ' +
      median.toFixed(1) +
      ' | Pass rate: ' +
      (passRate * 100).toFixed(0) +
      '%',
  )
  y -= 30
  tableHeader()
  for (const entry of report.scores) {
    if (y < margin + rowHeight) {
      page = pdf.addPage([width, height])
      y = height - margin
      heading(true)
      tableHeader()
    }
    line(entry.name, { maxWidth: 365 })
    line(entry.points.toFixed(1) + ' / ' + report.total, { x: 435 })
    y -= rowHeight
  }
  const pages = pdf.getPages()
  pages.forEach((page, index) => {
    page.drawText(index + 1 + ' / ' + pages.length, {
      x: 500,
      y: 30,
      size,
      font,
      color: ink,
    })
  })
  return pdf.save()
}

export async function downloadCohortReport(report: CohortReport) {
  const bytes = await createPDF(report)
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = 'cohort-' + report.id + '.pdf'
  link.click()
  // Allow the browser to begin reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
