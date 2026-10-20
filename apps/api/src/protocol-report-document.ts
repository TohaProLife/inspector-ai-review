/** Presentation-only projection of an immutable protocol snapshot. */
export interface ProtocolReportDocument {
  templateVersion: string;
  protocolId: string;
  createdAt: string;
  snapshotHash: string;
  status: string;
  title: string;
  metadata: Array<{ label: string; value: string }>;
  notices: string[];
  sections: Array<{
    id: string;
    title: string;
    paragraphs?: string[];
    tables?: Array<{ columns: string[]; rows: string[][] }>;
  }>;
  snapshotJson: string;
}

export type ProtocolReportFormat = "pdf" | "docx" | "xml";
