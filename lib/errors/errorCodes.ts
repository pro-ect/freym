/**
 * Centralized Error Codes
 *
 * Standard error codes used across the application.
 * Format: CATEGORY_SPECIFIC_ERROR
 */

export enum ErrorCode {
  // Authentication & Authorization (AUTH_*)
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_INSUFFICIENT_PERMISSIONS',

  // Validation (VALIDATION_*)
  VALIDATION_INVALID_INPUT = 'VALIDATION_INVALID_INPUT',
  VALIDATION_MISSING_REQUIRED_FIELD = 'VALIDATION_MISSING_REQUIRED_FIELD',
  VALIDATION_INVALID_MODEL_ID = 'VALIDATION_INVALID_MODEL_ID',
  VALIDATION_INVALID_PARAMETERS = 'VALIDATION_INVALID_PARAMETERS',
  VALIDATION_INVALID_IMAGE_FORMAT = 'VALIDATION_INVALID_IMAGE_FORMAT',
  VALIDATION_IMAGE_TOO_LARGE = 'VALIDATION_IMAGE_TOO_LARGE',

  // Coins & Payment (COINS_*)
  COINS_INSUFFICIENT_BALANCE = 'COINS_INSUFFICIENT_BALANCE',
  COINS_INVALID_AMOUNT = 'COINS_INVALID_AMOUNT',
  COINS_RESERVATION_FAILED = 'COINS_RESERVATION_FAILED',
  COINS_DEDUCTION_FAILED = 'COINS_DEDUCTION_FAILED',
  COINS_REFUND_FAILED = 'COINS_REFUND_FAILED',

  // Model Configuration (MODEL_*)
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  MODEL_NOT_ACTIVE = 'MODEL_NOT_ACTIVE',
  MODEL_PRICING_NOT_FOUND = 'MODEL_PRICING_NOT_FOUND',
  MODEL_CONFIG_NOT_FOUND = 'MODEL_CONFIG_NOT_FOUND',
  MODEL_REQUIRES_REFERENCE_IMAGES = 'MODEL_REQUIRES_REFERENCE_IMAGES',
  MODEL_INVALID_REFERENCE_COUNT = 'MODEL_INVALID_REFERENCE_COUNT',

  // Generation (GEN_*)
  GEN_QUEUE_ENTRY_NOT_FOUND = 'GEN_QUEUE_ENTRY_NOT_FOUND',
  GEN_FAILED = 'GEN_FAILED',
  GEN_TIMEOUT = 'GEN_TIMEOUT',
  GEN_CANCELLED = 'GEN_CANCELLED',
  GEN_INVALID_OUTPUT = 'GEN_INVALID_OUTPUT',

  // External API (API_*)
  API_REPLICATE_ERROR = 'API_REPLICATE_ERROR',
  API_REPLICATE_TIMEOUT = 'API_REPLICATE_TIMEOUT',
  API_REPLICATE_RATE_LIMIT = 'API_REPLICATE_RATE_LIMIT',
  API_REPLICATE_INVALID_KEY = 'API_REPLICATE_INVALID_KEY',
  API_BYTEPLUS_ERROR = 'API_BYTEPLUS_ERROR',
  API_EXTERNAL_SERVICE_ERROR = 'API_EXTERNAL_SERVICE_ERROR',

  // Database (DB_*)
  DB_QUERY_FAILED = 'DB_QUERY_FAILED',
  DB_NOT_FOUND = 'DB_NOT_FOUND',
  DB_DUPLICATE_ENTRY = 'DB_DUPLICATE_ENTRY',
  DB_CONSTRAINT_VIOLATION = 'DB_CONSTRAINT_VIOLATION',
  DB_CONNECTION_ERROR = 'DB_CONNECTION_ERROR',

  // Storage (STORAGE_*)
  STORAGE_UPLOAD_FAILED = 'STORAGE_UPLOAD_FAILED',
  STORAGE_DOWNLOAD_FAILED = 'STORAGE_DOWNLOAD_FAILED',
  STORAGE_FILE_NOT_FOUND = 'STORAGE_FILE_NOT_FOUND',
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',

