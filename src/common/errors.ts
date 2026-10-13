/**
 * The standard API error shape. Every error response the API returns should
 * serialize to `{ error: { code, message, details?, requestId? } }`.
 * `code` is a stable, machine-readable string clients can branch on.
 *
 * NOTE: a global exception filter that maps thrown exceptions to this shape is
 * not wired yet (follow-up). These types/codes exist so modules standardize on
 * the same vocabulary now.
 */
export interface ApiError {
    error: {
        code: string;
        message: string;
        details?: unknown;
        requestId?: string;
    };
}

export const ErrorCode = {
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    FORBIDDEN: 'FORBIDDEN',
    UNAUTHORIZED: 'UNAUTHORIZED',
    INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
