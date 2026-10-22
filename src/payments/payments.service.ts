import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildPage, clampLimit, decodeCursor, type PageQuery } from '../common/pagination';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../tenancy/tenant.decorator';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';

type PaymentListQuery = PageQuery & {
    status?: string;
    branchId?: string;
};

@Injectable()
export class PaymentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly outbox: OutboxService,
    ) {}

    async listUnallocated(tenant: TenantContext, query: PaymentListQuery) {
        if (query.status && query.status !== 'SUCCEEDED') {
            throw new BadRequestException('Only SUCCEEDED payments can be listed for itemization');
        }

        const branchId = await this.resolveBranchFilter(tenant, query.branchId);
        const limit = clampLimit(query.limit);
        const cursorId = decodeCursor(query.cursor);
        const cursorPayment = cursorId
            ? await this.prisma.payment.findFirst({
                  where: { id: cursorId, organizationId: tenant.organizationId },
                  select: { id: true, branchId: true, occurredAt: true },
              })
            : null;
        if (cursorId && !cursorPayment) throw new BadRequestException('Invalid payment cursor');
        if (cursorPayment && branchId && cursorPayment.branchId !== branchId) {
            throw new BadRequestException('Payment cursor does not belong to the requested branch');
        }

        const rows = await this.prisma.payment.findMany({
            where: {
                organizationId: tenant.organizationId,
                status: 'SUCCEEDED',
                allocation: null,
                ...(branchId ? { branchId } : {}),
                ...(cursorPayment
                    ? {
                          OR: [
                              { occurredAt: { gt: cursorPayment.occurredAt } },
                              {
                                  occurredAt: cursorPayment.occurredAt,
                                  id: { gt: cursorPayment.id },
                              },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take: limit + 1,
        });

        const page = buildPage(rows, limit);
        return {
            ...page,
            items: page.items.map((payment) => ({
                ...payment,
                amountMinor: payment.amountMinor.toString(),
            })),
        };
    }

    async createManual(tenant: TenantContext, dto: CreateManualPaymentDto) {
        const branchId = await this.resolveBranchForManualPayment(tenant, dto.branchId);
        const amountMinor = BigInt(dto.amountMinor);
        if (amountMinor > 9_223_372_036_854_775_807n) {
            throw new BadRequestException('amountMinor exceeds the supported payment amount');
        }
        const providerReference = `cash_${randomUUID()}`;
        const occurredAt = new Date();

        return this.prisma.$transaction(async (tx) => {
            const organization = await tx.organization.findUniqueOrThrow({
                where: { id: tenant.organizationId },
                select: { currency: true },
            });
            const payment = await tx.payment.create({
                data: {
                    organizationId: tenant.organizationId,
                    branchId,
                    providerReference,
                    amountMinor,
                    currency: organization.currency,
                    method: 'cash',
                    status: 'SUCCEEDED',
                    occurredAt,
                },
            });

            await this.audit.record(tx, {
                organizationId: tenant.organizationId,
                actorId: tenant.userId,
                action: 'payment.manual_created',
                entity: 'Payment',
                entityId: payment.id,
                after: {
                    branchId,
                    providerReference,
                    amountMinor: amountMinor.toString(),
                    currency: organization.currency,
                    method: 'cash',
                    status: 'SUCCEEDED',
                },
            });

            await this.outbox.enqueue(tx, {
                type: 'payment.confirmed',
                organizationId: tenant.organizationId,
                payload: {
                    paymentId: payment.id,
                    organizationId: tenant.organizationId,
                    branchId,
                    reference: providerReference,
                    amountMinor: amountMinor.toString(),
                    currency: organization.currency,
                },
            });

            return {
                ...payment,
                amountMinor: payment.amountMinor.toString(),
            };
        });
    }

    private async resolveBranchFilter(tenant: TenantContext, requestedBranchId?: string): Promise<string | undefined> {
        if (tenant.branchId && requestedBranchId && requestedBranchId !== tenant.branchId) {
            throw new ForbiddenException('Cannot access payments for another branch');
        }

        const branchId = tenant.branchId ?? requestedBranchId;
        if (!branchId) return undefined;

        const branch = await this.prisma.branch.findFirst({
            where: { id: branchId, organizationId: tenant.organizationId },
            select: { id: true },
        });
        if (!branch) throw new NotFoundException('Branch not found');
        return branch.id;
    }

    private async resolveBranchForManualPayment(tenant: TenantContext, requestedBranchId?: string): Promise<string> {
        if (tenant.branchId && requestedBranchId && requestedBranchId !== tenant.branchId) {
            throw new ForbiddenException('Cannot create payments for another branch');
        }

        const branchId = tenant.branchId ?? requestedBranchId;
        if (!branchId) {
            throw new BadRequestException('branchId is required for a manual cash payment');
        }

        const branch = await this.prisma.branch.findFirst({
            where: { id: branchId, organizationId: tenant.organizationId, active: true },
            select: { id: true },
        });
        if (!branch) throw new NotFoundException('Active branch not found');
        return branch.id;
    }
}
