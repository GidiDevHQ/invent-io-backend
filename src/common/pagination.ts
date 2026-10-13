/**
 * Cursor pagination. Clients send `limit` and an opaque `cursor`; responses
 * carry `nextCursor` (null when there are no more rows). The cursor is just the
 * id of the last row, base64url-encoded so it stays opaque to clients.
 */
export interface PageQuery {
    limit?: number;
    cursor?: string;
}

export interface Page<T> {
    items: T[];
    nextCursor: string | null;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function clampLimit(limit?: number): number {
    if (!limit || limit < 1) {
        return DEFAULT_PAGE_LIMIT;
    }
    return Math.min(limit, MAX_PAGE_LIMIT);
}

export function encodeCursor(id: string): string {
    return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): string | undefined {
    if (!cursor) {
        return undefined;
    }
    return Buffer.from(cursor, 'base64url').toString('utf8');
}

/**
 * Given rows fetched with `take = limit + 1`, split off the extra row and
 * produce the page plus the next cursor derived from the last returned row.
 */
export function buildPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
    if (rows.length > limit) {
        const items = rows.slice(0, limit);
        return { items, nextCursor: encodeCursor(items[items.length - 1].id) };
    }
    return { items: rows, nextCursor: null };
}