  // Internal Server (INTERNAL_*)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  INTERNAL_UNEXPECTED_ERROR = 'INTERNAL_UNEXPECTED_ERROR',
  INTERNAL_NOT_IMPLEMENTED = 'INTERNAL_NOT_IMPLEMENTED',

  // Rate Limiting (RATE_*)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

/**
 * HTTP status codes for each error category
 */
export const ERROR_HTTP_STATUS: Record<string, number> = {
  // 400 Bad Request
  VALIDATION_INVALID_INPUT: 400,
  VALIDATION_MISSING_REQUIRED_FIELD: 400,
  VALIDATION_INVALID_MODEL_ID: 400,
  VALIDATION_INVALID_PARAMETERS: 400,
  VALIDATION_INVALID_IMAGE_FORMAT: 400,
  VALIDATION_IMAGE_TOO_LARGE: 400,
  MODEL_REQUIRES_REFERENCE_IMAGES: 400,
  MODEL_INVALID_REFERENCE_COUNT: 400,
  COINS_INVALID_AMOUNT: 400,
  DB_DUPLICATE_ENTRY: 400,
  DB_CONSTRAINT_VIOLATION: 400,

  // 401 Unauthorized
  AUTH_UNAUTHORIZED: 401,
  AUTH_INVALID_TOKEN: 401,
  AUTH_TOKEN_EXPIRED: 401,
  API_REPLICATE_INVALID_KEY: 401,

  // 402 Payment Required
  COINS_INSUFFICIENT_BALANCE: 402,

  // 403 Forbidden
  AUTH_INSUFFICIENT_PERMISSIONS: 403,

  // 404 Not Found
  MODEL_NOT_FOUND: 404,
  MODEL_PRICING_NOT_FOUND: 404,
  MODEL_CONFIG_NOT_FOUND: 404,
  GEN_QUEUE_ENTRY_NOT_FOUND: 404,
  DB_NOT_FOUND: 404,
  STORAGE_FILE_NOT_FOUND: 404,

  // 409 Conflict
  MODEL_NOT_ACTIVE: 409,
  GEN_CANCELLED: 409,

  // 422 Unprocessable Entity
  GEN_INVALID_OUTPUT: 422,

  // 429 Too Many Requests
  RATE_LIMIT_EXCEEDED: 429,
  API_REPLICATE_RATE_LIMIT: 429,

  // 500 Internal Server Error
  INTERNAL_SERVER_ERROR: 500,
  INTERNAL_UNEXPECTED_ERROR: 500,
  COINS_RESERVATION_FAILED: 500,
  COINS_DEDUCTION_FAILED: 500,
  COINS_REFUND_FAILED: 500,
  GEN_FAILED: 500,
  DB_QUERY_FAILED: 500,
  DB_CONNECTION_ERROR: 500,
  STORAGE_UPLOAD_FAILED: 500,
  STORAGE_DOWNLOAD_FAILED: 500,
  STORAGE_QUOTA_EXCEEDED: 500,

  // 501 Not Implemented
  INTERNAL_NOT_IMPLEMENTED: 501,

  // 502 Bad Gateway
  API_REPLICATE_ERROR: 502,
  API_BYTEPLUS_ERROR: 502,
  API_EXTERNAL_SERVICE_ERROR: 502,

  // 504 Gateway Timeout
  GEN_TIMEOUT: 504,
  API_REPLICATE_TIMEOUT: 504,
};

/**
 * User-friendly error messages
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // Auth
  [ErrorCode.AUTH_UNAUTHORIZED]: 'Authentication required',
  [ErrorCode.AUTH_INVALID_TOKEN]: 'Invalid authentication token',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: 'Authentication token expired',
  [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions',

  // Validation
  [ErrorCode.VALIDATION_INVALID_INPUT]: 'Invalid input provided',
  [ErrorCode.VALIDATION_MISSING_REQUIRED_FIELD]: 'Missing required field',
  [ErrorCode.VALIDATION_INVALID_MODEL_ID]: 'Invalid model ID',
  [ErrorCode.VALIDATION_INVALID_PARAMETERS]: 'Invalid generation parameters',
  [ErrorCode.VALIDATION_INVALID_IMAGE_FORMAT]: 'Invalid image format',
  [ErrorCode.VALIDATION_IMAGE_TOO_LARGE]: 'Image file too large',

  // Coins
  [ErrorCode.COINS_INSUFFICIENT_BALANCE]: 'Insufficient coin balance',
  [ErrorCode.COINS_INVALID_AMOUNT]: 'Invalid coin amount',
  [ErrorCode.COINS_RESERVATION_FAILED]: 'Failed to reserve coins',
  [ErrorCode.COINS_DEDUCTION_FAILED]: 'Failed to deduct coins',
  [ErrorCode.COINS_REFUND_FAILED]: 'Failed to refund coins',

  // Model
  [ErrorCode.MODEL_NOT_FOUND]: 'Model not found',
  [ErrorCode.MODEL_NOT_ACTIVE]: 'Model is not currently active',
  [ErrorCode.MODEL_PRICING_NOT_FOUND]: 'Pricing not found for model',
  [ErrorCode.MODEL_CONFIG_NOT_FOUND]: 'Configuration not found for model',
  [ErrorCode.MODEL_REQUIRES_REFERENCE_IMAGES]: 'This model requires reference images',
  [ErrorCode.MODEL_INVALID_REFERENCE_COUNT]: 'Invalid number of reference images',

  // Generation
  [ErrorCode.GEN_QUEUE_ENTRY_NOT_FOUND]: 'Generation not found',
  [ErrorCode.GEN_FAILED]: 'Generation failed',
  [ErrorCode.GEN_TIMEOUT]: 'Generation timed out',
  [ErrorCode.GEN_CANCELLED]: 'Generation was cancelled',
  [ErrorCode.GEN_INVALID_OUTPUT]: 'Invalid generation output',

  // External API
  [ErrorCode.API_REPLICATE_ERROR]: 'Replicate API error',
  [ErrorCode.API_REPLICATE_TIMEOUT]: 'Replicate API timeout',
  [ErrorCode.API_REPLICATE_RATE_LIMIT]: 'Replicate API rate limit exceeded',
  [ErrorCode.API_REPLICATE_INVALID_KEY]: 'Invalid Replicate API key',
  [ErrorCode.API_BYTEPLUS_ERROR]: 'BytePlus API error',
  [ErrorCode.API_EXTERNAL_SERVICE_ERROR]: 'External service error',

  // Database
  [ErrorCode.DB_QUERY_FAILED]: 'Database query failed',
  [ErrorCode.DB_NOT_FOUND]: 'Resource not found in database',
  [ErrorCode.DB_DUPLICATE_ENTRY]: 'Duplicate entry',
  [ErrorCode.DB_CONSTRAINT_VIOLATION]: 'Database constraint violation',
  [ErrorCode.DB_CONNECTION_ERROR]: 'Database connection error',

  // Storage
  [ErrorCode.STORAGE_UPLOAD_FAILED]: 'File upload failed',
  [ErrorCode.STORAGE_DOWNLOAD_FAILED]: 'File download failed',
  [ErrorCode.STORAGE_FILE_NOT_FOUND]: 'File not found in storage',
  [ErrorCode.STORAGE_QUOTA_EXCEEDED]: 'Storage quota exceeded',

  // Internal
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [ErrorCode.INTERNAL_UNEXPECTED_ERROR]: 'Unexpected error occurred',
  [ErrorCode.INTERNAL_NOT_IMPLEMENTED]: 'Feature not implemented',

  // Rate Limiting
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded',
};

/**
 * Get HTTP status code for an error code
 */
export function getHttpStatus(errorCode: ErrorCode): number {
  return ERROR_HTTP_STATUS[errorCode] || 500;
}

/**
 * Get user-friendly message for an error code
 */
export function getErrorMessage(errorCode: ErrorCode): string {
  return ERROR_MESSAGES[errorCode] || 'An error occurred';
}

/**
 * Check if error code is a client error (4xx)
 */
export function isClientError(errorCode: ErrorCode): boolean {
  const status = getHttpStatus(errorCode);
  return status >= 400 && status < 500;
}

/**
 * Check if error code is a server error (5xx)
 */
export function isServerError(errorCode: ErrorCode): boolean {
  const status = getHttpStatus(errorCode);
  return status >= 500;
}
