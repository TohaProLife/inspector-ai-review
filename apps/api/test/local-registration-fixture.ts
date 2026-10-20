/** Synthetic blank document with a visible axis rectangle, never a real anchor match. */
export function localRegistrationPdf(label = "synthetic", rotate = 0): Buffer {
  const stream = "0.5 w 40 40 m 160 40 l 160 120 l 40 120 l h S 100 40 m 100 120 l S 40 80 m 160 80 l S\n";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 160] /CropBox [20 10 180 150] /Rotate ${rotate} /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let content = `%PDF-1.4\n% ${label}\n`; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
