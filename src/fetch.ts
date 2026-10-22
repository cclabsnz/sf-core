// The ./fetch entry point: fetch-based clients with no @salesforce/core or jsforce anywhere in the graph.
export * from './api/fetch/index.js';
export { isApiError, SalesforceApiError } from './api/ApiError.js';
export type { ApiError } from './api/ApiError.js';
export type { QueryResult, SoqlClient } from './api/SoqlClient.js';
export type { ToolingClient } from './api/ToolingClient.js';
export type { RestClient } from './api/RestClient.js';
