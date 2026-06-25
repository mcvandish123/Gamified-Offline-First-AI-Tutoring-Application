import { UnauthorizedException } from '@nestjs/common';

/**
 * Extracts the user id (JWT `sub` claim) from a Supabase access token.
 * Decodes the JWT payload directly instead of calling auth.getUser(),
 * which fails with the new sb_secret_... key format.
 */
export function extractUserId(authorization: string | undefined): string {
  if (!authorization) {
    throw new UnauthorizedException('Missing Authorization header');
  }

  const token = authorization.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new UnauthorizedException('Malformed token');
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    const userId: string | undefined = payload.sub;
    if (!userId) throw new UnauthorizedException('Token has no sub claim');
    return userId;
  } catch (err) {
    if (err instanceof UnauthorizedException) throw err;
    throw new UnauthorizedException('Failed to decode token');
  }
}
