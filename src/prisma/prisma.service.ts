import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { getPrismaClientClass } from '../generated/prisma/client/internal/class';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends getPrismaClientClass() implements OnModuleInit, OnModuleDestroy {
    constructor() {
        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl || typeof databaseUrl !== 'string') {
            throw new Error('DATABASE_URL is not set or is invalid.');
        }

        const adapter = new PrismaPg({ connectionString: databaseUrl });
        super({ adapter });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}