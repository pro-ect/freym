/**
 * Centralized Error Handling System
 *
 * Import everything you need from here:
 * import { ErrorCode, AppError, createErrorResponse, withErrorHandling } from '@/lib/errors';
 */

export { ErrorCode, getHttpStatus, getErrorMessage, isClientError, isServerError } from './errorCodes';
export {
  AppError,
  createErrorResponse,
  createSuccessResponse,
  createErrorHttpResponse,
  createSuccessHttpResponse,
  withErrorHandling,
  isErrorResponse,
  getErrorFromResponse,
  getDataFromResponse,
  type ErrorResponse,
  type SuccessResponse,
  type ApiResponse,
} from './errorResponse';
