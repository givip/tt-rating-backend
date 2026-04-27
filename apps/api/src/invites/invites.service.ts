import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { UserRole } from '@tt-rating/db/generated';

export interface CreateInviteInput {
  role: UserRole;
  expiresAt: Date;
  createdBy: string;
}

function generateCode(): string {
  // 16 bytes -> 22 base64url chars; readable enough to share over chat.
  return randomBytes(16).toString('base64url');
}

@Injectable()
export class InvitesService {
  constructor(private prisma: PrismaService) {}

  async create(input: CreateInviteInput) {
    if (input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invite expiry must be in the future, not the past');
    }
    const code = generateCode();
    return this.prisma.invite.create({
      data: {
        code,
        role: input.role,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
      },
    });
  }
}
