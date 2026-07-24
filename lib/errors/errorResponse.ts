/**
 * Standardized Error Response
 *
 * All edge functions and error handlers should return errors in this format.
 */

import { ErrorCode, getHttpStatus, getErrorMessage } from './errorCodes';

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: string;
    field?: string; // For validation errors
    metadata?: Record<string, any>;
  };
  timestamp: string;
  requestId?: string;
}

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  timestamp?: string;
  requestId?: string;
}

export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  errorCode: ErrorCode,
  details?: string,
  field?: string,
  metadata?: Record<string, any>,
  requestId?: string
): ErrorResponse {
  return {
    success: false,
    error: {
      code: errorCode,
      message: getErrorMessage(errorCode),
      details,
      field,
      metadata,
    },
    timestamp: new Date().toISOString(),
    requestId,
  };
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse<T>(
  data: T,
  requestId?: string
): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    requestId,
  };
}

/**
 * Create an HTTP Response for an error
 */
export function createErrorHttpResponse(
  errorCode: ErrorCode,
  details?: string,
  field?: string,
  metadata?: Record<string, any>,
  requestId?: string
): Response {
  const status = getHttpStatus(errorCode);
  const errorResponse = createErrorResponse(errorCode, details, field, metadata, requestId);

  return new Response(
    JSON.stringify(errorResponse),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Create an HTTP Response for success
 */
export function createSuccessHttpResponse<T>(
  data: T,
  requestId?: string,
  status: number = 200
): Response {
  const successResponse = createSuccessResponse(data, requestId);

  return new Response(
    JSON.stringify(successResponse),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Application Error Class
 * Throw this in edge functions for automatic error handling
 */
export class AppError extends Error {
  constructor(
    public errorCode: ErrorCode,
    public details?: string,
    public field?: string,
    public metadata?: Record<string, any>
  ) {
    super(getErrorMessage(errorCode));
    this.name = 'AppError';
  }

  toResponse(requestId?: string): Response {
    return createErrorHttpResponse(
      this.errorCode,
      this.details,
      this.field,
      this.metadata,
      requestId
    );
  }

  toJSON(): ErrorResponse {
    return createErrorResponse(
      this.errorCode,
      this.details,
      this.field,
      this.metadata
    );
  }
}

/**
 * Helper function to wrap edge function handlers with error handling
 */
export function withErrorHandling<T>(
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      // Generate request ID if not present
      const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

      // Handle AppError
      if (error instanceof AppError) {
        console.error(`[${requestId}] AppError:`, error.errorCode, error.details);
        return error.toResponse(requestId);
      }

      // Handle unknown errors
      console.error(`[${requestId}] Unexpected error:`, error);

      return createErrorHttpResponse(
        ErrorCode.INTERNAL_UNEXPECTED_ERROR,
        error instanceof Error ? error.message : 'Unknown error',
        undefined,
        undefined,
        requestId
      );
    }
  };
}

/**
 * Helper to check if response is an error
 */
export function isErrorResponse(response: ApiResponse): response is ErrorResponse {
  return response.success === false;
}

/**
 * Helper to extract error from response
 */
export function getErrorFromResponse(response: ApiResponse): ErrorResponse['error'] | null {
  return isErrorResponse(response) ? response.error : null;
}

/**
 * Helper to extract data from response
 */
export function getDataFromResponse<T>(response: ApiResponse<T>): T | null {
  return response.success ? response.data : null;
}
