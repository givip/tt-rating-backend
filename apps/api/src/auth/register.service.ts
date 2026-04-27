import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TokenService, TokenPair } from './token.service';
import { hashPassword } from './strategies/password.strategy';

export interface RegisterInput {
  identifier: string;
  credential: string;
  name: string;
  inviteCode: string;
}

export interface RegisterOutput {
  tokens: TokenPair;
  user: { id: string; role: string };
}

interface PasswordHasher {
  hash(plain: string): Promise<string>;
}

const defaultHasher: PasswordHasher = { hash: hashPassword };

/** Heuristic: identifiers that start with `+` or are all digits go in `phone`. */
function isPhone(identifier: string): boolean {
  return /^\+?[0-9]+$/.test(identifier);
}

@Injectable()
export class RegisterService {
  constructor(
    private prisma: PrismaService,
    private tokens: TokenService,
    @Optional() private hasher: PasswordHasher = defaultHasher,
  ) {}

  async register(input: RegisterInput): Promise<RegisterOutput> {
    const { identifier, credential, name: _name, inviteCode } = input;

    if (credential.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const passwordHash = await this.hasher.hash(credential);

    const created = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { code: inviteCode } });
      if (!invite) {
        throw new BadRequestException('Invalid invite code');
      }
      if (invite.usedAt != null) {
        throw new BadRequestException('Invite already used');
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new BadRequestException('Invite expired');
      }

      const phone = isPhone(identifier) ? identifier : null;
      const email = phone == null ? identifier : null;

      const existing = await tx.user.findFirst({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
      });
      if (existing) {
        throw new ConflictException('Identifier already registered');
      }

      const user = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          role: invite.role,
        },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedBy: user.id },
      });

      return user;
    });

    const tokens = await this.tokens.issue(created.id, created.role);
    return { tokens, user: { id: created.id, role: created.role } };
  }
}
