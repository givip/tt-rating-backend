import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodBody } from '../common/zod-swagger';
import { CasualMatchesService } from './casual-matches.service';

const ProposeDto = z
  .object({
    opponentId: z.string().uuid(),
    winnerId: z.string().uuid(),
    setsPlayer1: z.number().int().min(0),
    setsPlayer2: z.number().int().min(0),
    playedAt: z.coerce.date().nullish(),
  })
  .strict();

type AuthedRequest = FastifyRequest & { user: { userId: string; role: string } };

@ApiTags('casual-matches')
@Controller('casual-matches')
export class CasualMatchesController {
  constructor(private casuals: CasualMatchesService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('player', 'organizer', 'admin')
  @ApiOperation({ summary: 'Propose a casual match (non-provisional players only)' })
  @ZodBody(ProposeDto)
  async propose(@Req() req: AuthedRequest, @Body() body: unknown) {
    const dto = ProposeDto.parse(body);
    return this.casuals.propose(dto, req.user);
  }

  @Get('pending')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List casual matches awaiting my acceptance' })
  async pending(@Req() req: AuthedRequest) {
    return this.casuals.listPending(req.user);
  }

  @Post(':id/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('player', 'organizer', 'admin')
  @ApiOperation({ summary: 'Accept a pending casual match' })
  async accept(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.casuals.accept(id, req.user);
  }

  @Post(':id/reject')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('player', 'organizer', 'admin')
  @ApiOperation({ summary: 'Reject a pending casual match' })
  async reject(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.casuals.reject(id, req.user);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('player', 'organizer', 'admin')
  @ApiOperation({ summary: 'Cancel a pending casual match (proposer only)' })
  async cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.casuals.cancel(id, req.user);
  }
}
