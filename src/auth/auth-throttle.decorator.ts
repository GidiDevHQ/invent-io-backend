import { Throttle } from '@nestjs/throttler';

export function AuthThrottle(limit = 20) {
  return Throttle({ default: { limit, ttl: 60_000 } });
}
