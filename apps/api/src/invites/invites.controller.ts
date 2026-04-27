import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z, ZodError } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ZodBody } from '../common/zod-swagger';
import { InvitesService } from './invites.service';

const CreateDto = z.object({
  role: z.enum(['player', 'organizer', 'admin']),
  expiresAt: z.string().refine((s) => !isNaN(Date.parse(s)), 'Invalid date'),
});

@ApiTags('admin')
@Controller('admin/invites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class InvitesController {
  constructor(private invites: InvitesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a single-use invite code (admin only)' })
  @ZodBody(CreateDto)
  async create(
    @Body() body: unknown,
    @Req() req: { user: { userId: string; role: string } },
  ) {
    let parsed: z.infer<typeof CreateDto>;
    try {
      parsed = CreateDto.parse(body);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException('Invalid request body');
      }
      throw err;
    }

    const invite = await this.invites.create({
      role: parsed.role,
      expiresAt: new Date(parsed.expiresAt),
      createdBy: req.user.userId,
    });

    return {
      id: invite.id,
      code: invite.code,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }
}
