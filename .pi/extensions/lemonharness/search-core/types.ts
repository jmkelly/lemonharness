/**
 * Search result type for LemonHarness search backends
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "web" | "arxiv" | "semantic-scholar" | "error";
  authors?: string[];
  published?: string;
  year?: number;
  venue?: string;
  citationCount?: number;
  arxivId?: string;
  paperId?: string;
  categories?: string[];
}
