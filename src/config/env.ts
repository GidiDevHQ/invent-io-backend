import 'dotenv/config';

const requiredEnv = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_URL'] as const;

function getRequiredEnv(name: (typeof requiredEnv)[number]): string {
  const value = process.env[name];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  DATABASE_URL: getRequiredEnv('DATABASE_URL'),
  JWT_SECRET: getRequiredEnv('JWT_SECRET'),
  REDIS_URL: getRequiredEnv('REDIS_URL'),
  PORT: process.env.PORT ?? '3000',
};
