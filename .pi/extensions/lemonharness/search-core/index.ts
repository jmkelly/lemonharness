/**
 * search-core barrel — re-exports all search functions
 */

export type { SearchResult } from "./types";
export { searchWeb } from "./search-web";
export { searchArxiv } from "./search-arxiv";
export { searchSemanticScholar, searchRecent } from "./search-semantic";
export { formatResults } from "./format";
